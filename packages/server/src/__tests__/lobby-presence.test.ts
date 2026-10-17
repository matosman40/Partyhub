import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  HostRoomView,
  LobbyMoodEvent,
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

interface Ack {
  ok: boolean;
  error?: string;
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: Ack) => resolve(res));
  });
}

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

async function freshRoom(gameId = 'reflexe') {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId, practice: false }),
  });
  return (await res.json()) as { code: string; hostToken: string };
}

async function hostOf(code: string, hostToken: string) {
  const host = await connect();
  const views = track<HostRoomView>(host, 'room:host');
  expect((await call(host, 'host:connect', { code, hostToken })).ok).toBe(true);
  return { host, views };
}

async function joinAs(code: string, name: string) {
  const socket = await connect();
  const ack = await call(socket, 'player:join', { code, name });
  expect(ack.ok).toBe(true);
  return { socket, moods: track<LobbyMoodEvent>(socket, 'room:lobby-mood') };
}

describe('Présence dans le salon : déplacement', () => {
  it('garde la position du personnage, bornée à la zone utile, et la diffuse à l’hôte', async () => {
    const { code, hostToken } = await freshRoom();
    const { host } = await hostOf(code, hostToken);
    // Les places arrivent seules, par événement : la vue complète n'est pas renvoyée à chaque pas.
    const moves = track<LobbyPositionEvent>(host, 'room:lobby-position');
    const ana = await joinAs(code, 'Ana');

    expect((await call(ana.socket, 'player:lobby-move', { x: 0.5, y: 0.3 })).ok).toBe(true);
    const placed = await until(moves, (m) => m.position.x === 0.5);
    expect(placed.position).toEqual({ x: 0.5, y: 0.3 });

    // Au bord : ramené dans les marges (0,06 à gauche et à droite, 0,14 en haut et en bas).
    await call(ana.socket, 'player:lobby-move', { x: 1, y: 0 });
    const clamped = await until(moves, (m) => m.position.y === 0.14);
    expect(clamped.position).toEqual({ x: 0.94, y: 0.14 });

    host.disconnect();
  });

  it('refuse une position hors de 0 à 1', async () => {
    const { code, hostToken } = await freshRoom();
    const { host } = await hostOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    const bad = await call(ana.socket, 'player:lobby-move', { x: 2, y: 0.5 });
    expect(bad.ok).toBe(false);
    host.disconnect();
  });

  it('n’autorise plus les déplacements une fois la partie lancée', async () => {
    const { code, hostToken } = await freshRoom('reflexe');
    const { host } = await hostOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    await call(host, 'host:addBot');
    await call(host, 'host:addBot');
    const start = await call(host, 'host:start');
    expect(start.ok).toBe(true);
    const moved = await call(ana.socket, 'player:lobby-move', { x: 0.5, y: 0.5 });
    expect(moved.ok).toBe(false);
    expect(moved.error).toMatch(/salon/);
    host.disconnect();
  });
});

describe('Présence dans le salon : émotions', () => {
  it('diffuse l’émotion à toute la salle, sans la garder', async () => {
    const { code, hostToken } = await freshRoom();
    const { host, views } = await hostOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    const leo = await joinAs(code, 'Léo');
    const hostView = await until(views, (v) => v.lobby.players.length === 2);
    const anaId = hostView.lobby.players.find((p) => p.name === 'Ana')!.id;

    expect((await call(ana.socket, 'player:lobby-mood', { mood: 'joy' })).ok).toBe(true);
    const received = await until(leo.moods, (e) => e.playerId === anaId);
    expect(received.mood).toBe('joy');
    expect(typeof received.id).toBe('string');

    // Le repos n'est pas une émotion : refusé.
    expect((await call(ana.socket, 'player:lobby-mood', { mood: 'idle' })).ok).toBe(false);
    host.disconnect();
  });

  it('diffuse un visage du profil à toute la salle, sans attitude, et refuse les choix doubles ou inconnus', async () => {
    const { code, hostToken } = await freshRoom();
    const { host, views } = await hostOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    const leo = await joinAs(code, 'Léo');
    const hostView = await until(views, (v) => v.lobby.players.length === 2);
    const anaId = hostView.lobby.players.find((p) => p.name === 'Ana')!.id;

    expect((await call(ana.socket, 'player:lobby-mood', { face: 'rieur' })).ok).toBe(true);
    const received = await until(leo.moods, (e) => e.playerId === anaId);
    expect(received.face).toBe('rieur');
    expect(received.mood).toBeNull();

    // Un visage inconnu, ou une attitude et un visage à la fois : refusés.
    expect((await call(ana.socket, 'player:lobby-mood', { face: 'coucou' })).ok).toBe(false);
    expect((await call(ana.socket, 'player:lobby-mood', { mood: 'joy', face: 'rieur' })).ok).toBe(false);
    host.disconnect();
  });

  it('limite le rythme des émotions : 6 toutes les 4 secondes, puis refus', async () => {
    const { code, hostToken } = await freshRoom();
    const { host } = await hostOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) results.push((await call(ana.socket, 'player:lobby-mood', { mood: 'wave' })).ok);
    expect(results.slice(0, 6).every(Boolean)).toBe(true);
    expect(results.slice(6).some((ok) => !ok)).toBe(true);
    host.disconnect();
  });
});
