import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTrustProxy } from './trust-proxy.js';
import { imagesFromEnv, type ImagesConfig } from './images/config.js';

/** Protocole d’appel : Anthropic (Messages) ou compatible OpenAI (chat/completions). */
export type AiProtocol = 'anthropic' | 'openai';

export interface AiProviderConfig {
  /** Identifiant du fournisseur (anthropic, groq, …). Il sert aux journaux, jamais à l’authentification. */
  id: string;
  protocol: AiProtocol;
  /** Clé du fournisseur. Lue ici seulement : elle n’est jamais envoyée au navigateur ni journalisée. */
  apiKey: string;
  model: string;
  /** Adresse complète de l’appel : racine du fournisseur plus son chemin. */
  endpoint: string;
  /** Champ de longueur de réponse : OpenAI récent attend max_completion_tokens, les autres max_tokens. */
  maxTokensField: 'max_completion_tokens' | 'max_tokens';
  /** Demande une réponse JSON (response_format). Désactivé quand le fournisseur ne le garantit pas. */
  jsonMode: boolean;
  /** Palier gratuit : sert à régler les plafonds, et apparaît dans les journaux. */
  free: boolean;
  /** Nombre maximal d’appels sur 24 heures glissantes, pour rester dans un palier gratuit ou borner un coût. */
  maxCallsPerDay?: number;
}

export interface AiConfig {
  /** Fournisseurs par ordre de préférence : le premier disponible répond, les suivants relaient en cas d’échec. */
  providers: AiProviderConfig[];
  /** Délai maximal d’un appel, en millisecondes. */
  timeoutMs: number;
  /** Nombre maximal d’appels par heure, tous fournisseurs confondus. */
  maxCallsPerHour: number;
}

