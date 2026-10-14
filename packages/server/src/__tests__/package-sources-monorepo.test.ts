import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { PackageService } from '../packages/service.js';
import { PackageSourceService } from '../sources/service.js';
import { parseSource } from '../sources/github.js';
import { buildPackage } from './helpers/package-kit.js';

/** Un dépôt commun : plusieurs jeux, chacun avec ses versions taguées `<jeu>-vX.Y.Z`. */
interface GameRelease {
  version: string;
  /** Identifiant écrit dans le manifeste ; par défaut, celui du jeu. */
  id?: string;
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function response(body: BodyInit, status: number, url: string, type: string): Response {
  const res = new Response(body as any, { status, headers: { 'content-type': type } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

/** Faux client GitHub pour un dépôt commun, avec les routes que la source utilise réellement. */
function fakeMonorepo(repo: string, games: Record<string, GameRelease[]>) {
  const archives = new Map<string, Uint8Array>();
  for (const [game, releases] of Object.entries(games)) {
    for (const r of releases) {
      archives.set(`${game}@${r.version}`, buildPackage({ id: r.id ?? game, version: r.version }));
    }
  }
  const tags = Object.entries(games).flatMap(([game, releases]) => releases.map((r) => `${game}-v${r.version}`));
  const fetchFn = async (input: string | URL | Request) => {
    const url = String(input);
    const base = `https://api.github.com/repos/${repo}`;
    if (!url.startsWith(base)) return response('{"message":"Not Found"}', 404, url, 'application/json');
    const rest = url.slice(base.length);

    const matching = /^\/git\/matching-refs\/tags\/(.+)$/.exec(rest);
    if (matching) {
      const prefix = matching[1]!;
      const refs = tags.filter((t) => t.startsWith(prefix)).map((t) => ({ ref: `refs/tags/${t}` }));
      return response(JSON.stringify(refs), 200, url, 'application/json');
    }

    const tag = /^\/releases\/tags\/(.+)-v(.+)$/.exec(rest);
    if (tag) {
      const [, game, version] = tag as unknown as [string, string, string];
      if (!archives.has(`${game}@${version}`)) return response('{}', 404, url, 'application/json');
      const archive = archives.get(`${game}@${version}`)!;
      const assets = [
        { name: `${game}.phgame`, url: `${base}/releases/assets/${game}@${version}/archive`, size: archive.length },
        { name: `${game}.phgame.sha256`, url: `${base}/releases/assets/${game}@${version}/sha`, size: 80 },
      ];
      return response(JSON.stringify({ tag_name: `${game}-v${version}`, assets }), 200, url, 'application/json');
    }

    const asset = /^\/releases\/assets\/(.+)@(.+)\/(archive|sha)$/.exec(rest);
    if (asset) {
      const [, game, version, kind] = asset as unknown as [string, string, string, string];
      const archive = archives.get(`${game}@${version}`);
      if (!archive) return response('{}', 404, url, 'application/json');
      if (kind === 'archive') {
        return response(archive, 200, 'https://objects.githubusercontent.com/archive', 'application/octet-stream');
      }
      return response(`${sha(archive)}  ${game}.phgame\n`, 200, url, 'text/plain');
    }

    return response('{"message":"Not Found"}', 404, url, 'application/json');
  };
  return { fetch: fetchFn as unknown as typeof fetch };
}

let dir: string;
let store: Store;
let packages: PackageService;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ph-monorepo-'));
  store = new Store(path.join(dir, 'partyhub.db'));
  packages = new PackageService(store, dir);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('formes de source', () => {
  it('reconnaît un dépôt dédié et un dépôt commun', () => {
    expect(parseSource('auteur/jeu')).toEqual({ repo: 'auteur/jeu', game: null });
    expect(parseSource('auteur/jeux/frontieres')).toEqual({ repo: 'auteur/jeux', game: 'frontieres' });
  });

  it('refuse les formes invalides', () => {
    for (const value of ['auteur/jeux/Mon_Jeu', 'auteur/jeux/a/b', 'auteur/jeux/a', 'auteur/jeux/', '../x/y']) {
      expect(parseSource(value), value).toBeNull();
    }
  });

  it('accepte deux sources différentes dans le même dépôt, mais pas deux fois la même', () => {
    const service = new PackageSourceService(store, packages);
    expect(service.add({ repo: 'auteur/jeux/frontieres' }).ok).toBe(true);
    expect(service.add({ repo: 'auteur/jeux/tresor' }).ok).toBe(true);
    expect(service.add({ repo: 'auteur/jeux/frontieres' })).toEqual({ ok: false, error: 'Cette source existe déjà.' });
  });
});

describe('dépôt commun', () => {
  it('installe la version la plus haute du jeu demandé, en comparant les versions et non le texte', async () => {
    const github = fakeMonorepo('auteur/jeux', {
      frontieres: [{ version: '1.9.0' }, { version: '1.10.0' }, { version: '1.2.0' }],
    });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeux/frontieres' }) as { ok: true; id: string };

    expect(await service.check(id)).toEqual({ ok: true, status: 'installé', version: '1.10.0' });
    expect(packages.get('frontieres')).toMatchObject({ version: '1.10.0', gameId: 'pkg-frontieres' });
    expect(service.list()[0]).toMatchObject({ repo: 'auteur/jeux/frontieres', packageId: 'frontieres', installedVersion: '1.10.0' });
  });

  it('gère plusieurs jeux du même dépôt indépendamment', async () => {
    const github = fakeMonorepo('auteur/jeux', {
      frontieres: [{ version: '1.0.0' }],
      tresor: [{ version: '2.3.0' }],
    });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const a = (service.add({ repo: 'auteur/jeux/frontieres' }) as { ok: true; id: string }).id;
    const b = (service.add({ repo: 'auteur/jeux/tresor' }) as { ok: true; id: string }).id;

    expect((await service.check(a)).ok).toBe(true);
    expect((await service.check(b)).ok).toBe(true);
    expect(packages.list().map((p) => p.id).sort()).toEqual(['frontieres', 'tresor']);
  });

  it('ignore les tags d’un autre jeu dont le nom commence par le même texte', async () => {
    const github = fakeMonorepo('auteur/jeux', {
      frontieres: [{ version: '1.0.0' }],
      'frontieres-vert': [{ version: '9.0.0' }],
    });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeux/frontieres' }) as { ok: true; id: string };

    expect(await service.check(id)).toEqual({ ok: true, status: 'installé', version: '1.0.0' });
  });

  it('refuse un jeu sans aucune version publiée', async () => {
    const github = fakeMonorepo('auteur/jeux', { tresor: [{ version: '1.0.0' }] });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeux/absent' }) as { ok: true; id: string };

    const outcome = await service.check(id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('Aucune version publiée pour « absent »');
  });

  it('refuse un paquet qui ne correspond pas au jeu du dépôt commun', async () => {
    const github = fakeMonorepo('auteur/jeux', { frontieres: [{ version: '1.0.0', id: 'autre-jeu' }] });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeux/frontieres' }) as { ok: true; id: string };

    const outcome = await service.check(id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('s’appelle « frontieres »');
    expect(packages.get('autre-jeu')).toBeUndefined();
  });
});
