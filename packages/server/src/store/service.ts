import type { CodeGameSummary, CodeGamesPort } from '../code-games/service.js';
import type { Store } from '../db/store.js';
import { compareVersions } from '../packages/semver.js';
import type { PackageService } from '../packages/service.js';
import { isValidRepo, type GitHubOptions, type GitHubRateLimit } from '../sources/github.js';
import type { CheckOutcome, PackageSourceRecord, PackageSourceService } from '../sources/service.js';
import {
  CODE_MODULE,
  COVER_MAX_BYTES,
  GAME_ID,
  coverContentType,
  looksLikeImage,
  readCatalog,
  repoFile,
  type StoreGameInfo,
  type StoreManifest,
} from './catalog.js';

/**
 * Magasin : les jeux publiés dans le dépôt de jeux, installés, mis à jour ou supprimés d’un clic. Chaque jeu installé
 * a une source d’origine « tags » (`auteur/depot/jeu`), mise à jour chaque jour : le paquet se construit à partir du
 * dossier `jeux/<jeu>/` au tag le plus haut, sans release ni signature (voir store/build.ts). Les jeux intégrés à
 * l’application ne sont jamais téléchargés.
 */

export const DEFAULT_STORE_REPO = 'matosman40/jeux-partyhub';
const CATALOG_TTL_MS = 10 * 60 * 1000;
const COVER_CACHE_MAX = 60;
const KV_REPO = 'store_repo';
const KV_AUTO_UPDATE = 'store_auto_update';
/** Nombre maximal de jeux dans une même file d’installation ou de mise à jour. */
export const STORE_JOB_MAX = 200;

/**
 * integre : déjà dans l’application ; non_installe ; a_jour ; mise_a_jour ; erreur (échec, rien d’installé) ;
 * en_revue : un jeu de code est installé, en attente de l’approbation de l’administrateur (« Jeux de code »).
 */
export type StoreStatus = 'integre' | 'non_installe' | 'a_jour' | 'mise_a_jour' | 'erreur' | 'en_revue';

export interface StoreGameView extends StoreGameInfo {
  builtin: boolean;
  status: StoreStatus;
  installedVersion: string | null;
  /** Version de jeu de code installée et en attente de revue, ou null. */
  pendingVersion: string | null;
  autoUpdate: boolean;
  lastError: string | null;
  lastCheckedAt: string | null;
  hasCover: boolean;
}

export interface CatalogView {
  repo: string;
  tokenConfigured: boolean;
  /** Mise à jour automatique de tous les jeux du dépôt (réglage unique, appliqué aux sources). */
  autoUpdate: boolean;
  checkedAt: string | null;
  /** Dernier quota GitHub lu sur ce serveur, ou null si aucun appel n’a encore eu lieu. */
  rateLimit: GitHubRateLimit | null;
  games: StoreGameView[];
  error: string | null;
}

export type StoreJobAction = 'install' | 'update';
export type StoreJobState = 'attente' | 'en_cours' | 'ok' | 'erreur';

export interface StoreJobItem {
  id: string;
  name: string;
  state: StoreJobState;
  /** Résultat, ou raison de l’échec, une fois le jeu traité. */
  message: string | null;
}

/** File d’installation ou de mise à jour : les jeux se traitent un par un, en arrière-plan. */
export interface StoreJobView {
  action: StoreJobAction;
  items: StoreJobItem[];
  startedAt: string;
  /** Null tant que la file n’est pas terminée. */
  finishedAt: string | null;
}

export interface StoreServiceOptions {
  /** Dépôt de jeux par défaut (variable PARTYHUB_STORE_REPO). Le choix fait dans l’administration le remplace. */
  defaultRepo?: string;
  /** Jeton GitHub du serveur : sans lui, les appels à GitHub sont limités. Jamais exposé. */
  token?: string;
  /** Client HTTP injectable (tests). */
  fetch?: typeof fetch;
  /** Vrai pour un identifiant de jeu déjà intégré à l’application : rien à télécharger. */
  isBuiltin: (gameId: string) => boolean;
  now?: () => number;
  /** Jeux de code : installés en attente de revue, retirés depuis « Jeux de code » ou ici. */
  code?: CodeGamesPort;
}

