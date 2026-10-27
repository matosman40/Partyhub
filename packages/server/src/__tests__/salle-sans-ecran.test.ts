import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, HostRoomView, PlayerRoomView, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Partie sans aucun écran principal : un téléphone crée la salle et la pilote, les autres téléphones
 * jouent. Un joueur qui se déconnecte en cours de partie ne bloque pas la manche, et il revient
 * avec son jeton, à la même place.
 */
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: PartyServer;
let base: string;
const clients: Client[] = [];

beforeAll(async () => {
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: '/tmp/partyhub-tests-sans-ecran',
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

function call(socket: Client, event: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve) => {
    (socket as any).emit(event, ...args, (res: unknown) => resolve(res));
  });
}

/** Attend la prochaine vue qui satisfait le prédicat (écran hôte ou téléphone). */
function nextView<T>(
  socket: Client,
  event: 'room:host' | 'room:player',
  predicate: (view: T) => boolean,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (view: T) => {
      if (!predicate(view)) return;
      clearTimeout(timer);
      (socket as any).off(event, handler);
      resolve(view);
    };
    const timer = setTimeout(() => {
      (socket as any).off(event, handler);
      reject(new Error(`Délai dépassé en attendant ${event}`));
    }, timeoutMs);
    (socket as any).on(event, handler);
  });
}

/** Une vue est reçue même si rien n’a changé : on lit la dernière, ou on attend la suivante. */
function phaseOf(view: HostRoomView): string | undefined {
  return (view.game?.public as { phase?: string } | null | undefined)?.phase;
}

interface Phone {
  socket: Client;
  playerId: string;
  token: string;
}

async function joinPhone(code: string, name: string): Promise<Phone> {
  const socket = await connect();
  const ack = await call(socket, 'player:join', { code, name });
  expect(ack.ok, `arrivée de ${name}`).toBe(true);
  return { socket, playerId: ack.playerId, token: ack.token };
}

describe('partie sans écran principal', () => {
  it('un téléphone crée la salle, les joueurs votent, un joueur se déconnecte puis revient', async () => {
    // Le téléphone organisateur crée la salle lui-même : aucun écran n'est relié.
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'plutot-qui' }),
    });
    expect(res.status).toBe(201);
    const { code, hostToken } = (await res.json()) as { code: string; hostToken: string };

    const host = await connect();
    const hostAck = await call(host, 'host:connect', { code, hostToken });
    expect(hostAck.ok).toBe(true);

    const a = await joinPhone(code, 'Ana');
    const b = await joinPhone(code, 'Léo');
    const c = await joinPhone(code, 'Max');

    // Écouter la phase de vote avant de lancer, pour ne pas manquer la vue.
    const voting = nextView<PlayerRoomView>(
      a.socket,
      'room:player',
      (v) => (v.game?.public as { phase?: string } | null)?.phase === 'vote',
    );
    const started = await call(host, 'host:start');
    expect(started.ok, 'lancement sans écran').toBe(true);
    await voting;

    // Léo se déconnecte en pleine manche.
    b.socket.disconnect();

    // Les deux joueurs restés en ligne votent : la manche continue sans attendre Léo.
    const reveal = nextView<HostRoomView>(host, 'room:host', (v) => phaseOf(v) === 'reveal');
    const voteA = await call(a.socket, 'player:action', {
      commandId: 'v-a',
      type: 'vote',
      payload: { target: c.playerId },
    });
    expect(voteA.ok).toBe(true);
    const voteC = await call(c.socket, 'player:action', {
      commandId: 'v-c',
      type: 'vote',
      payload: { target: a.playerId },
    });
    expect(voteC.ok).toBe(true);
    await reveal;

    // Léo revient avec son jeton : même place, même identifiant de joueur.
    const back = await connect();
    // Écouter la vue de Léo avant de rejoindre, pour ne pas manquer celle qui suit le retour.
    const backView = nextView<PlayerRoomView>(back, 'room:player', (v) => v.you?.id === b.playerId);
    const again = await call(back, 'player:join', { code, name: 'Léo', token: b.token });
    expect(again.ok, 'retour de Léo').toBe(true);
    expect(again.playerId).toBe(b.playerId);
    clients.push(back);

    const view = await backView;
    expect(view.game).not.toBeNull();
    expect(view.lobby).toBeDefined();
  });
});
