import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type {
  CatalogGame,
  ClientToServerEvents,
  HostRoomView,
  LobbyPositionEvent,
  ServerToClientEvents,
} from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

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

// Le retour de chaque appel est typé selon ce que le test attend, sans `any`.
interface Ack {
  ok: boolean;
  error?: string;
  playerId?: string;
  token?: string;
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: Ack) => resolve(res));
  });
}

/** Garde l'historique des vues reçues, pour ne pas manquer un événement déjà passé. */
function track<T>(socket: Client, event: string): T[] {
  const list: T[] = [];
  (socket as unknown as { on: (e: string, cb: (v: T) => void) => void }).on(event, (v: T) => list.push(v));
  return list;
}

async function until<T>(list: T[], predicate: (v: T) => boolean, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = [...list].reverse().find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Condition non atteinte à temps');
}

async function createPlateau() {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'plateau-test', practice: false }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { code: string; hostToken: string };
}

describe('Plateau de test', () => {
  it('n’apparaît pas au catalogue public', async () => {
    const res = await fetch(`${base}/api/catalog`);
    const body = (await res.json()) as { games: CatalogGame[] };
    expect(body.games.some((g) => g.id === 'plateau-test')).toBe(false);
    // Les jeux réels restent listés.
    expect(body.games.some((g) => g.id === 'reflexe')).toBe(true);
  });

  it('ouvre une salle, où le lancement est refusé (aucune partie)', async () => {
    const { code, hostToken } = await createPlateau();
    const host = await connect();
    clients.push(host);
    const views = track<HostRoomView>(host, 'room:host');
    expect((await call(host, 'host:connect', { code, hostToken })).ok).toBe(true);
    const view = await until(views, (v) => v.lobby.game.id === 'plateau-test');
    expect(view.lobby.game.name).toBe('Plateau de test');

    // Avec un joueur présent, la vérification du nombre passe : c'est le plateau qui refuse.
    const player = await connect();
    clients.push(player);
    expect((await call(player, 'player:join', { code, name: 'Test' })).ok).toBe(true);
    const start = await call(host, 'host:start');
    expect(start.ok).toBe(false);
    expect(start.error).toMatch(/ne se lance pas/);
    host.disconnect();
    player.disconnect();
  });

  it('un joueur se déplace sur le plateau : la position est partagée à la salle', async () => {
    const { code, hostToken } = await createPlateau();
    const host = await connect();
    clients.push(host);
    await call(host, 'host:connect', { code, hostToken });
    const moves = track<LobbyPositionEvent>(host, 'room:lobby-position');

    const player = await connect();
    clients.push(player);
    const joined = await call(player, 'player:join', { code, name: 'Lina' });
    expect(joined.ok).toBe(true);

    const moved = await call(player, 'player:lobby-move', { x: 0.2, y: 0.7 });
    expect(moved.ok).toBe(true);
    const seen = await until(moves, (m) => m.position.x === 0.2 && m.position.y === 0.7);
    expect(seen.playerId).toBe(joined.playerId);
    host.disconnect();
    player.disconnect();
  });
});
