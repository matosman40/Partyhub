import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { buildCodePackage, newCodeGame } from '../code-games/build.js';
import { DROP_DIR_NAME, isPrivateAddress } from '../code-games/intake.js';
import { generateSigningKeys } from '../packages/code-format.js';
import { DEFAULT_PACKAGE_LIMITS } from '../packages/format.js';

/**
 * Deux voies d'ajout des jeux de code : le dossier de dépôt (DATA_DIR/depot-jeux) et l'adresse HTTPS.
 * Dans les deux cas, le paquet signé par l'auteur arrive en attente de revue. Le réseau et le DNS sont simulés.
 */

const ADMIN_PASSWORD = 'ajout-jeux-123';
const HOSTS: Record<string, string[]> = {
  'jeux.exemple.test': ['93.184.216.34'],
  'interne.exemple.test': ['10.0.0.5'],
};

let work: string;
let dataDir: string;
let server: PartyServer;
let base: string;
let cookie: string;
let depotBytes: Uint8Array;
let urlBytes: Uint8Array;
const requested: string[] = [];
const author = generateSigningKeys();

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

/** Réseau simulé : seules les adresses publiques répondent, et chaque appel est noté. */
async function fakeLookup(host: string): Promise<string[]> {
  if (net.isIP(host)) return [host];
  const found = HOSTS[host];
  if (!found) throw new Error('ENOTFOUND');
  return found;
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  requested.push(url);
  if (init?.redirect !== 'manual') throw new Error('le téléchargement doit suivre les redirections à la main');
  switch (url) {
    case 'https://jeux.exemple.test/jeu.phgame':
      return new Response(urlBytes, { status: 200 });
    case 'https://jeux.exemple.test/redirige-http.phgame':
      return new Response(null, { status: 302, headers: { location: 'http://jeux.exemple.test/jeu.phgame' } });
    case 'https://jeux.exemple.test/redirige-interne.phgame':
      return new Response(null, { status: 302, headers: { location: 'https://interne.exemple.test/jeu.phgame' } });
    case 'https://jeux.exemple.test/gros.phgame':
      return new Response(new Uint8Array(DEFAULT_PACKAGE_LIMITS.maxArchiveBytes + 1), { status: 200 });
    default:
      return new Response('introuvable', { status: 404 });
  }
}

async function buildPackage(id: string): Promise<Uint8Array> {
  const dir = path.join(work, 'fabrique', id);
  newCodeGame(dir, { id, name: `Essai ${id}`, author: 'Test' });
  const { bytes } = await buildCodePackage(dir, author.privatePem);
  return bytes;
}

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-ajout-jeux-'));
  dataDir = path.join(work, 'data');
  fs.mkdirSync(dataDir);
  const trust = path.join(dataDir, 'cles-de-confiance');
  fs.mkdirSync(trust, { recursive: true });
  fs.writeFileSync(path.join(trust, `${author.keyId}.pub.pem`), author.publicPem);

  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: path.join(dataDir, 'test.db'),
    staticDir: path.join(dataDir, 'static-absent'),
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({
    config,
    logger: createLogger('silent', true),
    sweepEveryMs: 0,
    codeIntake: {
      deps: { fetch: fakeFetch as unknown as typeof fetch, lookup: fakeLookup },
      watchEveryMs: 0,
    },
  });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  depotBytes = await buildPackage('depot-essai');
  urlBytes = await buildPackage('url-essai');
}, 180_000);

