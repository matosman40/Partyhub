import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compareVersions, isValidVersion } from '../packages/semver.js';
import { GITHUB_API, GitHubError, githubGetJson, type GitHubOptions } from '../sources/github.js';
import type { Logger } from '../logger.js';

/**
 * Mise à jour de PartyHub depuis l’administration.
 *
 * L’application n’a aucun accès à Docker. Elle écrit une demande dans DATA_DIR/update, et un petit
 * service sur l’hôte (deploy/updater) l’exécute. Fichiers échangés, tous dans DATA_DIR/update :
 *
 *   request.json             demande de l’administrateur (écrite ici)
 *   request.processing.json  demande prise en charge par l’hôte
 *   status.json              résultat de la dernière tentative (écrit par l’hôte)
 *   updater-heartbeat.json   présence de l’installeur sur l’hôte (écrit par l’hôte, chaque minute)
 *   server-heartbeat.json    version et parties en cours (écrit ici, toutes les 30 s)
 */

export const PLATFORM_REPO = 'matosman40/Partyhub';

const RELEASES_TTL_MS = 10 * 60_000;
const RELEASES_FETCHED = 30;
const RELEASES_SHOWN = 15;
const NOTES_MAX_CHARS = 8_000;
const HEARTBEAT_EVERY_MS = 30_000;
const UPDATER_FRESH_MS = 3 * 60_000;
/** Une demande restée « en cours » plus longtemps que ça a été abandonnée par l’hôte. */
const PROCESSING_STALE_MS = 45 * 60_000;

const REQUEST = 'request.json';
const PROCESSING = 'request.processing.json';
const STATUS = 'status.json';
const UPDATER_HEARTBEAT = 'updater-heartbeat.json';
const SERVER_HEARTBEAT = 'server-heartbeat.json';

export const START_BLOCKED_MESSAGE =
  'Une mise à jour est demandée : aucune nouvelle partie ne peut démarrer avant qu’elle soit faite.';

export interface UpdateRelease {
  version: string;
  name: string;
  publishedAt: string;
  notes: string;
  url: string;
  /** Plus récente que la version en cours. */
  newer: boolean;
}

export interface UpdateRequest {
  version: string;
  requestedAt: string;
  backup: string | null;
}

export type UpdateState = 'waiting' | 'running' | 'done' | 'failed' | 'rolled-back';

export interface UpdateStatus {
  state: UpdateState;
  version: string | null;
  from: string | null;
  message: string;
  at: string;
}

export interface UpdateView {
  current: string;
  repo: string;
  checkedAt: string | null;
  checkError: string | null;
  releases: UpdateRelease[];
  updater: { installed: boolean; seenAt: string | null };
  pending: UpdateRequest | null;
  status: UpdateStatus | null;
  openRooms: number;
  inGame: number;
  canUpdate: boolean;
  blockedReason: string | null;
}

export type Refusal = { ok: false; status: number; error: string };
export type RequestOutcome = { ok: true; request: UpdateRequest } | Refusal;

export interface RoomCounts {
  inGame: number;
  openRooms: number;
}

export type BackupOutcome = { ok: true; name: string } | { ok: false; error: string };

interface ReleaseInfo {
  version: string;
  name: string;
  publishedAt: string;
  notes: string;
  url: string;
}

export interface UpdateServiceOptions {
  dataDir: string;
  currentVersion: string;
  repo?: string;
  github?: GitHubOptions;
  logger: Logger;
  counts: () => RoomCounts;
  /** Sauvegarde de la base, faite avant chaque demande : elle sert si la nouvelle version modifie le schéma. */
  backup: () => BackupOutcome;
  now?: () => Date;
}

function refuse(status: number, error: string): Refusal {
  return { ok: false, status, error };
}

function readJson<T>(file: string): T | null {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return data && typeof data === 'object' ? (data as T) : null;
  } catch {
    return null;
  }
}

/** Écrit le fichier d’un seul coup : l’hôte ne doit jamais lire une demande à moitié écrite. */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  renameSync(tmp, file);
}

/** Numéro de version de l’application : celui du package.json racine du monorepo. */
export function readAppVersion(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const pkg = readJson<{ version?: unknown; workspaces?: unknown }>(path.join(dir, 'package.json'));
    if (pkg && Array.isArray(pkg.workspaces) && typeof pkg.version === 'string' && isValidVersion(pkg.version)) {
      return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return '0.0.0';
    dir = parent;
  }
}

