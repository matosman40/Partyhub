import type { AiClient, AiRequest } from '@partyhub/shared';
import { AI_DEFAULTS, type AiConfig, type AiProviderConfig } from '../config.js';

/**
 * Client d’IA générative pour les jeux racontés. Plusieurs fournisseurs, appelés directement par `fetch`, sans SDK :
 * Anthropic (Messages) et tout service compatible OpenAI (chat/completions). Le client ne sait rien des jeux : il
 * envoie une consigne et renvoie le texte brut.
 *
 * Choix du fournisseur : on essaie les fournisseurs dans l’ordre de la configuration. Un fournisseur qui a atteint son
 * plafond journalier est sauté ; un fournisseur en échec laisse la place au suivant.
 *
 * Garde-fous : délai maximal par appel, une seule nouvelle tentative par fournisseur sur erreur transitoire, limite
 * horaire globale, plafond journalier par fournisseur, et messages d’erreur qui ne contiennent jamais la clé ni le
 * corps de la réponse. Les compteurs vivent en mémoire : ils repartent à zéro au redémarrage du serveur.
 */

export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Journal minimal : on n’y écrit jamais le contenu des requêtes ni des réponses. */
export interface AiLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface AiClientOptions {
  /**
   * Réglages en vigueur. Une fonction permet de les changer sans recréer le client : les compteurs d’appels
   * (horaire et journaliers) restent ceux de la salle, même quand l’administrateur modifie une clé.
   */
  config: AiConfig | (() => AiConfig | undefined);
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: AiLogger;
}

const RETRY_DELAY_MS = 800;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURLY_LIMIT_MESSAGE = 'Limite d’appels à l’IA atteinte pour cette heure.';
const DAILY_LIMIT_MESSAGE = 'Limite d’appels à l’IA atteinte pour les dernières 24 heures.';

/** Texte de réponse de chaque protocole, extrait du JSON renvoyé. */
export function extractAnthropicText(data: unknown): string {
  const blocks = (data as { content?: unknown })?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((b): b is { type: 'text'; text: string } => (b as { type?: unknown })?.type === 'text')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('');
}

export function extractOpenAiText(data: unknown): string {
  const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

/** Requête HTTP d’un fournisseur. Ne lit rien : c’est `attempt` qui envoie la requête et lit la réponse. */
export function buildRequest(
  provider: AiProviderConfig,
  request: Pick<AiRequest, 'system' | 'user' | 'maxTokens'>,
): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  if (provider.protocol === 'anthropic') {
    return {
      url: provider.endpoint,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: request.maxTokens,
          temperature: 0.9,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        }),
      },
    };
  }
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    [provider.maxTokensField]: request.maxTokens,
  };
  if (provider.jsonMode) body.response_format = { type: 'json_object' };
  return {
    url: provider.endpoint,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
    },
  };
}

export function createAiClient(options: AiClientOptions): AiClient {
  const current: () => AiConfig | undefined =
    typeof options.config === 'function' ? options.config : () => options.config as AiConfig;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /** Appels de toute la salle, pour la limite horaire globale. */
  const hourCalls: number[] = [];
  /** Appels par fournisseur, sur 24 heures glissantes. */
  const dayCalls = new Map<string, number[]>();

  /** Retire de la fenêtre les appels plus anciens que `span`. */
  function prune(calls: number[], span: number): void {
    const cutoff = now() - span;
    while (calls.length > 0 && calls[0]! < cutoff) calls.shift();
  }

  function dailyCallsOf(id: string): number[] {
    let calls = dayCalls.get(id);
    if (!calls) {
      calls = [];
      dayCalls.set(id, calls);
    }
    prune(calls, DAY_MS);
    return calls;
  }

  /** Vrai si le fournisseur peut encore recevoir un appel sous son plafond journalier. */
  function hasDailyRoom(provider: AiProviderConfig): boolean {
    if (provider.maxCallsPerDay === undefined) return true;
    return dailyCallsOf(provider.id).length < provider.maxCallsPerDay;
  }

  function checkHourly(): void {
    prune(hourCalls, HOUR_MS);
    const limit = current()?.maxCallsPerHour ?? AI_DEFAULTS.maxCallsPerHour;
    if (hourCalls.length >= limit) throw new AiError(HOURLY_LIMIT_MESSAGE, false);
  }

  /** Compte un appel avant de l’envoyer ; refuse, sans rien envoyer, au-delà des limites. */
  function reserve(provider: AiProviderConfig): void {
    checkHourly();
    if (!hasDailyRoom(provider)) throw new AiError(DAILY_LIMIT_MESSAGE, false);
    const at = now();
    hourCalls.push(at);
    dailyCallsOf(provider.id).push(at);
  }

  /** Un appel HTTP, borné par le délai et par le signal d’annulation de la salle. */
  async function attempt(provider: AiProviderConfig, request: AiRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), current()?.timeoutMs ?? AI_DEFAULTS.timeoutMs);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort);
    try {
      const { url, init } = buildRequest(provider, request);
      const res = await doFetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        throw new AiError(`Le fournisseur d’IA a répondu ${res.status}.`, retryable, res.status);
      }
      const data: unknown = await res.json();
      const text = provider.protocol === 'anthropic' ? extractAnthropicText(data) : extractOpenAiText(data);
      if (text.trim() === '') throw new AiError('Réponse vide de l’IA.', true);
      return text;
    } catch (err) {
      if (err instanceof AiError) throw err;
      if (request.signal?.aborted) throw new AiError('Génération annulée.', false);
      if (controller.signal.aborted) throw new AiError('Délai dépassé pour l’IA.', true);
      throw new AiError('Connexion au fournisseur d’IA impossible.', true);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Un fournisseur : son appel, puis une seule nouvelle tentative sur erreur transitoire. */
  async function callProvider(provider: AiProviderConfig, request: AiRequest): Promise<string> {
    reserve(provider);
    try {
      return await attempt(provider, request);
    } catch (err) {
      if (!(err instanceof AiError) || !err.retryable) throw err;
      options.logger?.warn(
        { event: 'ai.retry', provider: provider.id, status: err.status },
        'Appel IA relancé après une erreur transitoire',
      );
      await sleep(RETRY_DELAY_MS);
      if (request.signal?.aborted) throw new AiError('Génération annulée.', false);
      reserve(provider);
      try {
        return await attempt(provider, request);
      } catch (second) {
        options.logger?.warn(
          { event: 'ai.failed', provider: provider.id, status: (second as AiError).status },
          'Appel IA échoué',
        );
        throw second;
      }
    }
  }

  return {
    async complete(request: AiRequest): Promise<string> {
      const config = current();
      if (!config || config.providers.length === 0) throw new AiError('Aucun fournisseur d’IA configuré.', false);
      checkHourly();
      let last: AiError | undefined;
      for (const provider of config.providers) {
        if (!hasDailyRoom(provider)) {
          last = new AiError(DAILY_LIMIT_MESSAGE, false);
          options.logger?.warn(
            { event: 'ai.skipped', provider: provider.id },
            'Fournisseur d’IA ignoré : plafond journalier atteint',
          );
          continue;
        }
        try {
          return await callProvider(provider, request);
        } catch (err) {
          // Annulation de la salle : on s’arrête là, sans essayer le fournisseur suivant.
          if (!(err instanceof AiError) || request.signal?.aborted) throw err;
          last = err;
          options.logger?.warn(
            { event: 'ai.failover', provider: provider.id, status: err.status },
            'Fournisseur d’IA en échec : le suivant prend le relais',
          );
        }
      }
      throw last ?? new AiError('Aucun fournisseur d’IA configuré.', false);
    },
  };
}
