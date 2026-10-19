import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCodePackage, newCodeGame } from '../code-games/build.js';
import { CodeGameService, loadTrustedKeys } from '../code-games/service.js';
import { Store } from '../db/store.js';
import { generateSigningKeys } from '../packages/code-format.js';
import { PackageService } from '../packages/service.js';
import { PackageSourceService } from '../sources/service.js';
import { COVER_MAX_BYTES } from '../store/catalog.js';
import { StoreService, type StoreServiceOptions } from '../store/service.js';
import { buildPackage, enc, sha, tinyPng } from './helpers/package-kit.js';

const REPO = 'matosman40/jeux-partyhub';
const TOKEN = 'ghp_secret_du_magasin_0123456789';

interface Release {
  archive: Uint8Array;
  /** Empreinte publiée dans le .sha256 ; null = fichier absent de la release. */
  sha: string | null;
}

/** Dépôt de jeux simulé : tags, fichiers par version (`tag|chemin`) et releases par tag. */
interface FakeStore {
  tags: string[];
  files: Record<string, Uint8Array>;
  releases: Record<string, Release>;
  limited: boolean;
  calls: { path: string; auth: string | null }[];
}

const emptyStore = (): FakeStore => ({ tags: [], files: {}, releases: {}, limited: false, calls: [] });

function reply(body: BodyInit, status: number, url: URL, type: string): Response {
  const res = new Response(body as unknown as BodyInit, { status, headers: { 'content-type': type } });
  Object.defineProperty(res, 'url', { value: url.href });
  return res;
}

const json = (value: unknown, status: number, url: URL) =>
  reply(JSON.stringify(value), status, url, 'application/json');
const notFound = (url: URL) => json({ message: 'Not Found' }, 404, url);

/** Faux client GitHub : les mêmes routes que le code réel (tags, matching-refs, releases, actifs, contents). */
function fakeFetch(state: FakeStore) {
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    state.calls.push({ path: `${url.pathname}${url.search}`, auth: new Headers(init?.headers).get('authorization') });
    if (state.limited) return json({ message: 'API rate limit exceeded' }, 403, url);

    const tags = /^\/repos\/([^/]+\/[^/]+)\/tags$/.exec(url.pathname);
    if (tags) {
      if (`${tags[1]}` !== REPO) return notFound(url);
      const page = Number(url.searchParams.get('page') ?? '1');
      const size = Number(url.searchParams.get('per_page') ?? '30');
      return json(
        state.tags.slice((page - 1) * size, page * size).map((name) => ({ name })),
        200,
        url,
      );
    }

    const refs = /^\/repos\/([^/]+\/[^/]+)\/git\/matching-refs\/tags\/(.+)$/.exec(url.pathname);
    if (refs) {
      if (`${refs[1]}` !== REPO) return notFound(url);
      const prefix = refs[2]!;
      return json(
        state.tags.filter((t) => t.startsWith(prefix)).map((t) => ({ ref: `refs/tags/${t}` })),
        200,
        url,
      );
    }

    const release = /^\/repos\/([^/]+\/[^/]+)\/releases\/tags\/(.+)$/.exec(url.pathname);
    if (release) {
      if (`${release[1]}` !== REPO) return notFound(url);
      const tag = decodeURIComponent(release[2]!);
      const rel = state.releases[tag];
      if (!rel) return notFound(url);
      const game = tag.slice(0, tag.lastIndexOf('-v'));
      const assets: { name: string; url: string; size: number }[] = [
        {
          name: `${game}.phgame`,
          url: `https://api.github.com/repos/${REPO}/releases/assets/${tag}/archive`,
          size: rel.archive.length,
        },
      ];
      if (rel.sha !== null) {
        assets.push({
          name: `${game}.phgame.sha256`,
          url: `https://api.github.com/repos/${REPO}/releases/assets/${tag}/sha`,
          size: 80,
        });
      }
      return json({ tag_name: tag, assets }, 200, url);
    }

    const asset = /^\/repos\/([^/]+\/[^/]+)\/releases\/assets\/(.+)\/(archive|sha)$/.exec(url.pathname);
    if (asset) {
      const rel = state.releases[decodeURIComponent(asset[2]!)];
      if (!rel) return notFound(url);
      if (asset[3] === 'archive') return reply(rel.archive, 200, url, 'application/octet-stream');
      if (rel.sha === null) return notFound(url);
      return reply(`${rel.sha}  jeu.phgame\n`, 200, url, 'text/plain');
    }

    const contents = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(url.pathname);
    if (contents) {
      if (`${contents[1]}` !== REPO) return notFound(url);
      const ref = url.searchParams.get('ref') ?? '';
      const filePath = contents[2]!
        .split('/')
        .map((part) => decodeURIComponent(part))
        .join('/');
      const bytes = state.files[`${ref}|${filePath}`];
      if (!bytes) return notFound(url);
      return json(
        { type: 'file', encoding: 'base64', size: bytes.length, content: Buffer.from(bytes).toString('base64') },
        200,
        url,
      );
    }

    return notFound(url);
  };
  return fetchFn as unknown as typeof fetch;
}