/** Lit la liste des releases GitHub : seules les versions X.Y.Z publiées (ni brouillon, ni préversion) sont gardées. */
function parseReleases(data: unknown): ReleaseInfo[] {
  if (!Array.isArray(data)) throw new GitHubError('Réponse GitHub inattendue.');
  const out: ReleaseInfo[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (r.draft === true || r.prerelease === true) continue;
    const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
    const version = tag.replace(/^v/, '');
    if (!isValidVersion(version)) continue;
    out.push({
      version,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : tag,
      publishedAt: typeof r.published_at === 'string' ? r.published_at : '',
      notes: typeof r.body === 'string' ? r.body.trim().slice(0, NOTES_MAX_CHARS) : '',
      url: typeof r.html_url === 'string' && r.html_url.startsWith('https://') ? r.html_url : '',
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

export class UpdateService {
  readonly dir: string;
  private readonly repo: string;
  private readonly now: () => Date;
  private releases: ReleaseInfo[] = [];
  private checkedAt: string | null = null;
  private checkError: string | null = null;
  private inflight: Promise<void> | null = null;

  constructor(private readonly opts: UpdateServiceOptions) {
    this.dir = path.join(opts.dataDir, 'update');
    this.repo = opts.repo ?? PLATFORM_REPO;
    this.now = opts.now ?? (() => new Date());
    mkdirSync(this.dir, { recursive: true });
  }

  /** État complet pour l’administration. `force` interroge GitHub sans attendre le délai de cache. */
  async view(force = false): Promise<UpdateView> {
    await this.refresh(force);
    const counts = this.opts.counts();
    const installed = this.updaterInstalled();
    const blockedReason = this.blockReason(installed, counts);
    return {
      current: this.opts.currentVersion,
      repo: this.repo,
      checkedAt: this.checkedAt,
      checkError: this.checkError,
      releases: this.releases.map((r) => ({ ...r, newer: compareVersions(r.version, this.opts.currentVersion) > 0 })),
      updater: { installed, seenAt: this.updaterSeenAt() },
      pending: this.pendingRequest(),
      status: this.readStatus(),
      openRooms: counts.openRooms,
      inGame: counts.inGame,
      canUpdate: blockedReason === null,
      blockedReason,
    };
  }

  /**
   * Demande la mise à jour vers une version publiée. Les contrôles et l’écriture de la demande se
   * suivent sans attente : aucune partie ne peut démarrer entre les deux.
   */
  async request(version: string): Promise<RequestOutcome> {
    if (!isValidVersion(version)) return refuse(400, 'Numéro de version invalide.');
    if (compareVersions(version, this.opts.currentVersion) <= 0) {
      return refuse(409, 'Cette version n’est pas plus récente que la version en cours.');
    }
    await this.refresh(false);
    if (!this.releases.some((r) => r.version === version)) {
      return this.releases.length === 0 && this.checkError
        ? refuse(502, this.checkError)
        : refuse(404, 'Cette version n’est pas publiée sur GitHub.');
    }
    const blocked = this.blockReason(this.updaterInstalled(), this.opts.counts());
    if (blocked) return refuse(409, blocked);
    const backup = this.opts.backup();
    if (!backup.ok) return refuse(500, `Sauvegarde de la base impossible : ${backup.error}`);
    const request: UpdateRequest = { version, requestedAt: this.now().toISOString(), backup: backup.name };
    writeJsonAtomic(this.file(REQUEST), request);
    this.opts.logger.info(
      { event: 'update.requested', version, from: this.opts.currentVersion, backup: backup.name },
      'Mise à jour demandée par l’administrateur',
    );
    return { ok: true, request };
  }

  /** Annule une demande pas encore prise en charge par l’hôte. */
  cancel(): { ok: true } | Refusal {
    const file = this.file(REQUEST);
    try {
      // Le renommage est atomique : si l’hôte a déjà pris la demande, il échoue.
      renameSync(file, `${file}.annulee`);
    } catch {
      return refuse(
        409,
        existsSync(this.file(PROCESSING))
          ? 'La mise à jour a déjà été prise en charge par l’hôte.'
          : 'Aucune mise à jour n’est demandée.',
      );
    }
    rmSync(`${file}.annulee`, { force: true });
    this.opts.logger.info({ event: 'update.cancelled' }, 'Demande de mise à jour annulée');
    return { ok: true };
  }

  /** Raison pour laquelle une partie ne peut pas démarrer, ou null. Appelée à chaque lancement. */
  startBlockedReason(): string | null {
    return this.hasPendingUpdate() ? START_BLOCKED_MESSAGE : null;
  }

  /** Écrit le signal de vie du serveur (version, parties en cours) : l’hôte s’en sert pour attendre la fin des parties. */
  startHeartbeat(): () => void {
    const startedAt = this.now().toISOString();
    const beat = () => {
      const counts = this.opts.counts();
      try {
        writeJsonAtomic(this.file(SERVER_HEARTBEAT), {
          version: this.opts.currentVersion,
          startedAt,
          updatedAt: this.now().toISOString(),
          inGame: counts.inGame,
          openRooms: counts.openRooms,
        });
      } catch (err) {
        this.opts.logger.warn({ event: 'update.heartbeat-failed', err }, 'Écriture du signal de vie impossible');
      }
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_EVERY_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  private async refresh(force: boolean): Promise<void> {
    const age = this.checkedAt ? this.now().getTime() - Date.parse(this.checkedAt) : Number.POSITIVE_INFINITY;
    if (!force && age < RELEASES_TTL_MS) return;
    this.inflight ??= this.fetchReleases().finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }

  private async fetchReleases(): Promise<void> {
    try {
      const url = `${GITHUB_API}/repos/${this.repo}/releases?per_page=${RELEASES_FETCHED}`;
      const data = await githubGetJson(url, this.opts.github ?? {});
      this.releases = parseReleases(data).slice(0, RELEASES_SHOWN);
      this.checkError = null;
    } catch (err) {
      this.checkError = err instanceof GitHubError ? err.message : 'La liste des versions n’a pas pu être lue.';
      this.opts.logger.warn({ event: 'update.check-failed', err }, 'Lecture des versions publiées impossible');
    }
    this.checkedAt = this.now().toISOString();
  }

  private updaterSeenAt(): string | null {
    const beat = readJson<{ seenAt?: unknown }>(this.file(UPDATER_HEARTBEAT));
    return typeof beat?.seenAt === 'string' ? beat.seenAt : null;
  }

  private updaterInstalled(): boolean {
    const seenAt = this.updaterSeenAt();
    return seenAt !== null && this.now().getTime() - Date.parse(seenAt) < UPDATER_FRESH_MS;
  }

  private processingActive(): boolean {
    const file = this.file(PROCESSING);
    try {
      return this.now().getTime() - statSync(file).mtimeMs < PROCESSING_STALE_MS;
    } catch {
      return false;
    }
  }

  private hasPendingUpdate(): boolean {
    return existsSync(this.file(REQUEST)) || this.processingActive();
  }

  private pendingRequest(): UpdateRequest | null {
    const file = existsSync(this.file(REQUEST))
      ? this.file(REQUEST)
      : this.processingActive()
        ? this.file(PROCESSING)
        : null;
    if (!file) return null;
    const data = readJson<Partial<UpdateRequest>>(file);
    return {
      version: typeof data?.version === 'string' ? data.version : 'inconnue',
      requestedAt: typeof data?.requestedAt === 'string' ? data.requestedAt : '',
      backup: typeof data?.backup === 'string' ? data.backup : null,
    };
  }

  private readStatus(): UpdateStatus | null {
    const data = readJson<Partial<UpdateStatus>>(this.file(STATUS));
    if (!data || typeof data.state !== 'string' || typeof data.message !== 'string') return null;
    return {
      state: data.state as UpdateState,
      version: typeof data.version === 'string' ? data.version : null,
      from: typeof data.from === 'string' ? data.from : null,
      message: data.message,
      at: typeof data.at === 'string' ? data.at : '',
    };
  }

  private blockReason(installed: boolean, counts: RoomCounts): string | null {
    if (!installed) {
      return 'L’installeur n’est pas actif sur l’hôte : il faut l’installer une fois (voir docs/MISE-A-JOUR.md).';
    }
    if (this.hasPendingUpdate()) return 'Une mise à jour est déjà demandée.';
    if (counts.inGame > 0) {
      return 'Une partie est en cours : la mise à jour pourra être lancée quand elle sera terminée.';
    }
    return null;
  }
}
