import path from 'node:path';
import type { AiClient, AiRequest } from '@partyhub/shared';
import {
  AI_DEFAULTS,
  PRESETS,
  providerFromPreset,
  type AiConfig,
  type AiProviderConfig,
  type ProviderPreset,
} from '../config.js';
import type { Logger } from '../logger.js';
import { AiError, createAiClient } from './client.js';
import { SecretBox } from './secrets.js';
import {
  AI_SETTINGS_KEY,
  readStoredAi,
  type AiProviderUpdate,
  type StoredAiSettings,
  type StoredProviderSettings,
} from './settings.js';

/**
 * Configuration d'IA en vigueur. Les fournisseurs viennent de deux sources : les variables d'environnement (démarrage)
 * et l'administration (clés saisies dans l'interface, qui priment sur l'environnement pour un même fournisseur).
 * Les changements s'appliquent tout de suite, sans redémarrage ; les compteurs d'appels sont conservés.
 */

export const AI_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  cerebras: 'Cerebras',
  gemini: 'Google Gemini',
  custom: 'Autre service compatible OpenAI',
};

/**
 * Modèle proposé quand l'administrateur n'en saisit pas un (fournisseurs sans modèle par défaut). Le bouton « Tester »
 * vérifie qu'il répond ; l'environnement, lui, exige toujours un modèle explicite.
 */
const SUGGESTED_MODELS: Record<string, string> = {
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
  mistral: 'mistral-small-latest',
  cerebras: 'llama3.1-8b',
  gemini: 'gemini-2.0-flash',
};

export type AiKeySource = 'admin' | 'env' | 'unreadable' | 'none';

/** Ce que l'administration affiche : jamais la clé elle-même. */
export interface AiProviderStatus {
  id: string;
  label: string;
  free: boolean;
  keySource: AiKeySource;
  /** Interrupteur de l'administration (vrai par défaut). */
  enabled: boolean;
  /** Le fournisseur répond dans la chaîne d'appel. */
  active: boolean;
  /** Pourquoi le fournisseur ne répond pas, quand il est activé mais incomplet. */
  problem: string | null;
  model: string;
  defaultModel: string | null;
  /** Adresse racine du service : réglable seulement pour « Autre service ». */
  baseUrl: string | null;
  customBaseUrl: boolean;
  maxCallsPerDay: number | null;
}

export interface AiStatus {
  providers: AiProviderStatus[];
  timeoutMs: number;
  maxCallsPerHour: number;
  /** Ordre d'appel des fournisseurs actifs. */
  chain: string[];
}

interface Resolved {
  preset: ProviderPreset;
  keySource: AiKeySource;
  enabled: boolean;
  settings: StoredProviderSettings;
  env: AiProviderConfig | undefined;
  provider: AiProviderConfig | undefined;
  problem: string | null;
}

interface KeyValueStore {
  getKv(key: string): string | undefined;
  setKv(key: string, value: string): void;
}

export class AiRuntime implements AiClient {
  private config: AiConfig | undefined;
  private readonly box: SecretBox;
  private readonly client: AiClient;

  constructor(
    private readonly kv: KeyValueStore,
    private readonly envConfig: AiConfig | undefined,
    dataDir: string,
    private readonly logger?: Pick<Logger, 'info' | 'warn'>,
  ) {
    this.box = new SecretBox(path.join(dataDir, 'ai-secret.key'));
    this.client = createAiClient({ config: () => this.config, ...(logger ? { logger } : {}) });
    this.reload();
  }

  /** Vrai quand au moins un fournisseur peut répondre. */
  available(): boolean {
    return this.config !== undefined;
  }

  complete(request: AiRequest): Promise<string> {
    return this.client.complete(request);
  }

