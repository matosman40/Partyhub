import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { PackageService } from '../packages/service.js';
import { PackageSourceService } from '../sources/service.js';
import { buildPackage } from './helpers/package-kit.js';

const TOKEN = 'ghp_secret_de_test_0123456789';

interface RepoState {
  tag: string;
  archive: Uint8Array;
  /** Empreinte publiée dans le fichier .sha256 ; null = fichier absent de la release. */
  sha: string | null;
  /** Hôte final simulé pour le téléchargement (test de redirection). */
  finalHost?: string;
  status?: number;
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Faux client GitHub : répond aux routes de releases et d'assets pour les dépôts déclarés. */
function fakeGitHub(repos: Record<string, RepoState>) {
  const calls: { url: string; auth?: string }[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get('authorization') ?? undefined });
    const latest = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/latest$/.exec(url);
    const asset = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/assets\/(\d)$/.exec(url);
    const repo = latest?.[1] ?? asset?.[1] ?? '';
    const state = repos[repo];
    if (!state) return response('{"message":"Not Found"}', 404, 'https://api.github.com/x', 'application/json');
    if (state.status) return response('{}', state.status, url, 'application/json');
    if (latest) {
      const assets = [
        {
          name: 'jeu.phgame',
          url: `https://api.github.com/repos/${repo}/releases/assets/1`,
          size: state.archive.length,
        },
      ];
      if (state.sha !== null) {
        assets.push({
          name: 'jeu.phgame.sha256',
          url: `https://api.github.com/repos/${repo}/releases/assets/2`,
          size: 80,
        });
      }
      return response(JSON.stringify({ tag_name: state.tag, assets }), 200, url, 'application/json');
    }
    if (asset?.[2] === '1') {
      return response(
        state.archive,
        200,
        `https://${state.finalHost ?? 'objects.githubusercontent.com'}/archive`,
        'application/octet-stream',
      );
    }
    return response(`${state.sha ?? ''}  jeu.phgame\n`, 200, url, 'text/plain');
  };
  return { fetch: fetchFn as unknown as typeof fetch, calls };
}

