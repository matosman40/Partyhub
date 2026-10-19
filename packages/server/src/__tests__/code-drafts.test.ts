import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gameRegistry } from '@partyhub/games';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { DRAFTS_DIR_NAME, MAX_DRAFT_FILE_BYTES } from '../code-games/drafts.js';
import { buildCodePackage } from '../code-games/build.js';
import { generateSigningKeys } from '../packages/code-format.js';

/**
 * Éditeur des jeux de code, par l'API d'administration : brouillon créé depuis le modèle, fichiers contrôlés,
 * vérification, puis paquet signé hors de PartyHub (comme le fait l'auteur avec phgame pack), reçu par l'import,
 * relu et approuvé. PartyHub ne détient aucune clé de signature.
 */

const ADMIN_PASSWORD = 'editeur-jeux-123';
const ID = 'brouillon-essai';

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
  return { status: res.status, data, text };
}

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function putFile(id: string, filePath: string, content: string) {
  return call(`/api/admin/code-drafts/${id}/file`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
}

/** Clé de l'auteur : elle signe hors de PartyHub, et sa partie publique rejoint les clés de confiance. */
const author = generateSigningKeys();

function trustAuthorKey(): void {
  const trust = path.join(dataDir, 'cles-de-confiance');
  fs.mkdirSync(trust, { recursive: true });
  fs.writeFileSync(path.join(trust, `${author.keyId}.pub.pem`), author.publicPem);
}

/** Paquet signé hors de PartyHub, comme `phgame pack` le fait sur le poste de l'auteur. */
async function signOutside(id: string): Promise<Uint8Array> {
  const { bytes } = await buildCodePackage(path.join(dataDir, DRAFTS_DIR_NAME, id), author.privatePem);
  return bytes;
}

/** Envoi du paquet par l'import de l'administration : il arrive en attente de revue. */
function importPackage(bytes: Uint8Array) {
  return call('/api/admin/packages', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  });
}

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-editeur-jeux-'));
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
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

describe('éditeur : création et fichiers', () => {
  it('crée un brouillon à partir du modèle, dans DATA_DIR', async () => {
    const res = await call('/api/admin/code-drafts', json({ id: ID, name: 'Brouillon essai', author: 'Test' }));
    expect(res.status).toBe(201);
    expect(res.data.draft.id).toBe(ID);
    const paths = res.data.draft.files.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['manifest.json', 'src/server.ts', 'src/client.tsx']));
    expect(fs.existsSync(path.join(dataDir, DRAFTS_DIR_NAME, ID, 'src', 'server.ts'))).toBe(true);
  });

  it('refuse un second brouillon du même identifiant', async () => {
    const res = await call('/api/admin/code-drafts', json({ id: ID, name: 'Autre', author: 'Test' }));
    expect(res.status).toBe(409);
  });

  it('refuse un identifiant déjà pris par un jeu intégré', async () => {
    const builtin = gameRegistry[0]!.manifest.id;
    const res = await call('/api/admin/code-drafts', json({ id: builtin, name: 'Copie', author: 'Test' }));
    expect(res.status).toBe(409);
    expect(res.data.error).toContain('déjà utilisé');
  });

  it('refuse un identifiant mal formé et un nom avec apostrophe', async () => {
    const badId = await call('/api/admin/code-drafts', json({ id: 'Mauvais Id', name: 'Essai', author: 'Test' }));
    expect(badId.status).toBe(400);
    const badName = await call('/api/admin/code-drafts', json({ id: 'autre-essai', name: 'L’essai', author: 'A' }));
    expect(badName.status).toBe(201);
    await call(`/api/admin/code-drafts/autre-essai`, { method: 'DELETE' });
    const quoted = await call('/api/admin/code-drafts', json({ id: 'autre-essai', name: "L'essai", author: 'A' }));
    expect(quoted.status).toBe(400);
  });

  it('lit et écrit un fichier éditable, et refuse les chemins qui sortent du brouillon', async () => {
    const read = await call(`/api/admin/code-drafts/${ID}/file?path=manifest.json`);
    expect(read.status).toBe(200);
    expect(read.data.content).toContain(`"id": "${ID}"`);

    expect((await putFile(ID, '../evil.ts', 'x')).status).toBe(400);
    expect((await putFile(ID, '/etc/passwd', 'x')).status).toBe(400);
    expect((await putFile(ID, 'assets/image.png', 'x')).status).toBe(400);
    expect((await putFile(ID, 'src/nope.js', 'x')).status).toBe(400);
    expect((await putFile(ID, 'src/a b.ts', 'x')).status).toBe(400);

    const ok = await putFile(ID, 'src/aide.ts', 'export const valeur = 1;\n');
    expect(ok.status).toBe(200);
    const back = await call(`/api/admin/code-drafts/${ID}/file?path=src/aide.ts`);
    expect(back.data.content).toBe('export const valeur = 1;\n');
  });

  it('refuse un fichier trop grand, et un lien symbolique dans le chemin', async () => {
    const big = 'a'.repeat(MAX_DRAFT_FILE_BYTES + 1);
    expect((await putFile(ID, 'src/grand.ts', big)).status).toBe(413);

    const link = path.join(dataDir, DRAFTS_DIR_NAME, ID, 'src', 'lien');
    fs.symlinkSync(os.tmpdir(), link);
    const res = await putFile(ID, 'src/lien/x.ts', 'x');
    expect(res.status).toBe(400);
    expect(res.data.error).toContain('lien symbolique');
    fs.rmSync(link);
  });

  it('ne supprime pas les fichiers qui font tenir le jeu', async () => {
    const res = await call(`/api/admin/code-drafts/${ID}/file?path=manifest.json`, { method: 'DELETE' });
    expect(res.status).toBe(400);
    const extra = await call(`/api/admin/code-drafts/${ID}/file?path=src/aide.ts`, { method: 'DELETE' });
    expect(extra.status).toBe(200);
  });
});

