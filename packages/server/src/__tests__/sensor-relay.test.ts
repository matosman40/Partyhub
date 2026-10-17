import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  SENSOR_MAX_PER_SECOND,
  SENSOR_SEND_HZ,
  type ClientToServerEvents,
  type SensorEvent,
  type ServerToClientEvents,
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

function call(socket: Client, event: string, ...args: unknown[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: { ok: boolean }) =>
      resolve(res),
    );
  });
}

function track(socket: Client, event: 'room:sensor'): SensorEvent[] {
  const list: SensorEvent[] = [];
  socket.on(event, (v) => list.push(v));
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freshRoom(gameId = 'reflexe') {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId, practice: false }),
  });
  return (await res.json()) as { code: string; hostToken: string };
}

async function screenOf(code: string, hostToken: string) {
  const screen = await connect();
  const sensors = track(screen, 'room:sensor');
  expect((await call(screen, 'host:connect', { code, hostToken, screen: true })).ok).toBe(true);
  return { screen, sensors };
}

async function joinAs(code: string, name: string) {
  const socket = await connect();
  expect((await call(socket, 'player:join', { code, name })).ok).toBe(true);
  return socket;
}

describe('Capteurs du téléphone : relais vers l’écran principal', () => {
  it('ne relaie rien hors partie', async () => {
    const { code, hostToken } = await freshRoom();
    const { screen, sensors } = await screenOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    ana.emit('player:sensor', { x: 0.5, y: -0.2, energy: 0.1 });
    await pause(250);
    expect(sensors).toHaveLength(0);
    screen.disconnect();
  });

  it('relaie chaque échantillon à l’écran pendant la partie, avec l’identifiant du joueur', async () => {
    const { code, hostToken } = await freshRoom('reflexe');
    const { screen, sensors } = await screenOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    await call(screen, 'host:addBot');
    await call(screen, 'host:addBot');
    expect((await call(screen, 'host:start')).ok).toBe(true);

    ana.emit('player:sensor', { x: 0.25, y: -0.5, energy: 0.75 });
    const relayed = await until(sensors, (e) => e.x === 0.25);
    expect(relayed).toMatchObject({ x: 0.25, y: -0.5, energy: 0.75 });
    expect(typeof relayed.playerId).toBe('string');
    screen.disconnect();
  });

  it('refuse un échantillon hors bornes', async () => {
    const { code, hostToken } = await freshRoom('reflexe');
    const { screen, sensors } = await screenOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    await call(screen, 'host:addBot');
    await call(screen, 'host:addBot');
    await call(screen, 'host:start');
    ana.emit('player:sensor', { x: 3, y: 0, energy: 0 } as unknown as { x: number; y: number; energy: number });
    ana.emit('player:sensor', { x: 0, y: 0, energy: 'fort' } as unknown as { x: number; y: number; energy: number });
    await pause(250);
    expect(sensors).toHaveLength(0);
    screen.disconnect();
  });

  it('limite le débit par socket : une rafale n’est pas relayée en entier', async () => {
    const { code, hostToken } = await freshRoom('reflexe');
    const { screen, sensors } = await screenOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    await call(screen, 'host:addBot');
    await call(screen, 'host:addBot');
    await call(screen, 'host:start');
    for (let i = 0; i < 80; i++) ana.emit('player:sensor', { x: 0.01 * i, y: 0, energy: 0 });
    await pause(400);
    expect(sensors.length).toBeGreaterThan(0);
    expect(sensors.length).toBeLessThanOrEqual(SENSOR_MAX_PER_SECOND);
    screen.disconnect();
  });

  it('relaie un envoi au débit normal du téléphone sans en perdre', async () => {
    const { code, hostToken } = await freshRoom('reflexe');
    const { screen, sensors } = await screenOf(code, hostToken);
    const ana = await joinAs(code, 'Ana');
    await call(screen, 'host:addBot');
    await call(screen, 'host:addBot');
    await call(screen, 'host:start');
    // Une seconde d'envoi au débit du téléphone : chaque échantillon doit arriver à l'écran.
    const gap = 1000 / SENSOR_SEND_HZ;
    for (let i = 0; i < SENSOR_SEND_HZ; i++) {
      ana.emit('player:sensor', { x: i / SENSOR_SEND_HZ, y: 0, energy: 0 });
      await pause(gap);
    }
    await pause(200);
    expect(sensors.length).toBe(SENSOR_SEND_HZ);
    screen.disconnect();
  });
});
