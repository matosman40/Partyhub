import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { EVENEMENTS_ACCUSE_SEUL } from '../realtime/hub.js';

/**
 * Un client malveillant ou mal écrit peut émettre sans accusé, ou avec une charge à la place de l’accusé.
 * Sans garde, `ack(...)` lève hors du gestionnaire et l’exception non rattrapée arrête le serveur.
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

interface Ack {
  ok: boolean;
  error?: string;
  playerId?: string;
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: Ack) => resolve(res));
  });
}

function emitRaw(socket: Client, event: string, ...args: unknown[]): void {
  (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args);
}

/** Événements déclarés par `socket.on(...)` dans le hub, lus dans sa source pour ne pas dériver. */
function evenementsDuHub(): { tous: string[]; accuseSeul: string[] } {
  const source = readFileSync(fileURLToPath(new URL('../realtime/hub.ts', import.meta.url)), 'utf8');
  const tous = [...source.matchAll(/socket\.on\('([a-z]+:[a-zA-Z-]+)'/g)].map((m) => m[1]!);
  const accuseSeul = [...source.matchAll(/socket\.on\('([a-z]+:[a-zA-Z-]+)',\s*\(ack\)\s*=>/g)].map((m) => m[1]!);
  return { tous, accuseSeul };
}

describe('Accusé garanti pour chaque événement du hub', () => {
  it('la liste des événements « accusé seul » est d’accord avec les gestionnaires', () => {
    const { tous, accuseSeul } = evenementsDuHub();
    expect(tous.length).toBeGreaterThan(30);
    expect([...EVENEMENTS_ACCUSE_SEUL].sort()).toEqual([...accuseSeul].sort());
  });

  it('émettre sans accusé, ou avec une charge à sa place, ne fait jamais tomber le serveur', async () => {
    const { tous } = evenementsDuHub();
    const socket = await connect();
    // Pas de salle, pas de compte : le cas d’un client anonyme.
    for (const event of tous) {
      emitRaw(socket, event);
      emitRaw(socket, event, {});
      emitRaw(socket, event, 'n’importe quoi');
      emitRaw(socket, event, null);
    }
    // Une exception non rattrapée dans un gestionnaire ferait échouer la suite (erreur non gérée) ;
    // et le serveur doit encore répondre, y compris sur la même socket.
    const reponse = await call(socket, 'player:ready', { ready: true });
    expect(reponse.ok).toBe(false);
    expect(typeof reponse.error).toBe('string');
    expect((await fetch(`${base}/api/health`)).ok).toBe(true);
  });
});

describe('Geste du plateau : budget séparé', () => {
  it('une rafale de gestes n’épuise pas le budget des autres commandes du joueur', async () => {
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'plateau-test', practice: false }),
    });
    expect(res.ok).toBe(true);
    const { code } = (await res.json()) as { code: string };
    const joueur = await connect();
    expect((await call(joueur, 'player:join', { code, name: 'Rafale' })).ok).toBe(true);

    const reponses: Ack[] = [];
    for (let i = 0; i < 40; i++)
      reponses.push(await call(joueur, 'player:grille', { type: 'marcher', dir: i % 2 ? 'left' : 'right' }));
    expect(reponses.some((r) => r.error === 'Doucement avec les gestes.')).toBe(true);
    // Le budget global (20 commandes / 5 s) n’a pas été consommé par les gestes.
    expect(reponses.some((r) => r.error?.startsWith('Trop de commandes'))).toBe(false);
    const prete = await call(joueur, 'player:ready', { ready: true });
    expect(prete.error ?? '').not.toMatch(/Trop de commandes/);
  });
});
