import fs from 'node:fs';
import path from 'node:path';
import { compareVersions } from '../packages/semver.js';
import {
  GITHUB_API,
  GitHubError,
  githubGetJson,
  githubGetJsonConditional,
  rawGithubFile,
  type GitHubOptions,
} from '../sources/github.js';
import {
  COVER_MAX_BYTES,
  GAME_ID,
  MANIFEST_MAX_BYTES,
  coverContentType,
  looksLikeImage,
  moduleLabel,
  parseGameTag,
  parseStoreManifest,
  type StoreGameInfo,
  type StoreManifest,
} from './catalog.js';

/**
 * Instantané du magasin : la liste des jeux du dépôt, gardée sur disque (DATA_DIR/store). L’affichage ne lit jamais
 * GitHub ; il lit l’instantané. GitHub n’est interrogé qu’une fois par jour, et seulement si quelque chose a changé
 * (lecture conditionnelle : une réponse « inchangé » ne compte pas dans la limite). Les manifestes et couvertures
 * passent par les fichiers bruts, hors de l’API. Une limite atteinte garde l’instantané et fixe la prochaine tentative
 * à l’heure de reprise indiquée par GitHub.
 */

/** Une actualisation automatique au plus par jour. */
export const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
/** Une actualisation manuelle au plus toutes les heures, pour ne pas épuiser la limite de GitHub. */
export const MANUAL_REFRESH_MIN_MS = 60 * 60 * 1000;
/** Nouvel essai après une panne réseau (pas une limite) : une heure. */
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
const TAG_PAGE_SIZE = 100;
const MAX_TAG_PAGES = 10;
const FILE_VERSION = 1;

export interface SnapshotGame extends StoreGameInfo {
  /** Taille du paquet `<jeu>.phgame` de la dernière version, en octets ; null si inconnue. */
  size: number | null;
  /** Nom du fichier de couverture dans DATA_DIR/store/covers, ou null. */
  cover: string | null;
}

export interface SnapshotData {
  version: number;
  repo: string;
  /** Dernière lecture réussie du dépôt (ms), ou null. */
  checkedAt: number | null;
  /** Prochaine actualisation automatique (ms). */
  nextCheckAt: number;
  /** Dernière actualisation manuelle demandée (ms). */
  lastManualAt: number | null;
  /** Message affiché si la dernière actualisation n’a pas pu aller au bout. */
  lastError: string | null;
  tagsEtag: string | null;
  tags: string[];
  games: SnapshotGame[];
}

export interface SnapshotOptions {
  /** DATA_DIR : l’instantané et les couvertures y sont écrits. Null : mémoire seule (tests). */
  dataDir: string | null;
  repo: string;
  github: () => GitHubOptions;
  now: () => number;
}

function emptyData(repo: string): SnapshotData {
  return {
    version: FILE_VERSION,
    repo,
    checkedAt: null,
    nextCheckAt: 0,
    lastManualAt: null,
    lastError: null,
    tagsEtag: null,
    tags: [],
    games: [],
  };
}

function isSnapshotData(value: unknown): value is SnapshotData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<SnapshotData>;
  return data.version === FILE_VERSION && typeof data.repo === 'string' && Array.isArray(data.games);
}

/** Heure de reprise lisible, en français : « 14 h 05 ». */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')} h ${String(d.getMinutes()).padStart(2, '0')}`;
}

export class StoreSnapshot {
  private data: SnapshotData;
  private running: Promise<void> | null = null;

  constructor(private readonly options: SnapshotOptions) {
    this.data = this.load(options.repo);
  }

  /** Copie de l’instantané courant. */
  get snapshot(): SnapshotData {
    return this.data;
  }

  /** Dépôt suivi. Un autre dépôt repart d’un instantané vide. */
  setRepo(repo: string): void {
    if (repo === this.data.repo) return;
    this.data = emptyData(repo);
    this.save();
  }

  /**
   * Renvoie l’instantané. La première lecture attend GitHub ; ensuite, une actualisation due part en arrière-plan,
   * et l’instantané actuel répond tout de suite.
   */
  async get(): Promise<SnapshotData> {
    if (this.data.checkedAt === null && this.data.lastError === null) {
      await this.refresh();
    } else if (this.options.now() >= this.data.nextCheckAt) {
      void this.refresh();
    }
    return this.data;
  }