function response(body: BodyInit, status: number, url: string, type: string): Response {
  const res = new Response(body as any, { status, headers: { 'content-type': type } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

let dir: string;
let store: Store;
let packages: PackageService;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ph-sources-'));
  store = new Store(path.join(dir, 'partyhub.db'));
  packages = new PackageService(store, dir);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function repoState(version: string, id = 'mon-jeu', overrides: Partial<RepoState> = {}): RepoState {
  const archive = buildPackage({ id, version });
  return { tag: `v${version}`, archive, sha: sha(archive), ...overrides };
}

describe('ajout d’une source', () => {
  it('refuse un nom de dépôt invalide', () => {
    const service = new PackageSourceService(store, packages);
    for (const repo of ['../x', 'auteur', 'a/b/c', 'auteur/..', '']) {
      expect(service.add({ repo }).ok).toBe(false);
    }
  });

  it('refuse un dépôt privé quand GITHUB_TOKEN n’est pas configuré', () => {
    const service = new PackageSourceService(store, packages);
    expect(service.add({ repo: 'auteur/prive', private: true })).toEqual({
      ok: false,
      error: 'Un dépôt privé demande GITHUB_TOKEN dans la configuration du serveur.',
    });
  });

  it('refuse une source déjà ajoutée', () => {
    const service = new PackageSourceService(store, packages);
    expect(service.add({ repo: 'auteur/jeu' }).ok).toBe(true);
    expect(service.add({ repo: 'auteur/jeu' })).toEqual({ ok: false, error: 'Cette source existe déjà.' });
  });

  it('ne laisse jamais voir le jeton dans la liste', () => {
    const service = new PackageSourceService(store, packages, { token: TOKEN });
    service.add({ repo: 'auteur/prive', private: true });
    expect(JSON.stringify(service.list())).not.toContain(TOKEN);
    expect(service.tokenConfigured).toBe(true);
  });
});

describe('installation et mise à jour depuis une release', () => {
  it('installe la dernière release, vérifiée par son empreinte', async () => {
    const github = fakeGitHub({ 'auteur/jeu': repoState('1.0.0') });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };

    const outcome = await service.check(id);
    expect(outcome).toEqual({ ok: true, status: 'installé', version: '1.0.0' });
    expect(packages.get('mon-jeu')?.version).toBe('1.0.0');
    expect(service.list()[0]).toMatchObject({ packageId: 'mon-jeu', installedVersion: '1.0.0', lastError: null });
  });

  it('ne retélécharge pas une version déjà installée', async () => {
    const github = fakeGitHub({ 'auteur/jeu': repoState('1.0.0') });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    await service.check(id);
    const downloads = github.calls.filter((c) => c.url.includes('/assets/1')).length;

    expect(await service.check(id)).toEqual({ ok: true, status: 'à jour', version: '1.0.0' });
    expect(github.calls.filter((c) => c.url.includes('/assets/1')).length).toBe(downloads);
  });

  it('remplace l’ancienne version quand la release est plus récente', async () => {
    const state = repoState('1.0.0');
    const github = fakeGitHub({ 'auteur/jeu': state });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    await service.check(id);

    const next = repoState('1.1.0');
    github.calls.length = 0;
    state.tag = next.tag;
    state.archive = next.archive;
    state.sha = next.sha;
    expect(await service.check(id)).toEqual({ ok: true, status: 'mis à jour', version: '1.1.0' });
    expect(packages.get('mon-jeu')?.version).toBe('1.1.0');
  });

  it('refuse un fichier dont l’empreinte ne correspond pas', async () => {
    const github = fakeGitHub({ 'auteur/jeu': repoState('1.0.0', 'mon-jeu', { sha: '0'.repeat(64) }) });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };

    const outcome = await service.check(id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('empreinte');
    expect(packages.get('mon-jeu')).toBeUndefined();
  });

  it('refuse une release sans fichier .sha256', async () => {
    const github = fakeGitHub({ 'auteur/jeu': repoState('1.0.0', 'mon-jeu', { sha: null }) });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    const outcome = await service.check(id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('.sha256');
  });

  it('refuse un tag qui ne correspond pas à la version du fichier', async () => {
    const state = repoState('1.0.0');
    state.tag = 'v2.0.0';
    const github = fakeGitHub({ 'auteur/jeu': state });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    const outcome = await service.check(id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('annonce la version 1.0.0');
  });

  it('refuse un paquet installé depuis une autre source ou manuellement', async () => {
    const github = fakeGitHub({
      'auteur/jeu': repoState('1.0.0', 'mon-jeu'),
      'autre/copie': repoState('1.0.0', 'mon-jeu'),
    });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const first = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    const second = service.add({ repo: 'autre/copie' }) as { ok: true; id: string };
    expect((await service.check(first.id)).ok).toBe(true);

    const outcome = await service.check(second.id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('pas lié à cette source');
  });

  it('refuse une redirection vers un site non autorisé', async () => {
    const github = fakeGitHub({ 'auteur/jeu': repoState('1.0.0', 'mon-jeu', { finalHost: 'evil.example.com' }) });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    const outcome = await service.check(id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('non autorisé');
  });

  it('signale un dépôt introuvable', async () => {
    const service = new PackageSourceService(store, packages, { fetch: fakeGitHub({}).fetch });
    const { id } = service.add({ repo: 'auteur/absent' }) as { ok: true; id: string };
    const outcome = await service.check(id);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('introuvable');
    expect(service.list()[0]?.lastError).toContain('introuvable');
  });
});

describe('dépôts privés et jeton', () => {
  it('envoie le jeton à GitHub pour un dépôt privé', async () => {
    const github = fakeGitHub({ 'auteur/prive': repoState('1.0.0') });
    const service = new PackageSourceService(store, packages, { token: TOKEN, fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/prive', private: true }) as { ok: true; id: string };
    expect((await service.check(id)).ok).toBe(true);
    expect(github.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('refuse un passage en dépôt privé sans jeton', () => {
    const service = new PackageSourceService(store, packages);
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    expect(service.update(id, { private: true }).ok).toBe(false);
  });
});

describe('réglages et suppression', () => {
  it('met à jour la mise à jour automatique et signale une source inconnue', () => {
    const service = new PackageSourceService(store, packages);
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    expect(service.update(id, { autoUpdate: true })).toEqual({ ok: true });
    expect(service.list()[0]?.autoUpdate).toBe(true);
    expect(service.update('src-absent', { autoUpdate: true })).toMatchObject({ ok: false, notFound: true });
  });

  it('vérifie seulement les sources à mise à jour automatique', async () => {
    const github = fakeGitHub({ 'auteur/a': repoState('1.0.0', 'jeu-a'), 'auteur/b': repoState('1.0.0', 'jeu-b') });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    service.add({ repo: 'auteur/a', autoUpdate: true });
    service.add({ repo: 'auteur/b', autoUpdate: false });
    const results = await service.checkAll(true);
    expect(results.map((r) => r.repo)).toEqual(['auteur/a']);
    expect(packages.get('jeu-a')).toBeDefined();
    expect(packages.get('jeu-b')).toBeUndefined();
  });

  it('supprimer une source garde le paquet installé', async () => {
    const github = fakeGitHub({ 'auteur/jeu': repoState('1.0.0') });
    const service = new PackageSourceService(store, packages, { fetch: github.fetch });
    const { id } = service.add({ repo: 'auteur/jeu' }) as { ok: true; id: string };
    await service.check(id);
    expect(service.remove(id)).toBe(true);
    expect(service.list()).toEqual([]);
    expect(packages.get('mon-jeu')?.version).toBe('1.0.0');
  });
});