afterAll(async () => {
  await server?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

describe('dossier de dépôt', () => {
  const folder = () => path.join(dataDir, DROP_DIR_NAME);

  it('relit le dossier : un paquet signé déposé arrive en attente de revue', async () => {
    fs.writeFileSync(path.join(folder(), 'depot-essai.phgame'), depotBytes);
    const res = await call('/api/admin/code-intake/scan', { method: 'POST' });
    expect(res.status).toBe(200);
    const file = res.data.files.find((f: { name: string }) => f.name === 'depot-essai.phgame');
    expect(file).toMatchObject({ status: 'en_attente', id: 'depot-essai' });

    const games = await call('/api/admin/code-games');
    expect(games.data.games.find((g: { id: string }) => g.id === 'depot-essai')).toMatchObject({
      status: 'en_attente',
    });
  }, 120_000);

  it('une relecture complète reconnaît le paquet déjà reçu, sans rien réinstaller', async () => {
    const res = await call('/api/admin/code-intake/scan', { method: 'POST' });
    const file = res.data.files.find((f: { name: string }) => f.name === 'depot-essai.phgame');
    expect(file.status).toBe('deja_recu');
  }, 120_000);

  it('refuse un fichier qui n’est pas un paquet, ignore les autres fichiers, refuse un lien', async () => {
    fs.writeFileSync(path.join(folder(), 'casse.phgame'), 'pas un paquet');
    fs.writeFileSync(path.join(folder(), 'notes.txt'), 'à ignorer');
    fs.symlinkSync(path.join(folder(), 'depot-essai.phgame'), path.join(folder(), 'lien.phgame'));

    const res = await call('/api/admin/code-intake/scan', { method: 'POST' });
    const names = res.data.files.map((f: { name: string }) => f.name);
    expect(names).not.toContain('notes.txt');
    const casse = res.data.files.find((f: { name: string }) => f.name === 'casse.phgame');
    expect(casse.status).toBe('refuse');
    expect(casse.message.length).toBeGreaterThan(0);
    const lien = res.data.files.find((f: { name: string }) => f.name === 'lien.phgame');
    expect(lien).toMatchObject({ status: 'refuse' });
    expect(lien.message).toContain('fichiers réguliers');
  }, 120_000);

  it('retire de la liste un fichier qui n’est plus dans le dossier', async () => {
    fs.rmSync(path.join(folder(), 'casse.phgame'));
    fs.rmSync(path.join(folder(), 'lien.phgame'));
    const res = await call('/api/admin/code-intake/scan', { method: 'POST' });
    const names = res.data.files.map((f: { name: string }) => f.name);
    expect(names).toEqual(['depot-essai.phgame']);
    const state = await call('/api/admin/code-intake');
    expect(state.data.folder).toBe(DROP_DIR_NAME);
  }, 120_000);
});

describe('adresse HTTPS', () => {
  it('refuse une adresse qui n’est pas en HTTPS, avec mot de passe, ou qui pointe sur une adresse locale', async () => {
    requested.length = 0;
    const cases: [string, string][] = [
      ['http://jeux.exemple.test/jeu.phgame', 'HTTPS'],
      ['https://qui:secret@jeux.exemple.test/jeu.phgame', 'mot de passe'],
      ['https://127.0.0.1/jeu.phgame', 'privée'],
      ['https://[::1]/jeu.phgame', 'privée'],
      ['https://[::ffff:7f00:1]/jeu.phgame', 'privée'],
      ['https://localhost/jeu.phgame', 'introuvable'],
      ['pas une adresse', 'invalide'],
    ];
    for (const [url, expected] of cases) {
      const res = await call('/api/admin/code-intake/url', json({ url }));
      expect(res.status, url).toBe(400);
      expect(res.data.error, url).toContain(expected);
    }
    expect(requested).toEqual([]);
  });

  it('télécharge le paquet signé et le met en attente de revue', async () => {
    const res = await call('/api/admin/code-intake/url', json({ url: 'https://jeux.exemple.test/jeu.phgame' }));
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ kind: 'code', id: 'url-essai', unchanged: false });

    const games = await call('/api/admin/code-games');
    expect(games.data.games.find((g: { id: string }) => g.id === 'url-essai')).toMatchObject({
      status: 'en_attente',
    });
  }, 120_000);

  it('une seconde importation du même paquet ne change rien', async () => {
    const res = await call('/api/admin/code-intake/url', json({ url: 'https://jeux.exemple.test/jeu.phgame' }));
    expect(res.status).toBe(200);
    expect(res.data.unchanged).toBe(true);
  }, 120_000);

  it('ne suit pas une redirection vers HTTP, ni vers une adresse locale', async () => {
    requested.length = 0;
    const toHttp = await call(
      '/api/admin/code-intake/url',
      json({ url: 'https://jeux.exemple.test/redirige-http.phgame' }),
    );
    expect(toHttp.status).toBe(400);
    expect(toHttp.data.error).toContain('HTTPS');

    const toInternal = await call(
      '/api/admin/code-intake/url',
      json({ url: 'https://jeux.exemple.test/redirige-interne.phgame' }),
    );
    expect(toInternal.status).toBe(400);
    expect(toInternal.data.error).toContain('privée');
    expect(requested.some((u) => u.includes('interne.exemple.test'))).toBe(false);
    expect(requested.some((u) => u.startsWith('http://'))).toBe(false);
  });

  it('refuse un fichier trop lourd, et une réponse d’erreur du serveur distant', async () => {
    const big = await call('/api/admin/code-intake/url', json({ url: 'https://jeux.exemple.test/gros.phgame' }));
    expect(big.status).toBe(400);
    expect(big.data.error).toContain('trop volumineux');

    const missing = await call('/api/admin/code-intake/url', json({ url: 'https://jeux.exemple.test/absent.phgame' }));
    expect(missing.status).toBe(400);
    expect(missing.data.error).toContain('404');
  });
});

describe('adresses publiques et privées', () => {
  it('reconnaît les adresses locales et privées, y compris en IPv4 dans IPv6', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.1.1', '::1', 'fe80::1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress('::ffff:10.1.2.3')).toBe(true);
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('::127.0.0.1')).toBe(true);
    expect(isPrivateAddress('localhost')).toBe(true);
    for (const address of ['93.184.216.34', '8.8.8.8', '2001:4860:4860::8888']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
    expect(net.isIP('93.184.216.34')).toBe(4);
  });
});
