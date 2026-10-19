import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gameRegistry } from '@partyhub/games';
import { keygen, newCodeGame, packCode } from '../cli/code-game.js';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { TRUST_DIR_NAME } from '../code-games/service.js';

/**
 * Jeux de code de bout en bout, par l'API d'administration : installation signée, revue, approbation,
 * publication au catalogue, rechargement après redémarrage, et refus d'une archive altérée.
 */

const ADMIN_PASSWORD = 'jeux-de-code-123';
const ID = 'pile-essai';

let work: string;
let dataDir: string;
let config: AppConfig;
let server: PartyServer;
let base: string;
let cookie: string;

async function call(route: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { cookie, ...((init.headers as Record<string, string>) ?? {}) };
  const res = await fetch(`${base}${route}`, { ...init, headers });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

async function start(): Promise<void> {
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

/** Donne une version au jeu : manifest.json et src/server.ts doivent l'annoncer ensemble. */
function setVersion(src: string, version: string): void {
  const manifestFile = path.join(src, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
  manifest.version = version;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const serverFile = path.join(src, 'src', 'server.ts');
  const server = fs.readFileSync(serverFile, 'utf8').replace(/version: '[^']*'/, `version: '${version}'`);
  fs.writeFileSync(serverFile, server);
}

/** Construit un paquet de code signé par la clé `prefix`, à partir du modèle, avec la version donnée. */
async function buildSigned(prefix: string, id: string, version: string): Promise<Uint8Array> {
  const src = path.join(work, `src-${id}-${version}-${prefix}`);
  if (!fs.existsSync(src)) {
    newCodeGame(src, { id, name: 'Pile essai', author: 'Test' });
    setVersion(src, version);
  }
  const keys = path.join(work, prefix);
  if (!fs.existsSync(`${keys}.key.pem`)) keygen(keys);
  const out = path.join(work, `${id}-${version}-${prefix}-${Math.random().toString(36).slice(2)}.phgame`);
  await packCode(src, out, `${keys}.key.pem`);
  return new Uint8Array(fs.readFileSync(out));
}

/** Construit un paquet sans signature, à partir d'un dossier qui a déjà été construit une fois. */
async function buildUnsigned(id: string, version: string): Promise<Uint8Array> {
  const src = path.join(work, `src-${id}-${version}-nu`);
  newCodeGame(src, { id, name: 'Pile essai', author: 'Test' });
  setVersion(src, version);
  const out = path.join(work, `${id}-${version}-nu.phgame`);
  await packCode(src, out);
  return new Uint8Array(fs.readFileSync(out));
}

const upload = (bytes: Uint8Array) =>
  call('/api/admin/packages', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });

const catalogIds = async (): Promise<string[]> => {
  const res = await fetch(`${base}/api/catalog`);
  const body = (await res.json()) as { games: { id: string }[] };
  return body.games.map((g) => g.id);
};

const catalogEntry = async (id: string) => {
  const res = await fetch(`${base}/api/catalog`);
  const body = (await res.json()) as { games: { id: string; codeView?: { url: string; sha256: string } }[] };
  return body.games.find((g) => g.id === id);
};

const statusOf = async (id: string, version: string) => {
  const res = await call('/api/admin/code-games');
  const games = res.data.games as { id: string; version: string; status: string; error?: string }[];
  return games.find((g) => g.id === id && g.version === version);
};

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-jeux-de-code-'));
  dataDir = path.join(work, 'data');
  fs.mkdirSync(dataDir);
  config = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: path.join(dataDir, 'test.db'),
    staticDir: path.join(dataDir, 'static-absent'),
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'silent',
    secureCookies: false,
  };
  // La clé de confiance : seule la partie publique entre dans DATA_DIR.
  const trustDir = path.join(dataDir, TRUST_DIR_NAME);
  fs.mkdirSync(trustDir);
  keygen(path.join(work, 'confiance'));
  fs.copyFileSync(path.join(work, 'confiance.pub.pem'), path.join(trustDir, 'confiance.pub.pem'));
  await start();
});

