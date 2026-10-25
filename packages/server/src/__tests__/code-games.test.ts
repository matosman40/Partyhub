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
    // Seul le lecteur YouTube peut être intégré (vidéo du karaoké), et seulement lui.
    expect(csp).toContain('frame-src https://www.youtube-nocookie.com https://www.youtube.com');
    expect(viewDoc.headers.get('permissions-policy')).toBe('autoplay=*');
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

/** Paquet signé dont le code a été modifié (une ligne ajoutée au module serveur), pour la revue par différence. */
async function buildEdited(id: string, version: string): Promise<Uint8Array> {
  const src = path.join(work, `src-${id}-${version}-modifie`);
  newCodeGame(src, { id, name: 'Pile essai', author: 'Test' });
  setVersion(src, version);
  const serverFile = path.join(src, 'src', 'server.ts');
  fs.writeFileSync(
    serverFile,
    `${fs.readFileSync(serverFile, 'utf8')}\nexport const nouveaute = 'nouveauté relue par l’administrateur';\n`,
  );
  const out = path.join(work, `${id}-${version}-modifie.phgame`);
  await packCode(src, out, path.join(work, 'confiance.key.pem'));
  return new Uint8Array(fs.readFileSync(out));
}

const approveRoute = (id: string, version: string, sha256: string) =>
  call(`/api/admin/code-games/${id}/${version}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  });

describe('jeux de code : désactivation, révocation, revue par différence', () => {
  it('un jeu désactivé reste désactivé après l’approbation d’une nouvelle version', async () => {
    const ID2 = 'desactive-essai';
    expect((await upload(await buildSigned('confiance', ID2, '0.1.0'))).status).toBe(201);
    const first = await call(`/api/admin/code-games/${ID2}/0.1.0/review`);
    expect((await approveRoute(ID2, '0.1.0', first.data.sha256)).data.enabled).toBe(true);
    expect(await catalogIds()).toContain(ID2);

    const off = await call(`/api/admin/games/${ID2}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);

    expect((await upload(await buildSigned('confiance', ID2, '0.2.0'))).status).toBe(201);
    const second = await call(`/api/admin/code-games/${ID2}/0.2.0/review`);
    const approved = await approveRoute(ID2, '0.2.0', second.data.sha256);
    expect(approved.status).toBe(200);
    expect(approved.data.enabled).toBe(false);
    expect(await catalogIds()).not.toContain(ID2);

    // Ses vues ne sont plus servies tant que le jeu est désactivé (adressées par l'empreinte du bundle des vues).
    const viewSha = second.data.files.find((f: { path: string }) => f.path === 'code/client.js').sha256;
    const views = await fetch(`${base}/api/code-games/${ID2}/${viewSha}/view.html`);
    expect(views.status).toBe(404);

    await call(`/api/admin/games/${ID2}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(await catalogIds()).toContain(ID2);
    expect((await fetch(`${base}/api/code-games/${ID2}/${viewSha}/view.html`)).status).toBe(200);
  });

  it('retirer une clé de confiance arrête le jeu qu’elle a signé, et le remettre la rétablit', async () => {
    const ID3 = 'cle-essai';
    expect((await upload(await buildSigned('confiance', ID3, '0.1.0'))).status).toBe(201);
    const review = await call(`/api/admin/code-games/${ID3}/0.1.0/review`);
    expect((await approveRoute(ID3, '0.1.0', review.data.sha256)).status).toBe(200);
    expect(await catalogIds()).toContain(ID3);

    const keyFile = path.join(dataDir, TRUST_DIR_NAME, 'confiance.pub.pem');
    const savedKey = fs.readFileSync(keyFile);
    try {
      fs.rmSync(keyFile);
      const reload = await call('/api/admin/code-games/reload', { method: 'POST' });
      expect(reload.status).toBe(200);
      expect(reload.data.stopped).toContain(ID3);
      expect(await catalogIds()).not.toContain(ID3);
      expect(await statusOf(ID3, '0.1.0')).toMatchObject({ status: 'erreur' });
    } finally {
      fs.writeFileSync(keyFile, savedKey);
    }

    const back = await call('/api/admin/code-games/reload', { method: 'POST' });
    expect(back.data.stopped).not.toContain(ID3);
    expect(await catalogIds()).toContain(ID3);
    expect(await statusOf(ID3, '0.1.0')).toMatchObject({ status: 'active' });
  });

  it('la revue montre ce qui change par rapport à la version active', async () => {
    const ID4 = 'diff-essai';
    expect((await upload(await buildSigned('confiance', ID4, '0.1.0'))).status).toBe(201);
    const first = await call(`/api/admin/code-games/${ID4}/0.1.0/review`);
    expect((await approveRoute(ID4, '0.1.0', first.data.sha256)).status).toBe(200);
    expect(first.data.changes).toBeNull();

    expect((await upload(await buildEdited(ID4, '0.2.0'))).status).toBe(201);
    const second = await call(`/api/admin/code-games/${ID4}/0.2.0/review`);
    expect(second.status).toBe(200);
    expect(second.data.changes.from).toBe('0.1.0');
    expect(second.data.changes.counts.server.added).toBeGreaterThan(0);
    const added = (second.data.changes.server as { kind: string; text: string }[]).filter((l) => l.kind === '+');
    // esbuild écrit les accents en échappements : on cherche la déclaration, pas le texte français.
    expect(added.some((l) => l.text.includes('var nouveaute'))).toBe(true);
  });
});

describe('jeux de code : sauvegarde complète', () => {
  it('la sauvegarde contient les jeux de code, et la restauration les remet en attente, sans les réactiver', async () => {
    const ID5 = 'sauve-essai';
    expect((await upload(await buildSigned('confiance', ID5, '0.1.0'))).status).toBe(201);
    const review = await call(`/api/admin/code-games/${ID5}/0.1.0/review`);
    expect((await approveRoute(ID5, '0.1.0', review.data.sha256)).status).toBe(200);
    expect(await catalogIds()).toContain(ID5);

    const exported = await fetch(`${base}/api/admin/backup/archive`, { headers: { cookie } });
    expect(exported.status).toBe(200);
    const archive = new Uint8Array(await exported.arrayBuffer());

    // Le jeu disparaît, puis la sauvegarde est restaurée.
    expect((await call(`/api/admin/code-games/${ID5}/0.1.0`, { method: 'DELETE' })).status).toBe(200);
    expect(await catalogIds()).not.toContain(ID5);

    const restored = await fetch(`${base}/api/admin/backup/archive`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/zip' },
      body: archive,
    });
    const body = (await restored.json()) as { ok: boolean; summary: { codeGames: number; skipped: string[] } };
    expect(restored.status).toBe(200);
    expect(body.summary.codeGames).toBe(1);
    expect(body.summary.skipped.filter((line) => line.includes(ID5))).toEqual([]);

    // Restaurée en attente de revue : ni active, ni au catalogue, tant qu'elle n'est pas approuvée à nouveau.
    expect(await statusOf(ID5, '0.1.0')).toMatchObject({ status: 'en_attente' });
    expect(await catalogIds()).not.toContain(ID5);
    const again = await call(`/api/admin/code-games/${ID5}/0.1.0/review`);
    expect((await approveRoute(ID5, '0.1.0', again.data.sha256)).status).toBe(200);
    expect(await catalogIds()).toContain(ID5);
  });
});

describe('jeux de code : requêtes simultanées', () => {
  const ID6 = 'simultane-essai';

  it('deux installations simultanées de la même version : une seule est écrite, l’autre répond « inchangé »', async () => {
    const bytes = await buildSigned('confiance', ID6, '0.1.0');
    const [first, second] = await Promise.all([upload(bytes), upload(bytes)]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(await statusOf(ID6, '0.1.0')).toMatchObject({ status: 'en_attente' });
    const rows = (await call('/api/admin/code-games')).data.games as { id: string }[];
    expect(rows.filter((g) => g.id === ID6)).toHaveLength(1);
  });

  it('deux approbations simultanées : la seconde constate que la version est déjà active', async () => {
    const review = await call(`/api/admin/code-games/${ID6}/0.1.0/review`);
    const sha256 = review.data.sha256 as string;
    const [first, second] = await Promise.all([approveRoute(ID6, '0.1.0', sha256), approveRoute(ID6, '0.1.0', sha256)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await catalogIds()).toContain(ID6);
  });
});