describe('éditeur : aucune clé de signature dans PartyHub', () => {
  it('n’expose ni clé ni signature, et ne crée aucun dossier de clé', async () => {
    const key = await call('/api/admin/signing-key');
    expect(key.status).toBe(404);
    const sign = await call(`/api/admin/code-drafts/${ID}/sign`, { method: 'POST' });
    expect(sign.status).toBe(404);
    expect(fs.existsSync(path.join(dataDir, 'cles-de-signature'))).toBe(false);
  });
});

describe('éditeur : vérifier, métadonnées, paquet signé hors de PartyHub, revue', () => {
  it('vérifie le brouillon : partie complète jouée par des robots', async () => {
    const res = await call(`/api/admin/code-drafts/${ID}/check`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(res.data.lines.join(' ')).toContain('Lancement de contrôle');
  }, 60_000);

  it('règle le nom et la version dans manifest.json et src/server.ts à la fois', async () => {
    const meta = await call(`/api/admin/code-drafts/${ID}/metadata`, json({ name: 'Essai renommé', version: '0.2.0' }));
    expect(meta.status).toBe(200);
    expect(meta.data.draft.version).toBe('0.2.0');
    const manifest = await call(`/api/admin/code-drafts/${ID}/file?path=manifest.json`);
    expect(manifest.data.content).toContain('"version": "0.2.0"');
    const server = await call(`/api/admin/code-drafts/${ID}/file?path=src/server.ts`);
    expect(server.data.content).toContain("version: '0.2.0'");
    expect(server.data.content).toContain("name: 'Essai renommé'");
  });

  it('refuse une version mal formée et un nom avec guillemets', async () => {
    expect((await call(`/api/admin/code-drafts/${ID}/metadata`, json({ version: 'deux' }))).status).toBe(400);
    expect((await call(`/api/admin/code-drafts/${ID}/metadata`, json({ name: 'Essai "x"' }))).status).toBe(400);
  });

  it('reçoit le paquet signé hors de PartyHub : il arrive en attente de revue, un second envoi ne change rien', async () => {
    trustAuthorKey();
    const first = await importPackage(await signOutside(ID));
    expect(first.status).toBe(201);
    expect(first.data.kind).toBe('code');
    expect(first.data.unchanged).toBe(false);

    const list = await call('/api/admin/code-games');
    const row = list.data.games.find((g: { id: string }) => g.id === ID);
    expect(row).toMatchObject({ version: '0.2.0', status: 'en_attente' });

    const second = await importPackage(await signOutside(ID));
    expect(second.status).toBe(200);
    expect(second.data.unchanged).toBe(true);

    // La version 0.2.0 est maintenant installée : la reprendre tel quel est refusé.
    const sameVersion = await call(`/api/admin/code-drafts/${ID}/metadata`, json({ version: '0.2.0' }));
    expect(sameVersion.status).toBe(409);
  }, 60_000);

  it('refuse de réinstaller la même version avec un contenu différent', async () => {
    // src/aide.ts n'est importé par personne : le bundle ne change pas. On modifie src/server.ts, qui entre dans le paquet.
    const current = await call(`/api/admin/code-drafts/${ID}/file?path=src/server.ts`);
    await putFile(ID, 'src/server.ts', `${current.data.content}\nexport const essai = 2;\n`);
    const res = await importPackage(await signOutside(ID));
    expect(res.status).toBe(400);
    expect(res.data.error).toContain('contenu différent');
  }, 60_000);

  it('approuve la version relue, puis le brouillon montre son état installé', async () => {
    const review = await call(`/api/admin/code-games/${ID}/0.2.0/review`);
    expect(review.status).toBe(200);
    const approve = await call(`/api/admin/code-games/${ID}/0.2.0/approve`, json({ sha256: review.data.sha256 }));
    expect(approve.status).toBe(200);

    const drafts = await call('/api/admin/code-drafts');
    const draft = drafts.data.drafts.find((d: { id: string }) => d.id === ID);
    expect(draft.installed).toMatchObject({ version: '0.2.0', status: 'active' });
  }, 60_000);
});

describe('éditeur : brouillon cassé et suppression', () => {
  it('signale un manifest.json cassé et refuse de le signer', async () => {
    const created = await call('/api/admin/code-drafts', json({ id: 'casse-essai', name: 'Cassé', author: 'Test' }));
    expect(created.status).toBe(201);
    await putFile('casse-essai', 'manifest.json', '{ pas du json');
    const list = await call('/api/admin/code-drafts');
    expect(list.data.drafts.find((d: { id: string }) => d.id === 'casse-essai').broken).toBe(true);

    const check = await call('/api/admin/code-drafts/casse-essai/check', { method: 'POST' });
    expect(check.data.ok).toBe(false);
    // Un brouillon qui ne se construit pas ne donne aucun paquet, même signé hors de PartyHub.
    await expect(signOutside('casse-essai')).rejects.toThrow();
  }, 60_000);

  it('supprime un brouillon sans toucher aux versions installées', async () => {
    const del = await call(`/api/admin/code-drafts/${ID}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(dataDir, DRAFTS_DIR_NAME, ID))).toBe(false);
    const games = await call('/api/admin/code-games');
    expect(games.data.games.some((g: { id: string }) => g.id === ID)).toBe(true);
    const missing = await call(`/api/admin/code-drafts/${ID}`);
    expect(missing.status).toBe(404);
  });
});

describe('éditeur : rien n’est lu hors du brouillon', () => {
  it('refuse un import vers un fichier situé hors du brouillon', async () => {
    fs.writeFileSync(path.join(dataDir, 'secret.txt'), 'secret-de-test');
    const created = await call('/api/admin/code-drafts', json({ id: 'fuite-essai', name: 'Fuite', author: 'Test' }));
    expect(created.status).toBe(201);
    const current = await call('/api/admin/code-drafts/fuite-essai/file?path=src/server.ts');
    // Depuis src/, ../../../ mène à DATA_DIR : le secret ne doit jamais entrer dans le paquet.
    // L'import doit être utilisé : esbuild retire un import TypeScript inutilisé avant de le lire.
    const leak = `import secret from '../../../secret.txt';\nexport const secreto = secret;\n`;
    await putFile('fuite-essai', 'src/server.ts', `${leak}${current.data.content}`);

    const check = await call('/api/admin/code-drafts/fuite-essai/check', { method: 'POST' });
    expect(check.data.ok).toBe(false);
    expect(check.data.lines.join(' ')).toContain('import hors du jeu refusé');
    expect(check.text).not.toContain('secret-de-test');

    await call('/api/admin/code-drafts/fuite-essai', { method: 'DELETE' });
  }, 60_000);
});