interface PublishOptions {
  name?: string;
  module?: string;
  cover?: string;
  coverBytes?: Uint8Array;
  manifestText?: string;
  archive?: Uint8Array;
  /** Empreinte publiée ; undefined = empreinte exacte ; null = pas de fichier .sha256. */
  sha?: string | null;
}

/** Publie une version : tag, manifeste, couverture éventuelle et release avec son paquet. */
function publish(state: FakeStore, id: string, version: string, options: PublishOptions = {}): void {
  const tag = `${id}-v${version}`;
  state.tags.push(tag);
  const manifest = {
    id,
    name: options.name ?? 'Frontières',
    description: 'Un jeu de test.',
    author: 'Équipe test',
    requires: { modules: [options.module ?? 'cards'] },
    ...(options.cover ? { cover: options.cover } : {}),
  };
  state.files[`${tag}|jeux/${id}/manifest.json`] = enc(options.manifestText ?? JSON.stringify(manifest));
  if (options.cover) state.files[`${tag}|jeux/${id}/${options.cover}`] = options.coverBytes ?? tinyPng(300, 200);
  const archive = options.archive ?? buildPackage({ id, version });
  state.releases[tag] = { archive, sha: options.sha === undefined ? sha(archive) : options.sha };
}

let dir: string;
let store: Store;
let packages: PackageService;
let state: FakeStore;
let now: number;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ph-magasin-'));
  store = new Store(path.join(dir, 'partyhub.db'));
  packages = new PackageService(store, dir);
  state = emptyStore();
  now = Date.parse('2026-10-19T10:00:00Z');
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function service(options: Partial<StoreServiceOptions> = {}, token?: string) {
  const fetch = fakeFetch(state);
  const sources = new PackageSourceService(store, packages, { fetch, token });
  const gameStore = new StoreService(store, sources, packages, {
    defaultRepo: REPO,
    token,
    fetch,
    isBuiltin: () => false,
    now: () => now,
    ...options,
  });
  return { gameStore, sources };
}

