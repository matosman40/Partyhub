import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Sous-titres à un seul joueur : on ne peut pas voter pour sa propre réplique, donc sans
 * deuxième joueur (robot compris), personne ne marque de point. La salle doit refuser le lancement.
 */

type Client = Socket<ClientToServerEvents, ServerToClientEvents>;

const PASSWORD = 'captions-players-password';
let server: PartyServer;
let base: string;
let cookie: string;
let dataDir: string;
const sockets: Client[] = [];

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = ioClient(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve) => {
    (socket as any).emit(event, ...args, (res: unknown) => resolve(res));
  });
}

async function admin(urlPath: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { cookie, ...((init.headers as Record<string, string>) ?? {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  return fetch(`${base}${urlPath}`, { ...init, headers, body });
}

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'ph-captions-players-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: PASSWORD,
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Sous-titres : nombre de joueurs', () => {
  let gameId: string;

  beforeAll(async () => {
    const res = await admin('/api/admin/media-games', {
      method: 'POST',
      json: {
        mode: 'sous-titres',
        kind: 'film',
        name: 'Sous-titres test',
        description: 'Test du nombre de joueurs.',
        icon: '💬',
        rules: { questionCount: 2, answerSeconds: 45, speedBonus: false },
        items: [
          {
            id: 'scene-1',
            answer: '',
            aliases: [],
            detail: 'Français',
            source: { type: 'youtube', videoId: 'abcdefghijk' },
            startSec: 0,
            durationSec: 6,
          },
          {
            id: 'scene-2',
            answer: '',
            aliases: [],
            detail: 'Français',
            source: { type: 'youtube', videoId: 'bcdefghijkl' },
            startSec: 4,
            durationSec: 6,
          },
        ],
      },
    });
    expect(res.status).toBe(201);
    gameId = ((await res.json()) as { id: string }).id;
  });

  it('annonce deux joueurs au minimum au catalogue', async () => {
    const catalog = (await (await fetch(`${base}/api/catalog`)).json()) as {
      games: { id: string; minPlayers: number }[];
    };
    const game = catalog.games.find((g) => g.id === gameId);
    expect(game?.minPlayers).toBe(2);
  });

  it('refuse de lancer une partie à un seul joueur, puis la lance avec un robot', async () => {
    const created = await (
      await fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId, practice: false }),
      })
    ).json();

    const host = await connect();
    const hostAck = await call(host, 'host:connect', { code: created.code, hostToken: created.hostToken });
    expect(hostAck.ok).toBe(true);

    const player = await connect();
    const joined = await call(player, 'player:join', { code: created.code, name: 'Alice' });
    expect(joined.ok).toBe(true);

    const alone = await call(host, 'host:start');
    expect(alone.ok).toBe(false);
    expect(alone.error).toMatch(/au moins 2 joueurs/);

    const bot = await call(host, 'host:addBot');
    expect(bot.ok).toBe(true);

    const started = await call(host, 'host:start');
    expect(started.ok).toBe(true);
  });
});
