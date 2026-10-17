import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/** Mode test : le curseur de cadence règle les émotions, et l'extinction rend la cadence normale. */

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: PartyServer;
let base: string;
let dataDir: string;
let adminCookie = '';
const clients: Client[] = [];

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-test-mode-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'test-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  expect(login.status).toBe(200);
  adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function admin(path: string, init: RequestInit = {}) {
  return fetch(`${base}/api/admin${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: adminCookie },
  });
}

function setTestMode(mode: { enabled: boolean; factor: number }) {
  return admin('/test-mode', { method: 'PUT', body: JSON.stringify(mode) });
}

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

async function freshRoom() {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'reflexe', practice: false }),
  });
  return (await res.json()) as { code: string; hostToken: string };
}

async function joinAs(code: string, name: string): Promise<Client> {
  const socket = await connect();
  const ack = await call(socket, 'player:join', { code, name });
  expect(ack.ok).toBe(true);
  return socket;
}

describe('Mode test : réglage administrateur', () => {
  it('est éteint par défaut et lisible sans connexion', async () => {
    const res = await fetch(`${base}/api/test-mode`);
    expect(await res.json()).toEqual({ mode: { enabled: false, factor: 1 } });
  });

  it('refuse sans connexion administrateur, et refuse une cadence inconnue', async () => {
    const anonymous = await fetch(`${base}/api/admin/test-mode`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, factor: 2 }),
    });
    expect(anonymous.status).toBeGreaterThanOrEqual(400);
    expect((await setTestMode({ enabled: true, factor: 3 })).status).toBe(400);
  });

  it('enregistre le réglage et le rend à tous', async () => {
    expect((await setTestMode({ enabled: true, factor: 10 })).status).toBe(200);
    const res = await fetch(`${base}/api/test-mode`);
    expect(await res.json()).toEqual({ mode: { enabled: true, factor: 10 } });
    await setTestMode({ enabled: false, factor: 1 });
  });
});

describe('Mode test : cadence des émotions', () => {
  it('multiplie la cadence par le facteur, puis revient à la normale à l’extinction', async () => {
    // Facteur ×2 : 12 émotions par fenêtre de 4 secondes au lieu de 6. Reste sous la limite générale des commandes.
    expect((await setTestMode({ enabled: true, factor: 2 })).status).toBe(200);
    const { code } = await freshRoom();
    const ana = await joinAs(code, 'Ana');

    const boosted: boolean[] = [];
    for (let i = 0; i < 13; i++) boosted.push((await call(ana, 'player:lobby-mood', { mood: 'wave' })).ok);
    expect(boosted.slice(0, 12).every(Boolean)).toBe(true);
    expect(boosted[12]).toBe(false);

    await setTestMode({ enabled: false, factor: 2 });
    const ben = await joinAs(code, 'Ben');
    const normal: boolean[] = [];
    for (let i = 0; i < 8; i++) normal.push((await call(ben, 'player:lobby-mood', { mood: 'wave' })).ok);
    expect(normal.slice(0, 6).every(Boolean)).toBe(true);
    expect(normal.slice(6).some((ok) => !ok)).toBe(true);
  });
});