describe('lecture du dépôt de jeux', () => {
  it('liste chaque jeu à sa version la plus haute, avec sa fiche', async () => {
    publish(state, 'frontieres', '1.9.0');
    publish(state, 'frontieres', '1.10.0');
    publish(state, 'plateau-x', '2.0.0', { module: 'board', cover: 'assets/couverture.png' });
    publish(state, 'cartes-coco', '1.0.0');
    state.tags.push('pas-une-version', 'Majuscule-v1.0.0');
    const { gameStore } = service();

    const catalog = await gameStore.catalog(true);
    expect(catalog.error).toBeNull();
    expect(catalog.games.map((g) => g.id)).toEqual(['cartes-coco', 'frontieres', 'plateau-x']);
    expect(catalog.games[1]).toMatchObject({
      id: 'frontieres',
      latestVersion: '1.10.0',
      tag: 'frontieres-v1.10.0',
      name: 'Frontières',
      moduleLabel: 'Jeu de cartes',
      status: 'non_installe',
      builtin: false,
      error: null,
    });
    expect(catalog.games[2]).toMatchObject({ moduleLabel: 'Jeu de plateau', hasCover: true });
  });

  it('lit toutes les pages de tags, pas seulement la première', async () => {
    for (let i = 0; i < 100; i++) state.tags.push(`notes-${i}`);
    publish(state, 'tardif', '1.0.0');
    const { gameStore } = service();

    const catalog = await gameStore.catalog(true);
    expect(catalog.games.map((g) => g.id)).toEqual(['tardif']);
  });

  it('garde le jeu listé avec son erreur, et ne garde pas l’erreur en mémoire', async () => {
    publish(state, 'casse', '1.0.0', {
      manifestText: JSON.stringify({ id: 'autre', name: 'Autre', requires: { modules: ['cards'] } }),
    });
    const { gameStore } = service();

    let catalog = await gameStore.catalog(true);
    expect(catalog.games[0]).toMatchObject({ id: 'casse', error: 'Le manifeste annonce « autre », pas « casse ».' });

    state.files['casse-v1.0.0|jeux/casse/manifest.json'] = enc(
      JSON.stringify({ id: 'casse', name: 'Casse', requires: { modules: ['cards'] } }),
    );
    catalog = await gameStore.catalog(true);
    expect(catalog.games[0]).toMatchObject({ name: 'Casse', error: null });
  });

  it('ignore une couverture hors des chemins et formats admis', async () => {
    publish(state, 'jeu-a', '1.0.0', { cover: 'assets/../secret.png' });
    publish(state, 'jeu-b', '1.0.0', { cover: 'assets/anime.gif', coverBytes: tinyPng(10, 10) });
    const { gameStore } = service();

    const catalog = await gameStore.catalog(true);
    expect(catalog.games.map((g) => g.hasCover)).toEqual([false, false]);
    expect(await gameStore.cover('jeu-b')).toBeNull();
  });

  it('signale une limite de requêtes GitHub sans la garder', async () => {
    publish(state, 'frontieres', '1.0.0');
    const { gameStore } = service();

    state.limited = true;
    let catalog = await gameStore.catalog(true);
    expect(catalog.error).toContain('limite de requêtes');
    expect(catalog.games).toEqual([]);

    state.limited = false;
    catalog = await gameStore.catalog(true);
    expect(catalog.error).toBeNull();
    expect(catalog.games).toHaveLength(1);
  });

  it('ne lit le dépôt qu’une fois pour des demandes simultanées (couvertures chargées ensemble)', async () => {
    publish(state, 'frontieres', '1.0.0');
    const { gameStore } = service();
    const listings = () => state.calls.filter((c) => c.path.includes('/tags?')).length;

    await Promise.all([gameStore.catalog(), gameStore.catalog(), gameStore.cover('frontieres'), gameStore.catalog()]);
    expect(listings()).toBe(1);
  });

  it('garde le catalogue dix minutes, puis le relit', async () => {
    publish(state, 'frontieres', '1.0.0');
    const { gameStore } = service();
    const listings = () => state.calls.filter((c) => c.path.includes('/tags?')).length;

    await gameStore.catalog();
    await gameStore.catalog();
    expect(listings()).toBe(1);

    now += 11 * 60 * 1000;
    await gameStore.catalog();
    expect(listings()).toBe(2);
  });

  it('n’expose jamais le jeton GitHub, mais l’envoie à GitHub', async () => {
    publish(state, 'frontieres', '1.0.0');
    const { gameStore } = service({}, TOKEN);

    const catalog = await gameStore.catalog(true);
    expect(JSON.stringify(catalog)).not.toContain(TOKEN);
    expect(catalog.tokenConfigured).toBe(true);
    expect(state.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });
});

describe('installation, mise à jour et suppression', () => {
  it('installe un jeu avec mise à jour automatique', async () => {
    publish(state, 'frontieres', '1.0.0');
    const { gameStore, sources } = service();

    expect(await gameStore.install('frontieres')).toEqual({ ok: true, status: 'installé', version: '1.0.0' });
    expect(sources.list()).toEqual([
      expect.objectContaining({ repo: `${REPO}/frontieres`, autoUpdate: true, packageId: 'frontieres' }),
    ]);
    expect(packages.get('frontieres')?.version).toBe('1.0.0');
    expect((await gameStore.catalog(true)).games[0]).toMatchObject({
      status: 'a_jour',
      installedVersion: '1.0.0',
      autoUpdate: true,
    });
  });

  it('signale une version plus récente, puis la met à jour', async () => {
    publish(state, 'frontieres', '1.0.0');
    const { gameStore } = service();
    await gameStore.install('frontieres');

    publish(state, 'frontieres', '1.1.0');
    expect((await gameStore.catalog(true)).games[0]?.status).toBe('mise_a_jour');

    expect(await gameStore.update('frontieres')).toEqual({ ok: true, status: 'mis à jour', version: '1.1.0' });
    expect((await gameStore.catalog(true)).games[0]).toMatchObject({ status: 'a_jour', installedVersion: '1.1.0' });
  });

  it('supprime le paquet et sa source, et ferme les salles qui le jouent', async () => {
    publish(state, 'frontieres', '1.0.0');
    const { gameStore, sources } = service();
    await gameStore.install('frontieres');

    const closed: string[] = [];
    const result = gameStore.uninstall('frontieres', (gameId) => {
      closed.push(gameId);
      return 2;
    });

    expect(result).toEqual({ ok: true, closedRooms: 2 });
    // Les salles se ferment sur l’identifiant de jeu du paquet (préfixe pkg- pour un jeu de cartes).
    expect(closed).toEqual(['pkg-frontieres']);
    expect(packages.list()).toEqual([]);
    expect(sources.list()).toEqual([]);
    expect((await gameStore.catalog(true)).games[0]?.status).toBe('non_installe');
  });

  it('ne supprime que ce qui vient du magasin', () => {
    const { gameStore } = service();
    expect(gameStore.uninstall('frontieres', () => 0)).toEqual({
      ok: false,
      error: 'Ce jeu n’est pas installé depuis le magasin.',
      notFound: true,
    });
  });

  it('refuse un jeu déjà intégré à l’application', async () => {
    publish(state, 'cartes-couleurs', '1.0.0');
    const { gameStore, sources } = service({ isBuiltin: (id) => id === 'cartes-couleurs' });

    const outcome = await gameStore.install('cartes-couleurs');
    expect(outcome).toEqual({ ok: false, error: 'Ce jeu est déjà intégré à l’application : rien à télécharger.' });
    expect(sources.list()).toEqual([]);
    expect((await gameStore.catalog(true)).games[0]?.status).toBe('integre');
  });

  it('refuse une empreinte qui ne correspond pas, sans rien laisser sur le serveur', async () => {
    publish(state, 'frontieres', '1.0.0', { sha: 'f'.repeat(64) });
    const { gameStore, sources } = service();

    const outcome = await gameStore.install('frontieres');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.error).toContain('empreinte');
    expect(packages.list()).toEqual([]);
    expect(sources.list()).toEqual([]);
  });

  it('refuse un identifiant de jeu invalide', async () => {
    const { gameStore, sources } = service();
    expect(await gameStore.install('../secret')).toEqual({ ok: false, error: 'Identifiant de jeu invalide.' });
    expect(sources.list()).toEqual([]);
  });
});