  /**
   * Actualisation demandée depuis l’administration. Refusée si la précédente date de moins d’une heure.
   * Renvoie un message d’erreur dans ce cas, sans appeler GitHub.
   */
  async refreshNow(): Promise<{ ok: true } | { ok: false; error: string }> {
    const now = this.options.now();
    const last = this.data.lastManualAt;
    if (last !== null && now - last < MANUAL_REFRESH_MIN_MS) {
      const wait = Math.ceil((MANUAL_REFRESH_MIN_MS - (now - last)) / 60_000);
      return {
        ok: false,
        error: `Le catalogue vient d’être actualisé. Nouvelle actualisation possible dans ${wait} min.`,
      };
    }
    this.data = { ...this.data, lastManualAt: now };
    this.save();
    await this.refresh();
    return { ok: true };
  }

  /** Chemin de la couverture d’un jeu, ou null. */
  coverFile(gameId: string): string | null {
    if (!GAME_ID.test(gameId) || !this.options.dataDir) return null;
    const game = this.data.games.find((item) => item.id === gameId);
    if (!game?.cover) return null;
    return path.join(this.coversDir(), game.cover);
  }

  private refresh(): Promise<void> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(): Promise<void> {
    const now = this.options.now();
    const repo = this.data.repo;
    const previous = this.data;
    try {
      const tags = await this.readTags(repo, previous);
      const latest = latestPerGame(tags.names);
      const games: SnapshotGame[] = [];
      for (const [id, { version, tag }] of latest) {
        // Une fiche déjà lue est gardée ; une fiche illisible est relue (la lecture brute ne compte pas dans la limite).
        const known = previous.games.find((game) => game.id === id && game.tag === tag && game.error === null);
        games.push(known ?? (await this.readGame(repo, id, version, tag)));
      }
      const pending = await this.fillSizes(repo, games);
      const next: SnapshotData = {
        ...this.data,
        repo,
        checkedAt: now,
        tagsEtag: tags.etag,
        tags: tags.names,
        games,
        lastError:
          pending.limitedAt === null
            ? null
            : `GitHub limite les appels : prochaine tentative vers ${clockTime(pending.limitedAt)}.`,
        nextCheckAt: pending.limitedAt ?? now + REFRESH_EVERY_MS,
      };
      this.data = next;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Dépôt de jeux injoignable.';
      const resetAt = err instanceof GitHubError ? err.resetAt : undefined;
      this.data = {
        ...this.data,
        lastError: resetAt ? `GitHub limite les appels : prochaine tentative vers ${clockTime(resetAt)}.` : message,
        nextCheckAt: resetAt ?? now + RETRY_AFTER_FAILURE_MS,
      };
    }
    this.save();
  }

  /** Noms des tags du dépôt. Une lecture conditionnelle de la première page évite tout appel inutile. */
  private async readTags(repo: string, previous: SnapshotData): Promise<{ names: string[]; etag: string | null }> {
    const github = this.options.github();
    const firstUrl = `${GITHUB_API}/repos/${repo}/tags?per_page=${TAG_PAGE_SIZE}&page=1`;
    const first = await githubGetJsonConditional(firstUrl, previous.tagsEtag, github);
    if (!first.modified) return { names: previous.tags, etag: previous.tagsEtag };
    const names: string[] = [];
    let page = first.data;
    for (let index = 1; index <= MAX_TAG_PAGES; index++) {
      if (!Array.isArray(page)) throw new GitHubError('Réponse GitHub illisible.');
      for (const item of page) {
        const name = item && typeof item === 'object' ? (item as { name?: unknown }).name : undefined;
        if (typeof name === 'string') names.push(name);
      }
      if (page.length < TAG_PAGE_SIZE) return { names, etag: first.etag };
      page = await githubGetJson(
        `${GITHUB_API}/repos/${repo}/tags?per_page=${TAG_PAGE_SIZE}&page=${index + 1}`,
        github,
      );
    }
    throw new GitHubError(
      `Le dépôt compte plus de ${MAX_TAG_PAGES * TAG_PAGE_SIZE} tags : le magasin ne peut pas tout lire.`,
    );
  }

