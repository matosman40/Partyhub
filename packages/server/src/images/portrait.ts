import { portraitTraitsSchema, type PortraitTraits } from '@partyhub/shared';
import { LoginLimiter } from '../auth.js';

/**
 * Analyse d’un portrait par Cloudflare Workers AI (modèle de vision). Le modèle ne peut répondre que par des choix
 * dans les listes fermées de PartyHub : toute autre sortie est refusée. Rien n’est conservé ni journalisé de la photo
 * ni des traits reconnus ; les messages d’erreur ne contiennent ni la clé, ni l’image, ni la réponse du fournisseur.
 *
 * Variables d’environnement (en plus de CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN et CLOUDFLARE_API_BASE) :
 * - PORTRAIT_ENABLED : « 0 » ou « false » désactive la fonction ;
 * - PORTRAIT_MAX_PER_DAY : plafond d’analyses par jour UTC (entier de 1 à 1000, défaut 50).
 */

export const PORTRAIT_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
export const PORTRAIT_TIMEOUT_MS = 30_000;
export const PORTRAIT_DEFAULT_PER_DAY = 50;

export const PORTRAIT_PROMPT =
  'You are a character-creator assistant for a party game. Look at the portrait and answer with ONE JSON object and nothing else, using ONLY these allowed values: ' +
  '{"faces":<integer, number of human faces visible>,"skin":"very_light|light|medium|tan|dark","hair_style":"none|short|bob|spiky|bun|curly","hair_color":"black|brown|orange|pink|blue_purple|blond_white","accessory":"none|glasses|headphones|cap|bow|flower|crown|party","expression":"calme|souriant|rieur|clin|triste|etonne"} ' +
  'Rules: describe only what is visible; never identify anyone; if no face is visible set "faces":0.';

export interface PortraitImage {
  bytes: Buffer;
  mime: string;
}

export interface PortraitAnalyzer {
  analyze(image: PortraitImage, signal?: AbortSignal): Promise<PortraitTraits>;
}

export class PortraitProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortraitProviderError';
  }
}

export interface PortraitAnalyzerOptions {
  accountId: string;
  apiToken: string;
  /** Racine de l’API, pour les tests ou un proxy. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Délai maximal (30 s par défaut). */
  timeoutMs?: number;
}

/** Retire d’éventuelles clôtures ``` autour du JSON. */
function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
}

function extractTraits(data: unknown): PortraitTraits {
  const result = (data as { result?: Record<string, unknown> } | null)?.result;
  const choices = result?.choices as { message?: { content?: unknown } }[] | undefined;
  let raw: unknown = choices?.[0]?.message?.content ?? result?.response;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(stripFences(raw));
    } catch {
      throw new PortraitProviderError('Réponse du fournisseur illisible.');
    }
  }
  // Sans visage (ou avec plusieurs), le modèle laisse souvent les autres champs vides ou « none » : seul le nombre de
  // visages compte alors, la route refuse avant d’utiliser le reste. On le lit donc avant la validation stricte.
  const faces = (raw as { faces?: unknown } | null)?.faces;
  if (typeof faces === 'number' && Number.isInteger(faces) && faces !== 1 && faces >= 0 && faces <= 20) {
    return { faces, skin: 'medium', hair_style: 'none', hair_color: 'black', accessory: 'none', expression: 'calme' };
  }
  const parsed = portraitTraitsSchema.safeParse(raw);
  if (!parsed.success) throw new PortraitProviderError('Réponse du fournisseur hors des valeurs permises.');
  return parsed.data;
}

export function createPortraitAnalyzer(options: PortraitAnalyzerOptions): PortraitAnalyzer {
  const doFetch = options.fetch ?? fetch;
  const root = (options.baseUrl ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, '');
  const url = `${root}/accounts/${encodeURIComponent(options.accountId)}/ai/run/${PORTRAIT_MODEL}`;
  return {
    async analyze(image, signal) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? PORTRAIT_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: PORTRAIT_PROMPT },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${image.mime};base64,${image.bytes.toString('base64')}` },
                  },
                ],
              },
            ],
            max_tokens: 200,
            temperature: 0,
          }),
          signal: combined,
        });
      } catch {
        throw new PortraitProviderError(
          combined.aborted ? 'Analyse trop longue ou annulée.' : 'Connexion au fournisseur impossible.',
        );
      }
      if (!res.ok) throw new PortraitProviderError(`Le fournisseur a répondu ${res.status}.`);
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new PortraitProviderError(
          combined.aborted ? 'Analyse trop longue.' : 'Réponse du fournisseur illisible.',
        );
      }
      return extractTraits(data);
    },
  };
}

// ---------------------------------------------------------------------------
// Configuration et garde-fous
// ---------------------------------------------------------------------------

export interface PortraitSettings {
  /** Absent : fournisseur non configuré. */
  analyzer: PortraitAnalyzer | null;
  enabled: boolean;
  maxPerDay: number;
}

export function portraitFromEnv(env: NodeJS.ProcessEnv, fetchFn?: typeof fetch): PortraitSettings {
  const flag = (env.PORTRAIT_ENABLED ?? '').trim().toLowerCase();
  const enabled = flag !== '0' && flag !== 'false';
  const rawMax = env.PORTRAIT_MAX_PER_DAY?.trim();
  let maxPerDay: number = PORTRAIT_DEFAULT_PER_DAY;
  if (rawMax) {
    const value = Number(rawMax);
    if (!Number.isInteger(value) || value < 1 || value > 1000) {
      throw new Error('PORTRAIT_MAX_PER_DAY doit être un entier entre 1 et 1000.');
    }
    maxPerDay = value;
  }
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const baseUrl = env.CLOUDFLARE_API_BASE?.trim();
  const analyzer =
    accountId && apiToken
      ? createPortraitAnalyzer({
          accountId,
          apiToken,
          ...(baseUrl ? { baseUrl } : {}),
          ...(fetchFn ? { fetch: fetchFn } : {}),
        })
      : null;
  return { analyzer, enabled, maxPerDay };
}

/** Limiteurs de la route : par profil, par adresse et plafond quotidien global (jour UTC, en mémoire). */
export class PortraitGuard {
  private readonly perProfile = new LoginLimiter(5, 10 * 60_000);
  private readonly perIp = new LoginLimiter(20, 10 * 60_000);
  private day = '';
  private used = 0;

  constructor(
    readonly settings: PortraitSettings,
    private readonly now: () => number = Date.now,
  ) {}

  get available(): boolean {
    return this.settings.enabled && this.settings.analyzer !== null;
  }

  /** Compte la demande ; faux si le profil ou l’adresse a dépassé sa limite. */
  admit(profileId: string, ip: string): boolean {
    if (!this.perProfile.allow(profileId) || !this.perIp.allow(ip)) return false;
    this.perProfile.hit(profileId);
    this.perIp.hit(ip);
    return true;
  }

  /** Réserve une analyse du jour ; faux si le plafond est atteint. */
  reserveDaily(): boolean {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.settings.maxPerDay) return false;
    this.used++;
    return true;
  }
}

/** Format réel d’une image, reconnu à ses premiers octets. */
export function sniffPortrait(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