describe('dépôt choisi', () => {
  it('accepte un dépôt valide, le garde, et refuse les autres', () => {
    const { gameStore } = service();
    expect(gameStore.setRepo('pas un depot').ok).toBe(false);
    expect(gameStore.setRepo('../x').ok).toBe(false);
    expect(gameStore.setRepo('auteur/autre')).toEqual({ ok: true, repo: 'auteur/autre' });
    expect(store.getKv('store_repo')).toBe('auteur/autre');
    expect(gameStore.repo).toBe('auteur/autre');
  });

  it('utilise le dépôt de la configuration tant que rien n’a été choisi', () => {
    const { gameStore } = service({ defaultRepo: 'auteur/config' });
    expect(gameStore.repo).toBe('auteur/config');
  });
});

describe('couvertures', () => {
  it('sert une couverture qui est bien une image', async () => {
    publish(state, 'plateau-x', '1.0.0', { module: 'board', cover: 'assets/couverture.png' });
    const { gameStore } = service();

    const image = await gameStore.cover('plateau-x');
    expect(image?.contentType).toBe('image/png');
    expect(image?.bytes.length).toBeGreaterThan(0);
  });

  it('refuse une couverture qui n’est pas une image', async () => {
    publish(state, 'plateau-x', '1.0.0', { cover: 'assets/couverture.png', coverBytes: enc('pas une image') });
    const { gameStore } = service();
    expect(await gameStore.cover('plateau-x')).toBeNull();
  });

  it('refuse une couverture au-delà de la taille autorisée', async () => {
    const big = new Uint8Array(COVER_MAX_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47], 0);
    publish(state, 'plateau-x', '1.0.0', { cover: 'assets/couverture.png', coverBytes: big });
    const { gameStore } = service();
    expect(await gameStore.cover('plateau-x')).toBeNull();
  });
});