  /** Applique les réglages stockés à la configuration en vigueur. */
  reload(): void {
    const resolved = this.resolve(this.stored());
    const order = [...new Set([...(this.envConfig?.providers.map((p) => p.id) ?? []), ...PRESETS.map((p) => p.id)])];
    const byId = new Map(resolved.map((r) => [r.preset.id, r]));
    const providers = order.flatMap((id) => {
      const r = byId.get(id);
      return r && r.enabled && r.provider ? [r.provider] : [];
    });
    const before = this.chainKey();
    this.config =
      providers.length > 0
        ? {
            providers,
            timeoutMs: this.envConfig?.timeoutMs ?? AI_DEFAULTS.timeoutMs,
            maxCallsPerHour: this.envConfig?.maxCallsPerHour ?? AI_DEFAULTS.maxCallsPerHour,
          }
        : undefined;
    if (before !== this.chainKey()) {
      this.logger?.info(
        {
          event: 'ai.enabled',
          providers: providers.map((p) => ({
            id: p.id,
            model: p.model,
            free: p.free,
            maxCallsPerDay: p.maxCallsPerDay ?? null,
          })),
        },
        providers.length > 0 ? 'Génération par IA activée' : 'Génération par IA désactivée',
      );
    }
  }

  status(): AiStatus {
    const resolved = this.resolve(this.stored());
    const chain = this.config?.providers.map((p) => p.id) ?? [];
    return {
      providers: resolved.map((r) => {
        const customBase = r.preset.id === 'custom';
        const envRoot = r.env ? r.env.endpoint.slice(0, -r.preset.path.length) : null;
        return {
          id: r.preset.id,
          label: AI_LABELS[r.preset.id] ?? r.preset.id,
          free: r.preset.free,
          keySource: r.keySource,
          enabled: r.enabled,
          active: chain.includes(r.preset.id),
          problem: r.enabled ? r.problem : null,
          model: r.provider?.model ?? r.settings.model ?? r.env?.model ?? r.preset.defaultModel ?? '',
          defaultModel: r.preset.defaultModel ?? null,
          baseUrl: customBase ? (r.settings.baseUrl ?? envRoot ?? null) : (r.preset.baseUrl ?? null),
          customBaseUrl: customBase,
          maxCallsPerDay: r.provider?.maxCallsPerDay ?? null,
        };
      }),
      timeoutMs: this.config?.timeoutMs ?? AI_DEFAULTS.timeoutMs,
      maxCallsPerHour: this.config?.maxCallsPerHour ?? AI_DEFAULTS.maxCallsPerHour,
      chain,
    };
  }

  /**
   * Modifie les réglages d'un fournisseur. Une valeur `null` (ou vide) retire le réglage saisi ici, ce qui rend
   * celui de l'environnement. La clé est chiffrée avant d'être stockée ; elle n'est jamais journalisée.
   */
  update(id: string, patch: AiProviderUpdate): { error?: string; changed: string[] } {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return { error: 'Fournisseur inconnu.', changed: [] };
    const all = this.stored();
    const settings: StoredProviderSettings = { ...(all[id] ?? {}) };
    const changed: string[] = [];

    if (patch.apiKey !== undefined) {
      const value = (patch.apiKey ?? '').trim();
      if (value === '') {
        delete settings.keySealed;
      } else {
        if (value.length < 8 || /\s/.test(value)) {
          return { error: 'Clé invalide : au moins 8 caractères, sans espace ni retour à la ligne.', changed: [] };
        }
        settings.keySealed = this.box.seal(value);
      }
      changed.push('apiKey');
    }
    if (patch.model !== undefined) {
      const value = (patch.model ?? '').trim();
      if (value) settings.model = value;
      else delete settings.model;
      changed.push('model');
    }
    if (patch.baseUrl !== undefined) {
      if (preset.id !== 'custom') return { error: 'L’adresse ne se règle que pour « Autre service ».', changed: [] };
      const value = (patch.baseUrl ?? '').trim();
      if (value) {
        if (!isHttpUrl(value)) return { error: 'Adresse invalide : il faut une adresse http ou https.', changed: [] };
        settings.baseUrl = value;
      } else {
        delete settings.baseUrl;
      }
      changed.push('baseUrl');
    }
    if (patch.enabled !== undefined) {
      settings.enabled = patch.enabled;
      changed.push('enabled');
    }
    if (patch.maxCallsPerDay !== undefined) {
      if (patch.maxCallsPerDay === null) delete settings.maxCallsPerDay;
      else settings.maxCallsPerDay = patch.maxCallsPerDay;
      changed.push('maxCallsPerDay');
    }

    const next: StoredAiSettings = { ...all, [id]: settings };
    this.kv.setKv(AI_SETTINGS_KEY, JSON.stringify(next));
    this.reload();
    return { changed };
  }

