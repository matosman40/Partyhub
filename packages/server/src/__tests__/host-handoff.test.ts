import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@partyhub/shared';
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

type Ack = { ok: boolean; error?: string } & Record<string, unknown>;

function call(socket: Client, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: Ack) => resolve(res));
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

async function hostOf(code: string, hostToken: string) {
  const host = await connect();
  expect((await call(host, 'host:connect', { code, hostToken })).ok).toBe(true);
  return host;
}

describe('Transfert de l’accès hôte à un téléphone', () => {
  it('crée un code à 6 chiffres côté hôte, valable une fois', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    const handoff = await call(host, 'host:handoff');
    expect(handoff.ok).toBe(true);
    expect(String(handoff.code)).toMatch(/^\d{6}$/);
    expect(typeof handoff.expiresAt).toBe('number');

    const phone = await connect();
    const first = await call(phone, 'host:claim', { code, handoffCode: String(handoff.code) });
    expect(first.ok).toBe(true);
    expect(first.hostToken).toBe(hostToken);

    // Le même code ne sert plus une seconde fois.
    const second = await call(await connect(), 'host:claim', { code, handoffCode: String(handoff.code) });
    expect(second.ok).toBe(false);
  });

  it('refuse un mauvais code, puis bloque après cinq essais', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    const handoff = await call(host, 'host:handoff');
    const real = String(handoff.code);
    const wrong = real === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const res = await call(await connect(), 'host:claim', { code, handoffCode: wrong });
      expect(res.ok).toBe(false);
    }
    // Après cinq essais, même le bon code est refusé : il faut un nouveau code.
    const blocked = await call(await connect(), 'host:claim', { code, handoffCode: real });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/Trop d’essais/);
  });

  it('réserve la création du code à l’hôte', async () => {
    await freshRoom();
    const player = await connect();
    const res = await call(player, 'host:handoff');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/hôte/);
  });

  it('rejette un format de code invalide sans toucher à la salle', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    await call(host, 'host:handoff');
    const res = await call(await connect(), 'host:claim', { code, handoffCode: 'abc' });
    expect(res.ok).toBe(false);
  });
});