/** Version active et version en attente de revue d’un jeu de code (la plus haute en attente). */
function codeVersions(rows: CodeGameSummary[], gameId: string): { active: string | null; pending: string | null } {
  let active: string | null = null;
  let pending: string | null = null;
  for (const row of rows) {
    if (row.id !== gameId) continue;
    // « erreur » : la version active, mais qui échoue au chargement. Elle reste la version active.
    if (row.status === 'active' || row.status === 'erreur') active = row.version;
    else if (row.status === 'en_attente' && (pending === null || compareVersions(row.version, pending) > 0)) {
      pending = row.version;
    }
  }
  return { active, pending };
}

type Loaded =
  { ok: true; repo: string; at: number; games: StoreGameInfo[] } | { ok: false; repo: string; error: string };

function fail(error: string): CheckOutcome {
  return { ok: false, error };
}

export class StoreService {
  private cache: { repo: string; at: number; games: StoreGameInfo[] } | null = null;
  private reading: { repo: string; promise: Promise<Loaded> } | null = null;
  private readonly manifests = new Map<string, StoreManifest>();
  private readonly covers = new Map<string, { bytes: Uint8Array; contentType: string }>();
  private job: StoreJobView | null = null;

  constructor(
    private readonly store: Store,
    private readonly sources: PackageSourceService,
    private readonly packages: PackageService,
    private readonly options: StoreServiceOptions,
  ) {}

  /** Dépôt utilisé : le choix de l’administration, sinon la configuration, sinon le dépôt par défaut. */
  get repo(): string {
    const saved = this.store.getKv(KV_REPO);
    if (saved && isValidRepo(saved)) return saved;
    const configured = this.options.defaultRepo;
    return configured && isValidRepo(configured) ? configured : DEFAULT_STORE_REPO;
  }

  get tokenConfigured(): boolean {
    return Boolean(this.options.token);
  }

  /** Mise à jour automatique de tous les jeux du dépôt. Vrai par défaut, comme pour un jeu installé ici. */
  get autoUpdate(): boolean {
    return this.store.getKv(KV_AUTO_UPDATE) !== 'off';
  }

  /** Active ou coupe la mise à jour automatique de tous les jeux du dépôt. Renvoie le nombre de sources touchées. */
  setAutoUpdate(enabled: boolean): number {
    this.store.setKv(KV_AUTO_UPDATE, enabled ? 'on' : 'off');
    const prefix = `${this.repo}/`;
    let touched = 0;
    for (const row of this.sources.list()) {
      if (row.origin !== 'tags' || !row.repo.startsWith(prefix)) continue;
      this.sources.update(row.id, { autoUpdate: enabled });
      touched++;
    }
    return touched;
  }

  setRepo(input: unknown): { ok: true; repo: string } | { ok: false; error: string } {
    const repo = typeof input === 'string' ? input.trim() : '';
    if (!isValidRepo(repo)) {
      return { ok: false, error: 'Dépôt invalide : indiquez auteur/nom, le dépôt qui contient le dossier jeux/.' };
    }
    this.store.setKv(KV_REPO, repo);
    this.cache = null;
    return { ok: true, repo };
  }

  /** Jeux du dépôt et leur état sur ce serveur. `refresh` ignore le cache de dix minutes. */
  async catalog(refresh = false): Promise<CatalogView> {
    const loaded = await this.load(refresh);
    if (!loaded.ok) {
      return {
        repo: loaded.repo,
        tokenConfigured: this.tokenConfigured,
        autoUpdate: this.autoUpdate,
        checkedAt: null,
        rateLimit: this.quota.current(),
        games: [],
        error: loaded.error,
      };
    }
    return this.view(loaded.repo, loaded.games, loaded.at);
  }