  /** Envoie un appel minimal à ce seul fournisseur, pour vérifier la clé. Le message ne contient jamais la clé. */
  async test(id: string): Promise<{ ok: boolean; message: string }> {
    const found = this.resolve(this.stored()).find((r) => r.preset.id === id);
    if (!found) return { ok: false, message: 'Fournisseur inconnu.' };
    const provider = found.provider;
    if (!provider) return { ok: false, message: found.problem ?? 'Aucune clé pour ce fournisseur.' };
    const client = createAiClient({
      config: {
        providers: [provider],
        timeoutMs: this.envConfig?.timeoutMs ?? AI_DEFAULTS.timeoutMs,
        maxCallsPerHour: 1000,
      },
    });
    try {
      await client.complete({ system: 'Tu réponds par un seul mot.', user: 'Réponds : OK', maxTokens: 16 });
      return { ok: true, message: `Réponse reçue du modèle ${provider.model}.` };
    } catch (err) {
      return { ok: false, message: err instanceof AiError ? err.message : 'L’appel a échoué.' };
    }
  }

  private stored(): StoredAiSettings {
    return readStoredAi(this.kv.getKv(AI_SETTINGS_KEY));
  }

  private chainKey(): string {
    return this.config?.providers.map((p) => `${p.id}:${p.model}`).join(',') ?? '';
  }

  /** Fournisseur par fournisseur : clé (administration d'abord), réglages, et ce qui manque pour appeler. */
  private resolve(stored: StoredAiSettings): Resolved[] {
    return PRESETS.map((preset) => {
      const settings = stored[preset.id] ?? {};
      const env = this.envConfig?.providers.find((p) => p.id === preset.id);
      const sealed = settings.keySealed;
      const adminKey = sealed ? this.box.open(sealed) : null;
      const apiKey = adminKey ?? env?.apiKey ?? null;
      const keySource: AiKeySource = adminKey ? 'admin' : env ? 'env' : sealed ? 'unreadable' : 'none';
      let provider: AiProviderConfig | undefined;
      let problem: string | null = null;
      if (apiKey) {
        try {
          provider = buildProvider(preset, env, settings, apiKey, adminKey !== null);
        } catch (err) {
          problem = (err as Error).message;
        }
      } else if (keySource === 'unreadable') {
        problem = 'La clé enregistrée ne peut pas être lue : ressaisissez-la.';
      } else {
        problem = 'Aucune clé enregistrée.';
      }
      return {
        preset,
        keySource,
        enabled: settings.enabled !== false,
        settings,
        env,
        provider,
        problem: provider ? null : problem,
      };
    });
  }
}

/** Fournisseur à appeler : celui de l'environnement, avec les réglages saisis par-dessus, ou un fournisseur neuf. */
function buildProvider(
  preset: ProviderPreset,
  env: AiProviderConfig | undefined,
  settings: StoredProviderSettings,
  apiKey: string,
  fromAdmin: boolean,
): AiProviderConfig {
  const root = preset.id === 'custom' ? settings.baseUrl : undefined;
  if (root || !env) {
    const suggested = fromAdmin ? SUGGESTED_MODELS[preset.id] : undefined;
    return providerFromPreset(preset, {
      apiKey,
      model: settings.model || env?.model || suggested,
      ...(root ? { baseUrl: root } : {}),
      maxCallsPerDay: settings.maxCallsPerDay ?? env?.maxCallsPerDay,
    });
  }
  return {
    ...env,
    apiKey,
    model: settings.model || env.model,
    maxCallsPerDay: settings.maxCallsPerDay ?? env.maxCallsPerDay,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
