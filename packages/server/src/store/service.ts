import type { Store } from '../db/store.js';
import type { PackageService } from '../packages/service.js';
import { isValidRepo, type GitHubOptions } from '../sources/github.js';
import type { CheckOutcome, PackageSourceRecord, PackageSourceService } from '../sources/service.js';
import {
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
 * Magasin : les jeux publiés dans le dépôt de jeux, installés, mis à jour ou supprimés d’un clic. Le magasin ne fait
 * que piloter les sources GitHub existantes : une source par jeu (`auteur/depot/jeu`), mise à jour chaque jour.
 * Les jeux intégrés à l’application ne sont jamais téléchargés.
 */

export const DEFAULT_STORE_REPO = 'matosman40/jeux-partyhub';
const CATALOG_TTL_MS = 10 * 60 * 1000;
const COVER_CACHE_MAX = 60;
const KV_REPO = 'store_repo';

/** integre : déjà dans l’application ; non_installe ; a_jour ; mise_a_jour ; erreur (échec, rien d’installé). */
export type StoreStatus = 'integre' | 'non_installe' | 'a_jour' | 'mise_a_jour' | 'erreur';

export interface StoreGameView extends StoreGameInfo {
  builtin: boolean;
  status: StoreStatus;
  installedVersion: string | null;
  autoUpdate: boolean;
  lastError: string | null;
  lastCheckedAt: string | null;
  hasCover: boolean;
}

export interface CatalogView {
  repo: string;
  tokenConfigured: boolean;
  checkedAt: string | null;
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
  /** Vrai pour un identifiant de jeu déjà intégré à l’application : rien à télécharger. */
  isBuiltin: (gameId: string) => boolean;
  now?: () => number;
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
        checkedAt: null,
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
      const added = this.sources.add({ repo: `${this.repo}/${gameId}`, autoUpdate: true, private: false });
      if (!added.ok) return fail(added.error);
      source = this.sources.list().find((row) => row.id === added.id);
      created = true;
    }
    if (!source) return fail('Source introuvable après création.');
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
    if (source.packageId) {
      const packageGameId = this.packages.get(source.packageId)?.gameId ?? null;
      this.packages.remove(source.packageId);
      if (packageGameId) closedRooms = closeRooms(packageGameId);
    }
    this.sources.remove(source.id);
    return { ok: true, closedRooms };
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
    return {
      repo,
      tokenConfigured: this.tokenConfigured,
      checkedAt: new Date(at).toISOString(),
      error: null,
      games: games.map((game) => this.gameView(repo, game, sources)),
    };
  }

  private gameView(repo: string, game: StoreGameInfo, sources: PackageSourceRecord[]): StoreGameView {
    const builtin = this.options.isBuiltin(game.id);
    const source = sources.find((row) => row.repo === `${repo}/${game.id}`) ?? null;
    const installed = Boolean(source?.packageId);
    let status: StoreStatus;
    if (builtin) status = 'integre';
    else if (installed) status = source?.installedVersion === game.latestVersion ? 'a_jour' : 'mise_a_jour';
    else status = source?.lastError ? 'erreur' : 'non_installe';
    return {
      ...game,
      builtin,
      status,
      installedVersion: installed ? (source?.installedVersion ?? null) : null,
      autoUpdate: source?.autoUpdate ?? false,
      lastError: source?.lastError ?? null,
      lastCheckedAt: source?.lastCheckedAt ?? null,
      hasCover: game.coverPath !== null,
    };
  }
}