afterAll(async () => {
  await server?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

describe('jeux de code : installation, revue, approbation', () => {
  it('refuse un paquet non signé', async () => {
    const res = await upload(await buildUnsigned(ID, '0.1.0'));
    expect(res.status).toBe(400);
    expect(res.data.issues.join(' ')).toContain('non signé');
  });

  it('refuse un paquet signé par une clé qui n’est pas de confiance', async () => {
    const res = await upload(await buildSigned('inconnue', ID, '0.1.0'));
    expect(res.status).toBe(400);
    expect(res.data.issues.join(' ')).toContain('clé inconnue');
  });

  it('refuse un identifiant déjà pris par un jeu intégré', async () => {
    const builtin = gameRegistry[0]!.manifest.id;
    const res = await upload(await buildSigned('confiance', builtin, '0.1.0'));
    expect(res.status).toBe(400);
    expect(res.data.error).toContain('déjà utilisé');
  });

  it('installe en attente : le jeu n’est pas encore au catalogue, et la revue montre le code', async () => {
    const res = await upload(await buildSigned('confiance', ID, '0.1.0'));
    expect(res.status).toBe(201);
    expect(res.data.kind).toBe('code');
    expect(await statusOf(ID, '0.1.0')).toMatchObject({ status: 'en_attente' });
    expect(await catalogIds()).not.toContain(ID);

    const review = await call(`/api/admin/code-games/${ID}/0.1.0/review`);
    expect(review.status).toBe(200);
    expect(review.data.sources.server).toContain(ID);
    expect(review.data.sources.client.length).toBeGreaterThan(0);
    expect(review.data.files.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(['code/server.js', 'code/client.js']),
    );
    expect(review.data.signer).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuse une approbation avec une empreinte qui ne correspond pas', async () => {
    const res = await call(`/api/admin/code-games/${ID}/0.1.0/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: '0'.repeat(64) }),
    });
    expect(res.status).toBe(400);
    expect(await catalogIds()).not.toContain(ID);
  });

  it('approuvé : le jeu est au catalogue, et ses vues se chargent par empreinte', async () => {
    const review = await call(`/api/admin/code-games/${ID}/0.1.0/review`);
    const res = await call(`/api/admin/code-games/${ID}/0.1.0/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: review.data.sha256 }),
    });
    expect(res.status).toBe(200);
    expect(await statusOf(ID, '0.1.0')).toMatchObject({ status: 'active' });

    const entry = await catalogEntry(ID);
    const sha = entry!.codeView!.sha256;
    expect(entry?.codeView?.url).toBe(`/api/code-games/${ID}/${sha}/view.html`);

    // Le document de vues : sa propre politique, qui n’autorise que son script (même empreinte) et aucun réseau.
    const viewDoc = await fetch(`${base}${entry!.codeView!.url}`);
    expect(viewDoc.status).toBe(200);
    expect(viewDoc.headers.get('content-type')).toContain('text/html');
    const csp = viewDoc.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(await viewDoc.text()).toContain(`/api/code-games/${ID}/${sha}/views.js`);

    // Le script de vues est servi à part, à la même empreinte.
    const views = await fetch(`${base}/api/code-games/${ID}/${sha}/views.js`);
    expect(views.status).toBe(200);
    expect(views.headers.get('content-type')).toContain('javascript');
    expect(views.headers.get('x-content-type-options')).toBe('nosniff');
    const script = await views.text();
    expect(script).toContain('"ready"');
    expect(script).toContain('"render"');

    // Une empreinte inconnue ne donne ni document ni script.
    expect((await fetch(`${base}/api/code-games/${ID}/${'0'.repeat(64)}/view.html`)).status).toBe(404);
    expect((await fetch(`${base}/api/code-games/${ID}/${'0'.repeat(64)}/views.js`)).status).toBe(404);
  });

  it('la page autorise les iframes de même origine (les vues), en plus de YouTube', async () => {
    const res = await fetch(`${base}/api/catalog`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/frame-src 'self' https:\/\/www\.youtube\.com/);
  });

  it('réinstaller les octets déjà approuvés ne change rien', async () => {
    // Reconstruire le paquet donnerait une autre empreinte : on réinstalle exactement l'archive approuvée.
    const archive = path.join(dataDir, 'code-games', ID, '0.1.0', 'package.phgame');
    const res = await upload(new Uint8Array(fs.readFileSync(archive)));
    expect(res.status).toBe(200);
    expect(res.data.unchanged).toBe(true);
  });

  it('la même version avec un contenu différent est refusée', async () => {
    // La construction est déterministe : pour changer le contenu, on retouche réellement le code.
    const src = path.join(work, 'src-pile-essai-retouche');
    newCodeGame(src, { id: ID, name: 'Pile essai', author: 'Test' });
    setVersion(src, '0.1.0');
    const serverFile = path.join(src, 'src', 'server.ts');
    fs.writeFileSync(serverFile, `${fs.readFileSync(serverFile, 'utf8')}\n// retouche\n`);
    const out = path.join(work, 'pile-essai-retouche.phgame');
    await packCode(src, out, path.join(work, 'confiance.key.pem'));
    const res = await upload(new Uint8Array(fs.readFileSync(out)));
    expect(res.status).toBe(400);
    expect(res.data.error).toContain('contenu différent');
  });

  it('au redémarrage, la version approuvée est rechargée depuis l’archive', async () => {
    await server.close();
    await start();
    expect(await catalogIds()).toContain(ID);
    expect(await statusOf(ID, '0.1.0')).toMatchObject({ status: 'active' });
  });

  it('une version nouvelle reste en attente sans remplacer la version active', async () => {
    const res = await upload(await buildSigned('confiance', ID, '0.2.0'));
    expect(res.status).toBe(201);
    expect(await statusOf(ID, '0.2.0')).toMatchObject({ status: 'en_attente' });
    expect(await statusOf(ID, '0.1.0')).toMatchObject({ status: 'active' });
    const entry = await catalogEntry(ID);
    expect(entry?.codeView).toBeDefined();
  });

  it('approuver la nouvelle version la rend active, et l’ancienne est remplacée', async () => {
    const review = await call(`/api/admin/code-games/${ID}/0.2.0/review`);
    const res = await call(`/api/admin/code-games/${ID}/0.2.0/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: review.data.sha256 }),
    });
    expect(res.status).toBe(200);
    expect(await statusOf(ID, '0.2.0')).toMatchObject({ status: 'active' });
    expect(await statusOf(ID, '0.1.0')).toMatchObject({ status: 'remplacee' });
    expect((await catalogEntry(ID))?.name).toBe('Pile essai');
  });

  it('désactiver le jeu le retire du catalogue, le réactiver le remet', async () => {
    const off = await call(`/api/admin/games/${ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect(await catalogIds()).not.toContain(ID);
    await call(`/api/admin/games/${ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(await catalogIds()).toContain(ID);
  });

  it('supprimer la version active retire le jeu et ses vues', async () => {
    const entry = await catalogEntry(ID);
    const res = await call(`/api/admin/code-games/${ID}/0.2.0`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await catalogIds()).not.toContain(ID);
    const views = await fetch(`${base}${entry!.codeView!.url}`);
    expect(views.status).toBe(404);
  });
});

describe('jeux de code : archive altérée', () => {
  const OTHER = 'altere-essai';

  it('une archive modifiée sur le disque n’est jamais chargée, et l’état le signale', async () => {
    const res = await upload(await buildSigned('confiance', OTHER, '0.1.0'));
    expect(res.status).toBe(201);
    const review = await call(`/api/admin/code-games/${OTHER}/0.1.0/review`);
    const approve = await call(`/api/admin/code-games/${OTHER}/0.1.0/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha256: review.data.sha256 }),
    });
    expect(approve.status).toBe(200);

    await server.close();
    const archive = path.join(dataDir, 'code-games', OTHER, '0.1.0', 'package.phgame');
    fs.writeFileSync(archive, Buffer.from('ceci n’est plus un paquet'));
    await start();

    expect(await catalogIds()).not.toContain(OTHER);
    expect(await statusOf(OTHER, '0.1.0')).toMatchObject({ status: 'erreur' });
  });
});