  /** Fiche et couverture d’une version nouvelle. Une erreur reste sur le jeu, sans arrêter les autres. */
  private async readGame(repo: string, id: string, version: string, tag: string): Promise<SnapshotGame> {
    const anonymous: GitHubOptions = { fetch: this.options.github().fetch };
    let fiche: StoreManifest;
    try {
      fiche = parseStoreManifest(
        await rawGithubFile(repo, `jeux/${id}/manifest.json`, tag, anonymous, MANIFEST_MAX_BYTES),
        id,
      );
    } catch (err) {
      return unreadable(id, version, tag, err instanceof Error ? err.message : 'Fiche illisible.');
    }
    const cover = await this.readCover(repo, id, tag, fiche.coverPath, anonymous);
    const base: StoreGameInfo = {
      ...fiche,
      id,
      tag,
      latestVersion: version,
      moduleLabel: moduleLabel(fiche.module),
      error: null,
    };
    return { ...base, size: null, cover };
  }

  /** Couverture lue à sa version, enregistrée dans covers/. Null si absente ou refusée. */
  private async readCover(
    repo: string,
    id: string,
    tag: string,
    coverPath: string | null,
    anonymous: GitHubOptions,
  ): Promise<string | null> {
    if (!coverPath || !this.options.dataDir) return null;
    const contentType = coverContentType(coverPath);
    if (!contentType) return null;
    try {
      const bytes = await rawGithubFile(repo, `jeux/${id}/${coverPath}`, tag, anonymous, COVER_MAX_BYTES);
      if (!looksLikeImage(bytes, contentType)) return null;
      const ext = coverPath.slice(coverPath.lastIndexOf('.'));
      const file = `${id}${ext}`;
      fs.mkdirSync(this.coversDir(), { recursive: true });
      fs.writeFileSync(path.join(this.coversDir(), file), bytes);
      return file;
    } catch {
      return null;
    }
  }

  /**
   * Taille des paquets, lue dans la release de chaque version nouvelle (un appel API par jeu, seulement quand la
   * taille est encore inconnue). Renvoie l’heure de reprise si la limite est atteinte.
   */
  private async fillSizes(repo: string, games: SnapshotGame[]): Promise<{ limitedAt: number | null }> {
    for (const game of games) {
      if (game.size !== null || game.error !== null) continue;
      try {
        const release = (await githubGetJson(
          `${GITHUB_API}/repos/${repo}/releases/tags/${encodeURIComponent(game.tag)}`,
          this.options.github(),
        )) as { assets?: Array<{ name?: unknown; size?: unknown }> } | null;
        const asset = release?.assets?.find((item) => item.name === `${game.id}.phgame`);
        game.size = typeof asset?.size === 'number' ? asset.size : null;
      } catch (err) {
        if (err instanceof GitHubError && err.resetAt) return { limitedAt: err.resetAt };
        game.size = null;
      }
    }
    return { limitedAt: null };
  }

  private coversDir(): string {
    return path.join(this.options.dataDir ?? '', 'store', 'covers');
  }

  private filePath(): string | null {
    return this.options.dataDir ? path.join(this.options.dataDir, 'store', 'catalog.json') : null;
  }

  private load(repo: string): SnapshotData {
    const file = this.filePath();
    if (!file || !fs.existsSync(file)) return emptyData(repo);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (!isSnapshotData(parsed) || parsed.repo !== repo) return emptyData(repo);
      return parsed;
    } catch {
      return emptyData(repo);
    }
  }

  private save(): void {
    const file = this.filePath();
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    fs.renameSync(tmp, file);
  }
}

/** Dernière version de chaque jeu, triée par identifiant. */
export function latestPerGame(names: string[]): Map<string, { version: string; tag: string }> {
  const latest = new Map<string, { version: string; tag: string }>();
  for (const name of names) {
    const parsed = parseGameTag(name);
    if (!parsed) continue;
    const current = latest.get(parsed.game);
    if (!current || compareVersions(parsed.version, current.version) > 0) {
      latest.set(parsed.game, { version: parsed.version, tag: name });
    }
  }
  return new Map([...latest].sort(([a], [b]) => a.localeCompare(b, 'en')));
}

function unreadable(id: string, version: string, tag: string, error: string): SnapshotGame {
  return {
    id,
    tag,
    latestVersion: version,
    name: id,
    description: '',
    author: '',
    module: '',
    moduleLabel: moduleLabel(''),
    coverPath: null,
    error,
    size: null,
    cover: null,
  };
}
