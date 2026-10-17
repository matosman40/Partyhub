import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '../logger.js';
import type { Store } from './store.js';

/**
 * Sauvegarde automatique de la base SQLite.
 *
 * Chaque sauvegarde est une copie cohérente (VACUUM INTO) nommée d’après sa date en UTC :
 * partyhub-AAAAMMJJ-HHMMSS.db. Seules les plus récentes sont conservées.
 *
 * La base contient des données personnelles (pseudos, statistiques, photos de profil) :
 * le dossier est créé en 0700 et les fichiers en 0600.
 */

export interface DbBackupConfig {
  /** Dossier des sauvegardes. */
  dir: string;
  /** Intervalle entre deux sauvegardes, en millisecondes. 0 = sauvegarde automatique désactivée. */
  everyMs: number;
  /** Nombre de sauvegardes conservées. */
  keep: number;
}

export interface DbBackupFile {
  name: string;
  size: number;
  createdAt: string;
}

const NAME_PATTERN = /^partyhub-\d{8}-\d{6}\.db$/;

/** Nom de fichier pour une date donnée (UTC, à la seconde). */
export function backupFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`;
  const time = `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
  return `partyhub-${day}-${time}.db`;
}

/** Sauvegardes présentes dans le dossier, de la plus récente à la plus ancienne. */
export function listDbBackups(dir: string): DbBackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => NAME_PATTERN.test(name))
    .map((name) => {
      const stat = statSync(path.join(dir, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** Supprime les sauvegardes au-delà des `keep` plus récentes. Renvoie les noms supprimés. */
export function pruneDbBackups(dir: string, keep: number): string[] {
  const removed = listDbBackups(dir)
    .slice(Math.max(1, keep))
    .map((file) => file.name);
  for (const name of removed) rmSync(path.join(dir, name), { force: true });
  return removed;
}

export type BackupOutcome = { ok: true; name: string; removed: string[] } | { ok: false; error: string };

export class DbBackupScheduler {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: Store,
    private readonly config: DbBackupConfig,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get enabled(): boolean {
    return this.config.everyMs > 0;
  }

  get settings(): DbBackupConfig {
    return this.config;
  }

  /** Crée une sauvegarde maintenant, puis applique la rotation. Ne lève jamais d’erreur. */
  runNow(): BackupOutcome {
    try {
      mkdirSync(this.config.dir, { recursive: true, mode: 0o700 });
      const name = backupFileName(this.now());
      const file = path.join(this.config.dir, name);
      if (existsSync(file)) {
        return { ok: false, error: 'Une sauvegarde a déjà été faite à cette seconde. Réessayez dans un instant.' };
      }
      this.store.backupTo(file);
      chmodSync(file, 0o600);
      const removed = pruneDbBackups(this.config.dir, this.config.keep);
      this.logger.info({ event: 'db.backup', backup: name, removed: removed.length }, 'Sauvegarde de la base créée');
      return { ok: true, name, removed };
    } catch (err) {
      this.logger.error({ event: 'db.backup-failed', err }, 'Échec de la sauvegarde de la base');
      return { ok: false, error: 'La sauvegarde a échoué. Consultez les journaux du serveur.' };
    }
  }

  /**
   * Démarre la sauvegarde périodique. Si la plus récente date de plus d’un intervalle
   * (ou s’il n’y en a pas), une sauvegarde est faite tout de suite.
   */
  start(): void {
    if (!this.enabled || this.timer) return;
    const latest = listDbBackups(this.config.dir)[0];
    const age = latest ? this.now().getTime() - Date.parse(latest.createdAt) : Number.POSITIVE_INFINITY;
    if (age >= this.config.everyMs) this.runNow();
    this.timer = setInterval(() => this.runNow(), this.config.everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