export interface AppConfig {
  port: number;
  /**
   * Fournisseurs d’images (Cloudflare, ModelScope) : clés de l’environnement, plafonds. `loadConfig` le renseigne
   * toujours ; sans lui (serveur créé par programme), il n’y a simplement aucun fournisseur.
   */
  images?: ImagesConfig;
  host: string;
  dataDir: string;
  dbFile: string;
  staticDir: string;
  adminPassword?: string;
  /** Jeton GitHub pour les sources privées et les limites d’appels (GITHUB_TOKEN). Jamais affiché ni sauvegardé. */
  githubToken?: string;
  /**
   * Jeux intégrés sur une installation neuve. `false` (défaut de la production) : ils restent dans le code
   * mais sont désactivés, l’administrateur les active un par un. Absent : ils restent actifs (tests, usage en bibliothèque).
   */
  builtinGames?: boolean;
  logLevel: string;
  /** Journal fichier tournant (LOG_DIR, LOG_MAX_MB, LOG_FILES). Absent = sortie standard seulement (tests). */
  logFile?: { dir: string; maxBytes: number; maxFiles: number };
  secureCookies: boolean;
  /** Proxys de confiance (TRUST_PROXY, syntaxe d’Express). Absent = « loopback ». */
  trustProxy?: string;
  /** Limites de taille de la médiathèque, en octets (ASSET_MAX_*_MB). Absent = valeurs par défaut. */
  assetLimits?: { audio: number; video: number; image: number; font: number };
  /** IA générative (jeux racontés). Absent = IA désactivée : les jeux utilisent leur histoire de secours. */
  ai?: AiConfig;
  /** Sauvegardes automatiques de la base. Absent = pas de sauvegarde (tests). */
  backup?: {
    dir: string;
    /** 0 = désactivé. */
    everyMs: number;
    keep: number;
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Entier lu dans l’environnement, avec une valeur par défaut et des bornes. */
function intFromEnv(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} invalide : « ${raw} » (entier entre ${min} et ${max})`);
  }
  return value;
}

const MB = 1024 * 1024;

/** Réglages d’appel par défaut, quand l’environnement n’en donne pas (l’administration peut configurer sans lui). */
export const AI_DEFAULTS = { timeoutMs: 30000, maxCallsPerHour: 300 } as const;

/** BUILTIN_GAMES : « on » active les jeux intégrés sur une installation neuve ; « off » (défaut) les désactive. */
export function builtinGamesFromEnv(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'off') return false;
  if (value === 'on') return true;
  throw new Error(`BUILTIN_GAMES invalide : « ${raw} » (on ou off)`);
}

/** Fournisseur connu : protocole, adresse par défaut, variable de clé et paramètres d’appel. */
export interface ProviderPreset {
  id: string;
  protocol: AiProtocol;
  keyEnv: string;
  /** Racine par défaut. Absente pour « custom », qui exige AI_CUSTOM_BASE_URL. */
  baseUrl?: string;
  /** Chemin de l’appel, ajouté à la racine. */
  path: string;
  /** Modèle par défaut. Sans lui, AI_<FOURNISSEUR>_MODEL est obligatoire. */
  defaultModel?: string;
  maxTokensField: AiProviderConfig['maxTokensField'];
  jsonMode: boolean;
  free: boolean;
}

/**
 * Fournisseurs connus, dans l’ordre de détection (sans AI_PROVIDER). Adresses et chemins vérifiés dans la documentation
 * des fournisseurs. Le mode JSON n’est activé que là où il est documenté ; ailleurs, la réponse texte est lue avec une
 * extraction tolérante du JSON. Tout autre service compatible OpenAI passe par « custom ».
 */
export const PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    protocol: 'anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com',
    path: '/v1/messages',
    defaultModel: 'claude-haiku-5-5',
    maxTokensField: 'max_tokens',
    jsonMode: false,
    free: false,
  },
  {
    id: 'openai',
    protocol: 'openai',
    keyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com',
    path: '/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    maxTokensField: 'max_completion_tokens',
    jsonMode: true,
    free: false,
  },
  {
    id: 'groq',
    protocol: 'openai',
    keyEnv: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai',
    path: '/v1/chat/completions',
    maxTokensField: 'max_tokens',
    jsonMode: true,
    free: true,
  },
  {
    id: 'openrouter',
    protocol: 'openai',
    keyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api',
    path: '/v1/chat/completions',
    maxTokensField: 'max_tokens',
    jsonMode: true,
    free: true,
  },
  {
    id: 'mistral',
    protocol: 'openai',
    keyEnv: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai',
    path: '/v1/chat/completions',
    maxTokensField: 'max_tokens',
    jsonMode: true,
    free: true,
  },
  {
    id: 'cerebras',
    protocol: 'openai',
    keyEnv: 'CEREBRAS_API_KEY',
    baseUrl: 'https://api.cerebras.ai',
    path: '/v1/chat/completions',
    maxTokensField: 'max_tokens',
    jsonMode: false,
    free: true,
  },
  {
    id: 'gemini',
    protocol: 'openai',
    keyEnv: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    path: '/chat/completions',
    maxTokensField: 'max_tokens',
    jsonMode: false,
    free: true,
  },
  {
    id: 'custom',
    protocol: 'openai',
    keyEnv: 'AI_CUSTOM_API_KEY',
    path: '/v1/chat/completions',
    maxTokensField: 'max_tokens',
    jsonMode: false,
    free: false,
  },
];

/**
 * Fournisseur construit à partir de sa clé et de réglages saisis dans l’administration. Même règles que l’environnement :
 * modèle et adresse vérifiés avant tout appel.
 */
export function providerFromPreset(
  preset: ProviderPreset,
  fields: { apiKey: string; model?: string; baseUrl?: string; maxCallsPerDay?: number },
): AiProviderConfig {
  const model = fields.model?.trim() || preset.defaultModel;
  if (!model) throw new Error(`Le modèle est obligatoire pour « ${preset.id} ».`);
  const baseUrl = fields.baseUrl?.trim() || preset.baseUrl;
  if (!baseUrl) throw new Error(`L’adresse du service est obligatoire pour « ${preset.id} ».`);
  assertHttpUrl('Adresse du service', baseUrl);
  return {
    id: preset.id,
    protocol: preset.protocol,
    apiKey: fields.apiKey,
    model,
    endpoint: `${baseUrl.replace(/\/+$/, '')}${preset.path}`,
    maxTokensField: preset.maxTokensField,
    jsonMode: preset.jsonMode,
    free: preset.free,
    maxCallsPerDay: fields.maxCallsPerDay,
  };
}

/** Entier facultatif : absent ou vide, pas de limite. */
function optionalIntFromEnv(name: string, raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  return intFromEnv(name, raw, min, min, max);
}

function assertHttpUrl(name: string, value: string): void {
  try {
    const { protocol } = new URL(value);
    if (protocol === 'http:' || protocol === 'https:') return;
  } catch {
    // Adresse mal formée : le message ci-dessous la signale.
  }
  throw new Error(`${name} invalide : « ${value} » (adresse http ou https)`);
}

/** Configuration d’un fournisseur, lue sous son préfixe AI_<FOURNISSEUR>_ et sous sa variable de clé. */
function providerFromEnv(preset: ProviderPreset, env: NodeJS.ProcessEnv): AiProviderConfig {
  const prefix = `AI_${preset.id.toUpperCase()}`;
  const apiKey = (env[preset.keyEnv] ?? '').trim();
  if (!apiKey) throw new Error(`AI_PROVIDER demande « ${preset.id} », mais ${preset.keyEnv} est absente.`);
  const model = (env[`${prefix}_MODEL`] ?? '').trim() || preset.defaultModel;
  if (!model) throw new Error(`${prefix}_MODEL est obligatoire pour « ${preset.id} » (pas de modèle par défaut).`);
  const baseName = `${prefix}_BASE_URL`;
  const baseUrl = (env[baseName] ?? '').trim() || preset.baseUrl;
  if (!baseUrl) throw new Error(`${baseName} est obligatoire pour « ${preset.id} ».`);
  assertHttpUrl(baseName, baseUrl);
  const dayName = `${prefix}_MAX_CALLS_PER_DAY`;
  return {
    id: preset.id,
    protocol: preset.protocol,
    apiKey,
    model,
    endpoint: `${baseUrl.replace(/\/+$/, '')}${preset.path}`,
    maxTokensField: preset.maxTokensField,
    jsonMode: preset.jsonMode,
    free: preset.free,
    maxCallsPerDay: optionalIntFromEnv(dayName, env[dayName], 1, 1000000),
  };
}

/**
 * IA. AI_PROVIDER liste les fournisseurs par ordre de préférence (« groq,anthropic »). Sans lui, le premier fournisseur
 * dont la clé est présente est utilisé. Un fournisseur demandé sans clé, sans modèle ou avec une adresse invalide fait
 * échouer le démarrage, pour ne pas découvrir le problème en pleine partie.
 */
export function aiFromEnv(env: NodeJS.ProcessEnv): AiConfig | undefined {
  const requested = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (requested === 'none' || requested === 'off') return undefined;
  let ids = requested
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  if (ids.length === 0) {
    const inferred = PRESETS.find((p) => p.id !== 'custom' && (env[p.keyEnv] ?? '').trim() !== '');
    if (!inferred) return undefined;
    ids = [inferred.id];
  }
  const seen = new Set<string>();
  const providers = ids.map((id) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) {
      throw new Error(`AI_PROVIDER invalide : « ${id} » (${PRESETS.map((p) => p.id).join(', ')}, ou none)`);
    }
    if (seen.has(id)) throw new Error(`AI_PROVIDER : « ${id} » est listé deux fois`);
    seen.add(id);
    return providerFromEnv(preset, env);
  });
  return {
    providers,
    timeoutMs: intFromEnv('AI_TIMEOUT_MS', env.AI_TIMEOUT_MS, AI_DEFAULTS.timeoutMs, 5000, 120000),
    maxCallsPerHour: intFromEnv(
      'AI_MAX_CALLS_PER_HOUR',
      env.AI_MAX_CALLS_PER_HOUR,
      AI_DEFAULTS.maxCallsPerHour,
      1,
      100000,
    ),
  };
}

/** Lit la configuration depuis l’environnement. Échoue tôt si une valeur est invalide. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 8282);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT invalide : ${env.PORT}`);
  }

  const dataDir = env.DATA_DIR?.trim() || path.resolve(process.cwd(), 'data');
  const adminPassword = env.ADMIN_PASSWORD?.trim() || undefined;
  const everyHours = intFromEnv('DB_BACKUP_EVERY_HOURS', env.DB_BACKUP_EVERY_HOURS, 24, 0, 24 * 365);
  const keep = intFromEnv('DB_BACKUP_KEEP', env.DB_BACKUP_KEEP, 7, 1, 365);
  const logMb = intFromEnv('LOG_MAX_MB', env.LOG_MAX_MB, 5, 1, 100);
  const logFiles = intFromEnv('LOG_FILES', env.LOG_FILES, 6, 1, 50);
  const trustProxy = env.TRUST_PROXY?.trim() || 'loopback';
  try {
    compileTrustProxy(trustProxy);
  } catch (err) {
    throw new Error(`TRUST_PROXY invalide : « ${trustProxy} » (${(err as Error).message})`, { cause: err });
  }

  return {
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    dataDir,
    dbFile: path.join(dataDir, 'partyhub.db'),
    staticDir: env.STATIC_DIR?.trim() || path.resolve(here, '../../web/dist'),
    adminPassword,
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
    builtinGames: builtinGamesFromEnv(env.BUILTIN_GAMES),
    ai: aiFromEnv(env),
    images: imagesFromEnv(env),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    logFile: {
      dir: env.LOG_DIR?.trim() || path.join(dataDir, 'logs'),
      maxBytes: logMb * MB,
      maxFiles: logFiles,
    },
    secureCookies: env.COOKIE_SECURE === 'true',
    trustProxy,
    assetLimits: {
      audio: intFromEnv('ASSET_MAX_AUDIO_MB', env.ASSET_MAX_AUDIO_MB, 15, 1, 512) * MB,
      video: intFromEnv('ASSET_MAX_VIDEO_MB', env.ASSET_MAX_VIDEO_MB, 80, 1, 2048) * MB,
      image: intFromEnv('ASSET_MAX_IMAGE_MB', env.ASSET_MAX_IMAGE_MB, 5, 1, 64) * MB,
      font: intFromEnv('ASSET_MAX_FONT_MB', env.ASSET_MAX_FONT_MB, 2, 1, 16) * MB,
    },
    backup: {
      dir: env.DB_BACKUP_DIR?.trim() || path.join(dataDir, 'backups'),
      everyMs: everyHours * 60 * 60 * 1000,
      keep,
    },
  };
}