  /** Installe la dernière version d’un jeu du dépôt. Une source est créée pour lui, avec mise à jour automatique. */
  async install(gameId: string): Promise<CheckOutcome> {
    if (!GAME_ID.test(gameId)) return fail('Identifiant de jeu invalide.');
    if (this.options.isBuiltin(gameId)) return fail('Ce jeu est déjà intégré à l’application : rien à télécharger.');
    let source = this.findSource(gameId);
    let created = false;
    if (!source) {
      const added = this.sources.addFromStore(`${this.repo}/${gameId}`);
      if (!added.ok) return fail(added.error);
      source = this.sources.list().find((row) => row.id === added.id);
      created = true;
    }
    if (!source) return fail('Source introuvable après création.');
    if (created && !this.autoUpdate) this.sources.update(source.id, { autoUpdate: false });
    // La source garde la version d’un jeu retiré depuis « Paquets » ou « Jeux de code » : on la réinstalle.
    if (source.packageId && !this.installedHere(source.packageId)) this.sources.forgetInstalled(source.id);
    const outcome = await this.sources.check(source.id);
    // Échec à la première installation : pas de source orpheline, le message reste affiché par la réponse.
    if (!outcome.ok && created) this.sources.remove(source.id);
    return outcome;
  }

  /** Vérifie maintenant la source d’un jeu installé depuis le magasin, et installe la version la plus récente. */
  async update(gameId: string): Promise<CheckOutcome> {
    if (!GAME_ID.test(gameId)) return fail('Identifiant de jeu invalide.');
    const source = this.findSource(gameId);
    if (!source) return fail('Ce jeu n’est pas installé depuis le magasin.');
    return this.sources.check(source.id);
  }

  /**
   * Supprime un jeu installé depuis le magasin : son paquet (toutes ses versions), et sa source, pour qu’il ne
   * soit pas réinstallé au prochain passage. Les salons qui jouent ce jeu sont fermés ; leur nombre est renvoyé.
   */
  uninstall(
    gameId: string,
    closeRooms: (packageGameId: string) => number,
  ): { ok: true; closedRooms: number } | { ok: false; error: string; notFound?: boolean } {
    if (!GAME_ID.test(gameId)) return { ok: false, error: 'Identifiant de jeu invalide.' };
    const source = this.findSource(gameId);
    if (!source) return { ok: false, error: 'Ce jeu n’est pas installé depuis le magasin.', notFound: true };
    let closedRooms = 0;
    const codeRows = this.codeRows(gameId);
    if (codeRows.length > 0 && this.options.code) {
      // Jeu de code : toutes ses versions sont retirées. Ses salons se ferment sur son identifiant (manifeste).
      closedRooms = closeRooms(gameId);
      for (const row of codeRows) this.options.code.remove(gameId, row.version, 'magasin');
    } else if (source.packageId) {
      const packageGameId = this.packages.get(source.packageId)?.gameId ?? null;
      this.packages.remove(source.packageId);
      if (packageGameId) closedRooms = closeRooms(packageGameId);
    }
    this.sources.remove(source.id);
    return { ok: true, closedRooms };
  }

  /**
   * Supprime plusieurs jeux installés depuis le magasin. Chaque jeu passe par `uninstall` : une erreur sur l’un
   * n’empêche pas les autres.
   */
  removeMany(
    gameIds: string[],
    closeRooms: (packageGameId: string) => number,
  ): { removed: string[]; failed: { id: string; error: string }[]; closedRooms: number } {
    const removed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    let closedRooms = 0;
    for (const id of [...new Set(gameIds)]) {
      const result = this.uninstall(id, closeRooms);
      if (result.ok) {
        removed.push(id);
        closedRooms += result.closedRooms;
      } else {
        failed.push({ id, error: result.error });
      }
    }
    return { removed, failed, closedRooms };
  }

