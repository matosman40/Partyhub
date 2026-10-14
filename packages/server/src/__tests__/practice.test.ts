import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, HostRoomView, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Mode test (« Essayer seul ») : une salle d'entraînement ajoute des robots,
 * l'hôte lance la partie et les robots jouent sans aucun téléphone connecté.
 */

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: PartyServer;
let base: string;
const sockets: Client[] = [];

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
  for (const s of sockets) s.disconnect();
  await server.close();
});

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

function nextHostView(socket: Client, predicate: (v: HostRoomView) => boolean, ms = 8000): Promise<HostRoomView> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Délai dépassé (vue hôte)')), ms);
    const handler = (v: HostRoomView) => {
      if (!predicate(v)) return;
      clearTimeout(timer);
      socket.off('room:host', handler);
      resolve(v);
    };
    socket.on('room:host', handler);
  });
}

describe('Essayer seul : salle d’entraînement avec robots', () => {
  it('crée une salle avec des robots, puis les robots jouent sans téléphone', async () => {
    const created = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'bombes-party', practice: true }),
    }).then((r) => r.json());
    expect(created.code).toBeTruthy();

    const host = await connect();
    const ack = await call(host, 'host:connect', { code: created.code, hostToken: created.hostToken });
    expect(ack.ok).toBe(true);

    const started = nextHostView(host, (v) => v.lobby.status === 'in_game');
    const startAck = await call(host, 'host:start');
    expect(startAck.ok).toBe(true);
    const first = await started;

    const botCount = first.lobby.players.filter((p: { bot: boolean }) => p.bot).length;
    expect(botCount).toBeGreaterThanOrEqual(2);

    // Les robots agissent : une bombe apparaît ou une case du plateau change.
    const initial = JSON.stringify((first.game?.public as { units: unknown }).units);
    const moved = await nextHostView(
      host,
      (v) => {
        const pub = v.game?.public as { units?: unknown; bombs?: unknown[] } | undefined;
        return !!pub && (JSON.stringify(pub.units) !== initial || (pub.bombs?.length ?? 0) > 0);
      },
      8000,
    );
    expect(moved.game).not.toBeNull();
  });
});
