import fs from 'node:fs';
import type { CodeGameSummary, CodeGamesPort } from '../code-games/service.js';
import type { Store } from '../db/store.js';
import { compareVersions } from '../packages/semver.js';
import type { PackageService } from '../packages/service.js';
import { isValidRepo, type GitHubOptions } from '../sources/github.js';
import type { CheckOutcome, PackageSourceRecord, PackageSourceService } from '../sources/service.js';
import { CODE_MODULE, GAME_ID, coverContentType, type StoreGameInfo } from './catalog.js';
import { StoreSnapshot, type SnapshotData, type SnapshotGame } from './snapshot.js';

/**
 * Magasin : les jeux publiés dans le dépôt de jeux, installés, mis à jour ou supprimés d’un clic. Le magasin ne fait
 * que piloter les sources GitHub existantes : une source par jeu (`auteur/depot/jeu`), mise à jour chaque jour.
 * Les jeux intégrés à l’application ne sont jamais téléchargés.
 */

export const DEFAULT_STORE_REPO = 'matosman40/jeux-partyhub';
const KV_REPO = 'store_repo';

/**
 * integre : déjà dans l’application ; non_installe ; a_jour ; mise_a_jour ; erreur (échec, rien d’installé) ;
 * en_revue : un jeu de code est installé, en attente de l’approbation de l’administrateur (« Jeux de code »).
 */
export type StoreStatus = 'integre' | 'non_installe' | 'a_jour' | 'mise_a_jour' | 'erreur' | 'en_revue';

export interface StoreGameView extends StoreGameInfo {
  /** Taille du paquet de la dernière version, en octets ; null si inconnue. */
  size: number | null;
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
  /** Dernière lecture du dépôt, et prochaine actualisation automatique. */
  checkedAt: string | null;
  nextCheckAt: string | null;
  games: StoreGameView[];
  error: string | null;
}

export interface StoreServiceOptions {
  /** Dépôt de jeux par défaut (variable PARTYHUB_STORE_REPO). Le choix fait dans l’administration le remplace. */
  defaultRepo?: string;
  /** Jeton GitHub du serveur : sans lui, les appels à GitHub sont limités. Jamais exposé. */
  token?: string;
  /** Client HTTP injectable (tests). */
  fetch?: typeof fetch;
  /** DATA_DIR : l’instantané du magasin et les couvertures y sont gardés. */
  dataDir?: string;
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

function fail(error: string): CheckOutcome {
  return { ok: false, error };
}

export class StoreService {
  private readonly snapshot: StoreSnapshot;

  constructor(
    private readonly store: Store,
    private readonly sources: PackageSourceService,
    private readonly packages: PackageService,
    private readonly options: StoreServiceOptions,
  ) {
    this.snapshot = new StoreSnapshot({
      dataDir: options.dataDir ?? null,
      repo: this.repo,
      github: () => this.github(),
      now: () => this.now(),
    });
  }

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

  setRepo(input: unknown): { ok: true; repo: string } | { ok: false; error: string } {
    const repo = typeof input === 'string' ? input.trim() : '';
    if (!isValidRepo(repo)) {
      return { ok: false, error: 'Dépôt invalide : indiquez auteur/nom, le dépôt qui contient le dossier jeux/.' };
    }
    this.store.setKv(KV_REPO, repo);
    this.snapshot.setRepo(repo);
    return { ok: true, repo };
  }

  /**
   * Jeux du dépôt et leur état sur ce serveur. Lu dans l’instantané quotidien ; `manual` force une actualisation,
   * refusée si la précédente date de moins d’une heure.
   */
  async catalog(manual = false): Promise<CatalogView> {
    this.snapshot.setRepo(this.repo);
    if (manual) {
      const refreshed = await this.snapshot.refreshNow();
      const view = this.view(this.snapshot.snapshot);
      return refreshed.ok ? view : { ...view, error: refreshed.error };
    }
    await this.snapshot.get();
    return this.view(this.snapshot.snapshot);
  }

  /** Installe la dernière version d’un jeu du dépôt. Une source est créée pour lui, avec mise à jour automatique. */
  async install(gameId: string): Promise<CheckOutcome> {
    if (!GAME_ID.test(gameId)) return fail('Identifiant de jeu invalide.');
    if (this.options.isBuiltin(gameId)) return fail('Ce jeu est déjà intégré à l’application : rien à télécharger.');
    let source = this.findSource(gameId);
    let created = false;
    if (!source) {
      const added = this.sources.add({ repo: `${this.repo}/${gameId}`, autoUpdate: true, private: false });
      if (!added.ok) return fail(added.error);
      source = this.sources.list().find((row) => row.id === added.id);
      created = true;
    }
    if (!source) return fail('Source introuvable après création.');
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

  /** Couverture d’un jeu du dépôt, lue depuis DATA_DIR/store/covers. Null si le jeu n’en a pas. */
  async cover(gameId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    // Un visiteur peut demander une couverture avant la première lecture du dépôt : on attend l’instantané.
    await this.snapshot.get();
    const file = this.snapshot.coverFile(gameId);
    if (!file) return null;
    const contentType = coverContentType(file);
    if (!contentType) return null;
    try {
      return { bytes: new Uint8Array(await fs.promises.readFile(file)), contentType };
    } catch {
      return null;
    }
  }

  private github(): GitHubOptions {
    return { fetch: this.options.fetch, token: this.options.token };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private findSource(gameId: string): PackageSourceRecord | undefined {
    const ref = `${this.repo}/${gameId}`;
    return this.sources.list().find((row) => row.repo === ref);
  }

  private view(data: SnapshotData): CatalogView {
    const sources = this.sources.list();
    const codeRows = this.options.code?.list() ?? [];
    return {
      repo: data.repo,
      tokenConfigured: this.tokenConfigured,
      checkedAt: data.checkedAt === null ? null : new Date(data.checkedAt).toISOString(),
      nextCheckAt: data.checkedAt === null ? null : new Date(data.nextCheckAt).toISOString(),
      error: data.lastError,
      games: data.games.map((game) => this.gameView(data.repo, game, sources, codeRows)),
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
    game: SnapshotGame,
    sources: PackageSourceRecord[],
    codeRows: CodeGameSummary[],
  ): StoreGameView {
    const builtin = this.options.isBuiltin(game.id);
    const source = sources.find((row) => row.repo === `${repo}/${game.id}`) ?? null;
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
      size: game.size,
      builtin,
      status,
      installedVersion,
      pendingVersion,
      autoUpdate: source?.autoUpdate ?? false,
      lastError: source?.lastError ?? null,
      lastCheckedAt: source?.lastCheckedAt ?? null,
      hasCover: game.cover !== null,
    };
  }
}