  /**
   * File d’installation ou de mise à jour : les jeux se traitent un par un, en arrière-plan, pour ne pas bloquer la
   * page (chaque jeu télécharge une archive). Une seule file à la fois.
   */
  startJob(
    action: StoreJobAction,
    gameIds: string[],
  ): { ok: true; job: StoreJobView } | { ok: false; error: string; busy: boolean } {
    if (this.job && this.job.finishedAt === null) {
      return { ok: false, error: 'Une opération est déjà en cours : attendez qu’elle se termine.', busy: true };
    }
    const ids = [...new Set(gameIds)];
    if (ids.length === 0) return { ok: false, error: 'Aucun jeu choisi.', busy: false };
    if (ids.length > STORE_JOB_MAX) {
      return { ok: false, error: `Au plus ${STORE_JOB_MAX} jeux à la fois.`, busy: false };
    }
    if (ids.some((id) => !GAME_ID.test(id))) return { ok: false, error: 'Identifiant de jeu invalide.', busy: false };
    const names = new Map((this.cache?.games ?? []).map((game) => [game.id, game.name] as const));
    const job: StoreJobView = {
      action,
      items: ids.map((id): StoreJobItem => ({ id, name: names.get(id) ?? id, state: 'attente', message: null })),
      startedAt: new Date(this.now()).toISOString(),
      finishedAt: null,
    };
    this.job = job;
    void this.runJob(job);
    return { ok: true, job: this.snapshot(job) };
  }

  /** La file en cours, ou la dernière terminée. Null si aucune n’a encore été lancée. */
  currentJob(): StoreJobView | null {
    return this.job ? this.snapshot(this.job) : null;
  }

  private snapshot(job: StoreJobView): StoreJobView {
    return { ...job, items: job.items.map((item) => ({ ...item })) };
  }

  private async runJob(job: StoreJobView): Promise<void> {
    for (const [index, item] of job.items.entries()) {
      item.state = 'en_cours';
      try {
        const outcome = job.action === 'install' ? await this.install(item.id) : await this.update(item.id);
        item.state = outcome.ok ? 'ok' : 'erreur';
        item.message = outcome.ok
          ? `${outcome.status} : version ${outcome.version}.`
          : [outcome.error, ...(outcome.issues ?? [])].join(' ');
      } catch (err) {
        item.state = 'erreur';
        item.message = err instanceof Error ? err.message : 'Échec.';
      }
      // Quota GitHub épuisé : les jeux suivants échoueraient tous. On s'arrête, et on le dit pour chacun.
      const rate = this.quota.current();
      if (item.state === 'erreur' && rate !== null && rate.remaining === 0 && rate.resetAt > this.now()) {
        for (const rest of job.items.slice(index + 1)) {
          rest.state = 'erreur';
          rest.message =
            'Non traité : la limite de requêtes GitHub est atteinte. Relancez la file après la réinitialisation.';
        }
        break;
      }
    }
    job.finishedAt = new Date(this.now()).toISOString();
  }

  /** Couverture d’un jeu du dépôt, lue à sa version publiée. Null si le jeu n’en a pas, ou si elle est refusée. */
  async cover(gameId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    if (!GAME_ID.test(gameId)) return null;
    const loaded = await this.load(false);
    if (!loaded.ok) return null;
    const game = loaded.games.find((item) => item.id === gameId);
    if (!game?.coverPath) return null;
    const contentType = coverContentType(game.coverPath);
    if (!contentType) return null;
    const key = `${loaded.repo}\n${game.tag}\n${game.coverPath}`;
    const known = this.covers.get(key);
    if (known) return known;
    try {
      const bytes = await repoFile(
        loaded.repo,
        `jeux/${gameId}/${game.coverPath}`,
        game.tag,
        this.github(),
        COVER_MAX_BYTES,
      );
      if (!looksLikeImage(bytes, contentType)) return null;
      const image = { bytes, contentType };
      this.covers.set(key, image);
      while (this.covers.size > COVER_CACHE_MAX) this.covers.delete(this.covers.keys().next().value!);
      return image;
    } catch {
      return null;
    }
  }

  /** Quota GitHub partagé avec les sources : le magasin et les installations lisent la même mesure. */
  private get quota() {
    return this.sources.quota;
  }