/** Remplace la version d'un jeu de code, dans manifest.json et dans le manifeste du module (qui doivent rester égaux). */
function bumpVersion(dir: string, version: string): void {
  for (const rel of ['manifest.json', 'src/server.ts']) {
    const file = path.join(dir, rel);
    const text = readFileSync(file, 'utf8');
    const next = text.replace(/((?:"version": ")|(?:version: '))\d+\.\d+\.\d+/, `$1${version}`);
    if (next === text) throw new Error(`Version introuvable dans ${rel}.`);
    writeFileSync(file, next);
  }
}

describe('jeux de code dans le magasin', { timeout: 30_000 }, () => {
  const CODE_ID = 'magasin-code';
  const author = generateSigningKeys();
  let codeV1: Uint8Array;
  let codeV2: Uint8Array;

  beforeAll(async () => {
    const work = mkdtempSync(path.join(os.tmpdir(), 'ph-magasin-code-'));
    const v1 = path.join(work, CODE_ID);
    newCodeGame(v1, { id: CODE_ID, name: 'Magasin code', author: 'Équipe test' });
    const v2 = path.join(work, 'v2');
    cpSync(v1, v2, { recursive: true });
    bumpVersion(v1, '1.0.0');
    bumpVersion(v2, '1.1.0');
    codeV1 = (await buildCodePackage(v1, author.privatePem)).bytes;
    codeV2 = (await buildCodePackage(v2, author.privatePem)).bytes;
    rmSync(work, { recursive: true, force: true });
  }, 120_000);

  /** Fiche du dépôt pour un jeu de code : `kind: "code"`, sans modules déclaratifs. */
  const codeManifest = () =>
    JSON.stringify({
      id: CODE_ID,
      name: 'Magasin code',
      description: 'Un jeu de code de test.',
      author: 'Équipe test',
      kind: 'code',
    });

  const publishCode = (version: string, archive: Uint8Array) =>
    publish(state, CODE_ID, version, { manifestText: codeManifest(), archive });

  /** La clé de l'auteur est une clé de confiance de cette installation : sans elle, le paquet est refusé. */
  const trustAuthor = () => {
    mkdirSync(path.join(dir, 'cles-de-confiance'), { recursive: true });
    writeFileSync(path.join(dir, 'cles-de-confiance', `${author.keyId}.pub.pem`), author.publicPem);
  };

  function codeService() {
    const fetch = fakeFetch(state);
    const codes = new CodeGameService(store, dir, { trustedKeys: () => loadTrustedKeys(dir).keys });
    const sources = new PackageSourceService(store, packages, { fetch, code: codes });
    const gameStore = new StoreService(store, sources, packages, {
      defaultRepo: REPO,
      fetch,
      isBuiltin: () => false,
      now: () => now,
      code: codes,
    });
    return { gameStore, sources, codes };
  }

  it('installe un jeu de code en attente de revue, sans l’activer', async () => {
    trustAuthor();
    publishCode('1.0.0', codeV1);
    const { gameStore, codes } = codeService();

    expect(await gameStore.install(CODE_ID)).toEqual({ ok: true, status: 'en attente de revue', version: '1.0.0' });
    expect(codes.list()).toEqual([expect.objectContaining({ id: CODE_ID, version: '1.0.0', status: 'en_attente' })]);
    expect((await gameStore.catalog(true)).games[0]).toMatchObject({
      status: 'en_revue',
      pendingVersion: '1.0.0',
      installedVersion: null,
      moduleLabel: 'Jeu de code',
    });
  });

  it('une fois approuvé dans « Jeux de code », le jeu est à jour dans le magasin', async () => {
    trustAuthor();
    publishCode('1.0.0', codeV1);
    const { gameStore, codes } = codeService();
    await gameStore.install(CODE_ID);

    expect(await codes.approve(CODE_ID, '1.0.0', codes.list()[0]!.sha256, 'test')).toMatchObject({ ok: true });
    expect((await gameStore.catalog(true)).games[0]).toMatchObject({
      status: 'a_jour',
      installedVersion: '1.0.0',
      pendingVersion: null,
    });
  });

  it('une nouvelle version attend sa revue, et l’ancienne reste active entre-temps', async () => {
    trustAuthor();
    publishCode('1.0.0', codeV1);
    const { gameStore, codes } = codeService();
    await gameStore.install(CODE_ID);
    await codes.approve(CODE_ID, '1.0.0', codes.list()[0]!.sha256, 'test');

    publishCode('1.1.0', codeV2);
    expect((await gameStore.catalog(true)).games[0]).toMatchObject({
      status: 'mise_a_jour',
      installedVersion: '1.0.0',
    });

    expect(await gameStore.update(CODE_ID)).toEqual({ ok: true, status: 'en attente de revue', version: '1.1.0' });
    expect((await gameStore.catalog(true)).games[0]).toMatchObject({
      status: 'en_revue',
      installedVersion: '1.0.0',
      pendingVersion: '1.1.0',
    });
    // Une nouvelle vérification ne réinstalle pas la version qui attend déjà.
    expect(await gameStore.update(CODE_ID)).toEqual({ ok: true, status: 'à jour', version: '1.1.0' });
    expect(
      codes
        .list()
        .map((row) => `${row.version}:${row.status}`)
        .sort(),
    ).toEqual(['1.0.0:active', '1.1.0:en_attente']);
  });

  it('refuse un jeu de code qu’aucune clé de confiance ne signe, sans rien laisser sur le serveur', async () => {
    publishCode('1.0.0', codeV1);
    const { gameStore, sources, codes } = codeService();

    expect((await gameStore.install(CODE_ID)).ok).toBe(false);
    expect(codes.list()).toEqual([]);
    expect(sources.list()).toEqual([]);
    expect((await gameStore.catalog(true)).games[0]?.status).toBe('non_installe');
  });

  it('retire un jeu de code du magasin : toutes ses versions, en attente ou non, et sa source', async () => {
    trustAuthor();
    publishCode('1.0.0', codeV1);
    const { gameStore, sources, codes } = codeService();
    await gameStore.install(CODE_ID);
    await codes.approve(CODE_ID, '1.0.0', codes.list()[0]!.sha256, 'test');
    publishCode('1.1.0', codeV2);
    await gameStore.update(CODE_ID);

    const closed: string[] = [];
    const result = gameStore.uninstall(CODE_ID, (gameId) => {
      closed.push(gameId);
      return 1;
    });

    expect(result).toEqual({ ok: true, closedRooms: 1 });
    expect(closed).toEqual([CODE_ID]);
    expect(codes.list()).toEqual([]);
    expect(sources.list()).toEqual([]);
    expect((await gameStore.catalog(true)).games[0]?.status).toBe('non_installe');
  });

  it('réinstalle un jeu de code retiré depuis « Jeux de code », au lieu de le croire toujours présent', async () => {
    trustAuthor();
    publishCode('1.0.0', codeV1);
    const { gameStore, codes } = codeService();
    await gameStore.install(CODE_ID);

    expect(codes.remove(CODE_ID, '1.0.0', 'test')).toEqual({ ok: true });
    expect((await gameStore.catalog(true)).games[0]?.status).toBe('non_installe');

    expect(await gameStore.install(CODE_ID)).toEqual({ ok: true, status: 'en attente de revue', version: '1.0.0' });
    expect(codes.list()).toEqual([expect.objectContaining({ id: CODE_ID, status: 'en_attente' })]);
  });
});
