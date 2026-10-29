import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, HostRoomView, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { readCookie, sameSecret } from '../auth.js';

/**
 * Durcissements de la revue : limiteurs réservés avant la vérification, consultation des codes de salle freinée,
 * comparaison des jetons en temps constant, cookie mal encodé, robots placés sur le plateau.
 */

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: PartyServer;
let base: string;
const clients: Client[] = [];

beforeAll(async () => {
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: '/tmp/partyhub-tests',
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'test-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await server.close();
});

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = ioClient(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(
      event,
      ...args,
      (res: { ok: boolean; error?: string }) => resolve(res),
    );
  });
}

describe('Secrets et cookies', () => {
  it('sameSecret compare en temps constant et refuse tout ce qui n’est pas la bonne chaîne', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abd', 'abc')).toBe(false);
    expect(sameSecret('abcd', 'abc')).toBe(false);
    expect(sameSecret('', 'abc')).toBe(false);
    expect(sameSecret(undefined, 'abc')).toBe(false);
    expect(sameSecret(123, 'abc')).toBe(false);
  });

  it('un cookie mal encodé est ignoré au lieu de lever une erreur', () => {
    expect(readCookie('a=%E0%A4%A; b=ok', 'a')).toBeUndefined();
    expect(readCookie('a=%E0%A4%A; b=ok', 'b')).toBe('ok');
    expect(readCookie('s=abc%20def', 's')).toBe('abc def');
  });
});

describe('Limiteurs', () => {
  it('une rafale simultanée de mots de passe faux ne dépasse pas 5 essais', async () => {
    const reponses = await Promise.all(
      Array.from({ length: 30 }, () =>
        fetch(`${base}/api/admin/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'pas-le-bon' }),
        }),
      ),
    );
    const statuts = reponses.map((r) => r.status);
    expect(statuts.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuts.filter((s) => s === 429).length).toBeGreaterThanOrEqual(25);
    // Une fois la limite atteinte, même le bon mot de passe attend la fin de la fenêtre.
    const bon = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'test-password-123' }),
    });
    expect(bon.status).toBe(429);
  });

  it('la consultation des codes de salle est freinée, mais pas pour un usage normal', async () => {
    const statuts: number[] = [];
    for (let i = 0; i < 70; i++) statuts.push((await fetch(`${base}/api/rooms/9999`)).status);
    expect(statuts.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuts.slice(60).every((s) => s === 429)).toBe(true);
  });
});

describe('Robots sur le plateau', () => {
  it('un robot ajouté est placé sur la grille comme un joueur', async () => {
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'plateau-test', practice: false }),
    });
    expect(res.ok).toBe(true);
    const { code, hostToken } = (await res.json()) as { code: string; hostToken: string };
    const host = await connect();
    const vues: HostRoomView[] = [];
    host.on('room:host', (v) => vues.push(v));
    expect((await call(host, 'host:connect', { code, hostToken })).ok).toBe(true);
    expect((await call(host, 'host:addBot')).ok).toBe(true);
    const fin = Date.now() + 3000;
    while (Date.now() < fin && !vues.some((v) => Object.keys(v.lobby.grille?.personnages ?? {}).length === 1)) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const derniere = vues[vues.length - 1]!;
    expect(derniere.lobby.players.length).toBe(1);
    expect(Object.keys(derniere.lobby.grille?.personnages ?? {})).toHaveLength(1);
  });
});

describe('Geste sans effet', () => {
  it('marcher contre un mur ne rediffuse rien à la salle', async () => {
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'plateau-test', practice: false }),
    });
    const { code, hostToken } = (await res.json()) as { code: string; hostToken: string };
    const host = await connect();
    const vues: HostRoomView[] = [];
    host.on('room:host', (v) => vues.push(v));
    expect((await call(host, 'host:connect', { code, hostToken })).ok).toBe(true);
    const joueur = await connect();
    expect((await call(joueur, 'player:join', { code, name: 'Mur' })).ok).toBe(true);
    // Vers le haut jusqu’au bord : le bord arrive vite, les pas suivants ne changent plus rien.
    for (let i = 0; i < 8; i++) await call(joueur, 'player:grille', { type: 'marcher', dir: 'up' });
    await new Promise((r) => setTimeout(r, 150));
    const avant = vues.length;
    const seqAvant = vues[vues.length - 1]!.lobby.grille!.seq;
    for (let i = 0; i < 3; i++)
      expect((await call(joueur, 'player:grille', { type: 'marcher', dir: 'up' })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(vues.length).toBe(avant);
    expect(vues[vues.length - 1]!.lobby.grille!.seq).toBe(seqAvant);
  });
});