  private github(): GitHubOptions {
    return { fetch: this.options.fetch, token: this.options.token, quota: this.quota };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** La source du magasin pour ce jeu. Une source GitHub ajoutée à la main pour le même dépôt n’est pas la sienne. */
  private findSource(gameId: string): PackageSourceRecord | undefined {
    const ref = `${this.repo}/${gameId}`;
    return this.sources.list().find((row) => row.repo === ref && row.origin === 'tags');
  }

  private async load(refresh: boolean): Promise<Loaded> {
    const repo = this.repo;
    const cache = this.cache;
    if (!refresh && cache && cache.repo === repo && this.now() - cache.at < CATALOG_TTL_MS) {
      return { ok: true, repo, at: cache.at, games: cache.games };
    }
    // Une seule lecture à la fois : les couvertures demandées ensemble attendent la même réponse.
    if (!refresh && this.reading?.repo === repo) return this.reading.promise;
    const promise = this.read(repo);
    this.reading = { repo, promise };
    try {
      return await promise;
    } finally {
      if (this.reading?.promise === promise) this.reading = null;
    }
  }

  private async read(repo: string): Promise<Loaded> {
    const now = this.now();
    try {
      const games = await readCatalog(repo, this.github(), this.manifests);
      this.cache = { repo, at: now, games };
      return { ok: true, repo, at: now, games };
    } catch (err) {
      this.cache = null;
      return { ok: false, repo, error: err instanceof Error ? err.message : 'Dépôt de jeux injoignable.' };
    }
  }

  private view(repo: string, games: StoreGameInfo[], at: number): CatalogView {
    const sources = this.sources.list();
    const codeRows = this.options.code?.list() ?? [];
    return {
      repo,
      tokenConfigured: this.tokenConfigured,
      autoUpdate: this.autoUpdate,
      checkedAt: new Date(at).toISOString(),
      rateLimit: this.quota.current(),
      error: null,
      games: games.map((game) => this.gameView(repo, game, sources, codeRows)),
    };
  }

  /** Versions de jeu de code de ce serveur pour un identifiant. */
  private codeRows(gameId: string): CodeGameSummary[] {
    return (this.options.code?.list() ?? []).filter((row) => row.id === gameId);
  }

  /** Vrai si le jeu est encore installé ici, sous forme de paquet ou de jeu de code. */
  private installedHere(gameId: string): boolean {
    return this.codeRows(gameId).length > 0 || this.packages.get(gameId) !== undefined;
  }

  private gameView(
    repo: string,
    game: StoreGameInfo,
    sources: PackageSourceRecord[],
    codeRows: CodeGameSummary[],
  ): StoreGameView {
    const builtin = this.options.isBuiltin(game.id);
    const source = sources.find((row) => row.repo === `${repo}/${game.id}` && row.origin === 'tags') ?? null;
    const versions = codeVersions(codeRows, game.id);
    let status: StoreStatus;
    let installedVersion: string | null;
    let pendingVersion: string | null = null;
    // Un jeu de code s’évalue sur ses versions de code : la version active, et celle qui attend la revue.
    const isCode = game.module === CODE_MODULE || versions.active !== null || versions.pending !== null;
    if (isCode) {
      installedVersion = versions.active;
      pendingVersion = versions.pending;
      if (builtin) status = 'integre';
      else if (versions.pending && (!versions.active || compareVersions(versions.pending, versions.active) > 0)) {
        status = 'en_revue';
      } else if (versions.active) status = versions.active === game.latestVersion ? 'a_jour' : 'mise_a_jour';
      else status = source?.lastError ? 'erreur' : 'non_installe';
    } else {
      const installed = Boolean(source?.packageId);
      installedVersion = installed ? (source?.installedVersion ?? null) : null;
      if (builtin) status = 'integre';
      else if (installed) status = source?.installedVersion === game.latestVersion ? 'a_jour' : 'mise_a_jour';
      else status = source?.lastError ? 'erreur' : 'non_installe';
    }
    return {
      ...game,
      builtin,
      status,
      installedVersion,
      pendingVersion,
      autoUpdate: source?.autoUpdate ?? false,
      lastError: source?.lastError ?? null,
      lastCheckedAt: source?.lastCheckedAt ?? null,
      hasCover: game.coverPath !== null,
    };
  }
}
