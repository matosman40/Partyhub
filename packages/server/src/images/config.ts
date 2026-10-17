import {
  IMAGE_PROVIDER_IDS,
  createCloudflareProvider,
  createModelScopeProvider,
  type ImageProvider,
  type ImageProviderId,
} from './providers.js';

/**
 * Configuration des fournisseurs d'images, lue dans l'environnement du serveur. Les clés ne quittent jamais le
 * serveur. Sans clé, le fournisseur est absent : les jeux gardent alors leur rendu de secours, sans erreur.
 *
 * - CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN : Cloudflare Workers AI (FLUX.1 schnell), gratuit dans la limite
 *   d'un quota quotidien.
 * - MODELSCOPE_API_KEY : ModelScope (Qwen-Image). Service réservé à un usage non commercial.
 * - IMAGE_PROVIDERS : ordre d'appel, séparé par des virgules (par défaut : les fournisseurs dont la clé est présente).
 * - IMAGE_MAX_PER_DAY : nombre maximal d'images générées par jour, tous fournisseurs confondus.
 */

export interface ImageProviderSettings {
  id: ImageProviderId;
  apiKey: string;
  /** Cloudflare : identifiant du compte. */
  accountId?: string;
  /** Racine de l'API, pour les tests ou un proxy. */
  baseUrl?: string;
  /** ModelScope : modèle à utiliser. */
  model?: string;
}

export interface ImagesConfig {
  providers: ImageProviderSettings[];
  /** Plafond journalier d'images, tous fournisseurs confondus. */
  maxPerDay: number;
  /** Délai maximal pour une image (tous fournisseurs confondus pour une même demande). */
  timeoutMs: number;
}

export const IMAGES_DEFAULTS = { maxPerDay: 150, timeoutMs: 60_000 } as const;

function intFromEnv(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} doit être un entier entre ${min} et ${max}.`);
  }
  return value;
}

function settingsFor(id: ImageProviderId, env: NodeJS.ProcessEnv): ImageProviderSettings | null {
  if (id === 'cloudflare') {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const apiKey = env.CLOUDFLARE_API_TOKEN?.trim();
    if (!accountId || !apiKey) return null;
    return { id, apiKey, accountId, baseUrl: env.CLOUDFLARE_API_BASE?.trim() || undefined };
  }
  const apiKey = env.MODELSCOPE_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    id,
    apiKey,
    baseUrl: env.MODELSCOPE_API_BASE?.trim() || undefined,
    model: env.MODELSCOPE_IMAGE_MODEL?.trim() || undefined,
  };
}

export function imagesFromEnv(env: NodeJS.ProcessEnv): ImagesConfig {
  const requested = (env.IMAGE_PROVIDERS ?? '').trim().toLowerCase();
  let providers: ImageProviderSettings[];
  if (requested) {
    const ids = requested
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    providers = ids.map((id) => {
      if (!(IMAGE_PROVIDER_IDS as readonly string[]).includes(id)) {
        throw new Error(`IMAGE_PROVIDERS invalide : « ${id} » (${IMAGE_PROVIDER_IDS.join(', ')})`);
      }
      const settings = settingsFor(id as ImageProviderId, env);
      if (!settings) throw new Error(`IMAGE_PROVIDERS demande « ${id} », mais sa clé est absente.`);
      return settings;
    });
  } else {
    providers = IMAGE_PROVIDER_IDS.flatMap((id) => {
      const settings = settingsFor(id, env);
      return settings ? [settings] : [];
    });
  }
  return {
    providers,
    maxPerDay: intFromEnv('IMAGE_MAX_PER_DAY', env.IMAGE_MAX_PER_DAY, IMAGES_DEFAULTS.maxPerDay, 1, 100_000),
    timeoutMs: intFromEnv('IMAGE_TIMEOUT_MS', env.IMAGE_TIMEOUT_MS, IMAGES_DEFAULTS.timeoutMs, 5_000, 300_000),
  };
}

/** Crée les fournisseurs dans l'ordre de la configuration. */
export function buildImageProviders(config: ImagesConfig, fetchFn?: typeof fetch): ImageProvider[] {
  return config.providers.map((p): ImageProvider => {
    if (p.id === 'cloudflare') {
      return createCloudflareProvider({
        accountId: p.accountId ?? '',
        apiToken: p.apiKey,
        ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
    }
    return createModelScopeProvider({
      apiKey: p.apiKey,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      ...(p.model ? { model: p.model } : {}),
      ...(fetchFn ? { fetch: fetchFn } : {}),
    });
  });
}
