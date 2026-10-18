import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, HostRoomView, PlayerRoomView, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Parcours complets des nouveaux jeux à travers le vrai serveur (HTTP + Socket.IO) :
 * création de salle, démarrage, actions des joueurs et confidentialité des vues.
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
    const socket: Client = ioClient(base, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
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

/** Attend la prochaine vue hôte qui satisfait le prédicat (le listener doit être posé avant l'action). */
function nextHostView(socket: Client, predicate: (v: HostRoomView) => boolean): Promise<HostRoomView> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Délai dépassé (vue hôte)')), 3000);
    const handler = (v: HostRoomView) => {
      if (!predicate(v)) return;
      clearTimeout(timer);
      socket.off('room:host', handler);
      resolve(v);
    };
    socket.on('room:host', handler);
  });
}

function nextPlayerView(socket: Client, predicate: (v: PlayerRoomView) => boolean): Promise<PlayerRoomView> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Délai dépassé (vue joueur)')), 3000);
    const handler = (v: PlayerRoomView) => {
      if (!predicate(v)) return;
      clearTimeout(timer);
      socket.off('room:player', handler);
      resolve(v);
    };
    socket.on('room:player', handler);
  });
}

interface TestPlayer {
  sock: Client;
  id: string;
  name: string;
}

/** Crée une salle, connecte l'hôte et les joueurs. */
async function openRoom(gameId: string, names: string[]) {
  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId }),
  }).then((r) => r.json());

  const host = await connect();
  const hostAck = await call(host, 'host:connect', { code: created.code, hostToken: created.hostToken });
  expect(hostAck.ok).toBe(true);

  const players: TestPlayer[] = [];
  for (const name of names) {
    const sock = await connect();
    const joined = await call(sock, 'player:join', { code: created.code, name });
    expect(joined.ok).toBe(true);
    players.push({ sock, id: joined.playerId, name });
  }
  return { code: created.code as string, host, players };
}

/** Lance la partie et renvoie la phase publique annoncée à l'hôte. */
async function startGame(host: Client): Promise<HostRoomView> {
  const next = nextHostView(host, (v) => v.lobby.status === 'in_game');
  const ack = await call(host, 'host:start');
  expect(ack.ok).toBe(true);
  return next;
}

async function act(p: TestPlayer, type: string, payload: unknown) {
  return call(p.sock, 'player:action', { commandId: randomUUID(), type, payload });
}

describe('Association express — parcours complet', () => {
  it('va de l’écriture au vote anonyme puis à la révélation', async () => {
    const { host, players } = await openRoom('association', ['Ana', 'Ben', 'Cléo']);
    const started = await startGame(host);
    expect(started.game?.public).toMatchObject({ phase: 'write' });

    // Les écouteurs sont posés avant la dernière action qui ouvre le vote.
    const toVote = nextHostView(host, (v) => v.game?.public?.phase === 'vote');
    const myPositions = players.map((p) =>
      nextPlayerView(p.sock, (v) => v.game?.public?.phase === 'vote').then(
        (v) => (v.game?.player as { myOption: number }).myOption,
      ),
    );

    await Promise.all(players.map((p, i) => act(p, 'word', { word: `mot${i}` })));
    const voteView = await toVote;
    expect(voteView.game?.public.options).toHaveLength(3);
    // Le vote est anonyme : les pseudos n'apparaissent pas dans les options.
    expect(JSON.stringify(voteView.game?.public.options)).not.toMatch(/Ana|Ben|Cléo/);

    const positions = await Promise.all(myPositions);
    const reveal = nextHostView(host, (v) => v.game?.public?.phase === 'reveal');
    await Promise.all(players.map((p, i) => act(p, 'vote', { option: positions[i] === 0 ? 1 : 0 })));
    const revealed = await reveal;

    expect(revealed.game?.public.results).toHaveLength(3);
    const total = (revealed.game?.public.ranking as { points: number }[]).reduce((sum, e) => sum + e.points, 0);
    // Trois votes, 100 points chacun.
    expect(total).toBe(300);
  });
});

describe('L’imposteur parmi nous — confidentialité des rôles', () => {
  it('donne le mot aux membres de l’équipe, jamais à l’imposteur', async () => {
    const { host, players } = await openRoom('imposteur-parmi-nous', ['Ana', 'Ben', 'Cléo']);
    // Vues de départ : posées avant le lancement pour ne rien manquer.
    const firstViews = players.map((p) => nextPlayerView(p.sock, (v) => v.game !== null));
    await startGame(host);
    const views = await Promise.all(firstViews);

    const roles = views.map((v) => (v.game?.player as { role: { isImpostor: boolean; word: string | null } }).role);
    expect(roles.filter((r) => r.isImpostor)).toHaveLength(1);
    for (const r of roles) {
      if (r.isImpostor) expect(r.word).toBeNull();
      else expect(r.word).toEqual(expect.any(String));
    }
    // Le mot secret ne figure jamais dans la vue publique.
    const word = roles.find((r) => !r.isImpostor)!.word!;
    expect(JSON.stringify(views[0]!.game?.public)).not.toContain(word);
  });
});

describe('Plutôt qui ? et Plus ou moins — parcours minimal', () => {
  it('Plutôt qui : tout le monde vote pour Ana, la révélation arrive', async () => {
    const { host, players } = await openRoom('plutot-qui', ['Ana', 'Ben', 'Cléo']);
    const started = await startGame(host);
    expect(started.game?.public).toMatchObject({ phase: 'vote' });

    const reveal = nextHostView(host, (v) => v.game?.public?.phase === 'reveal');
    const anaId = players[0]!.id;
    await Promise.all(players.map((p) => act(p, 'vote', { target: anaId })));
    const revealed = await reveal;
    expect(revealed.game?.public.winners).toEqual(['Ana']);
    // Tout le monde a suivi la majorité (Ana) : 100 points chacun.
    expect(revealed.game?.public.ranking[0]?.points).toBe(100);
  });

  it('Plus ou moins : le pari est accepté et la carte suivante est révélée', async () => {
    const { host, players } = await openRoom('plus-ou-moins', ['Ana']);
    const started = await startGame(host);
    expect(started.game?.public).toMatchObject({ phase: 'bet' });
    expect(started.game?.public).not.toHaveProperty('deck');

    const reveal = nextHostView(host, (v) => v.game?.public?.phase === 'reveal');
    const ack = await act(players[0]!, 'bet', { direction: 'lower' });
    expect(ack.ok).toBe(true);
    const revealed = await reveal;
    expect(revealed.game?.public.revealed).toEqual(expect.objectContaining({ rank: expect.any(Number) }));
  });
});
