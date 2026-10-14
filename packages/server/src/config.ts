import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTrustProxy } from './trust-proxy.js';

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  dbFile: string;
  staticDir: string;
  adminPassword?: string;
  logLevel: string;
  secureCookies: boolean;
  /** Proxys de confiance (TRUST_PROXY, syntaxe d'Express). Absent = « loopback ». */
  trustProxy?: string;
  /** Limites de taille de la médiathèque, en octets (ASSET_MAX_*_MB). Absent = valeurs par défaut. */
  assetLimits?: { audio: number; video: number; image: number; font: number };
  /** Sauvegardes automatiques de la base. Absent = pas de sauvegarde (tests). */
  backup?: {
    dir: string;
    /** 0 = désactivé. */
    everyMs: number;
    keep: number;
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Entier lu dans l'environnement, avec une valeur par défaut et des bornes. */
function intFromEnv(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} invalide : « ${raw} » (entier entre ${min} et ${max})`);
  }
  return value;
}

const MB = 1024 * 1024;

/** Lit la configuration depuis l'environnement. Échoue tôt si une valeur est invalide. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 8282);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT invalide : ${env.PORT}`);
  }

  const dataDir = env.DATA_DIR?.trim() || path.resolve(process.cwd(), 'data');
  const adminPassword = env.ADMIN_PASSWORD?.trim() || undefined;
  const everyHours = intFromEnv('DB_BACKUP_EVERY_HOURS', env.DB_BACKUP_EVERY_HOURS, 24, 0, 24 * 365);
  const keep = intFromEnv('DB_BACKUP_KEEP', env.DB_BACKUP_KEEP, 7, 1, 365);
  const trustProxy = env.TRUST_PROXY?.trim() || 'loopback';
  try {
    compileTrustProxy(trustProxy);
  } catch (err) {
    throw new Error(`TRUST_PROXY invalide : « ${trustProxy} » (${(err as Error).message})`);
  }

  return {
    port,
    host: env.HOST?.trim() || '0.0.0.0',
    dataDir,
    dbFile: path.join(dataDir, 'partyhub.db'),
    staticDir: env.STATIC_DIR?.trim() || path.resolve(here, '../../web/dist'),
    adminPassword,
    logLevel: env.LOG_LEVEL?.trim() || 'info',
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
