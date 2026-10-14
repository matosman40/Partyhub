import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  HostRoomView,
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

// --- Outils de test ----------------------------------------------------------

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

/** Émet une commande et attend son acquittement. */
function call(socket: Client, event: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve) => {
    (socket as any).emit(event, ...args, (res: unknown) => resolve(res));
  });
}

/** Attend le prochain événement de vue qui satisfait le prédicat. */
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

async function createRoom(gameId = 'quiz-party'): Promise<{ code: string; hostToken: string }> {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId }),
  });
  expect(res.status).toBe(201);
  return res.json() as Promise<{ code: string; hostToken: string }>;
}

async function connectHost(code: string, hostToken: string): Promise<Client> {
  const socket = await connect();
  const ack = await call(socket, 'host:connect', { code, hostToken });
  expect(ack.ok).toBe(true);
  return socket;
}

async function joinPlayer(code: string, name: string, token?: string) {
  const socket = await connect();
  const ack = await call(socket, 'player:join', { code, name, token });
  return { socket, ack };
}

// --- Tests -------------------------------------------------------------------

describe('API HTTP', () => {
  it('expose le catalogue des jeux activés', async () => {
    const res = await fetch(`${base}/api/catalog`);
    const body = (await res.json()) as { games: { id: string }[] };
    expect(body.games.map((g) => g.id)).toContain('quiz-party');
  });

  it('refuse la création d’une salle pour un jeu inconnu', async () => {
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'jeu-inexistant' }),
    });
    expect(res.status).toBe(404);
  });

  it('protège l’administration sans authentification', async () => {
    const res = await fetch(`${base}/api/admin/overview`);
    expect(res.status).toBe(401);
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'mauvais' }),
    });
    expect(login.status).toBe(401);
  });
});

describe('salles et connexions', () => {
  it('refuse un code de salle invalide ou inconnu', async () => {
    const socket = await connect();
    const bad = await call(socket, 'player:join', { code: 'AB', name: 'Alice' });
    expect(bad.ok).toBe(false);
    const unknown = await call(socket, 'player:join', { code: 'BCDF', name: 'Alice' });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/inconnu/);
  });

  it('refuse un jeton d’hôte incorrect', async () => {
    const room = await createRoom();
    const socket = await connect();
    const ack = await call(socket, 'host:connect', {
      code: room.code,
      hostToken: 'jeton-totalement-faux-0123456789',
    });
    expect(ack.ok).toBe(false);
  });

  it('connecte plusieurs joueurs et tient l’hôte informé', async () => {
    const room = await createRoom();
    const host = await connectHost(room.code, room.hostToken);

    const allThree = nextView<HostRoomView>(
      host,
      'room:host',
      (v) => v.lobby.players.length === 3,
    );
    const names = ['Alice', 'Bruno', 'Chloé'];
    const joins = await Promise.all(names.map((n) => joinPlayer(room.code, n)));
    for (const j of joins) expect(j.ack.ok).toBe(true);

    const view = await allThree;
    expect(view.lobby.players.map((p) => p.name).sort()).toEqual([...names].sort());
    expect(view.lobby.status).toBe('waiting');
  });

  it('refuse un pseudo déjà pris dans la même salle', async () => {
    const room = await createRoom();
    await connectHost(room.code, room.hostToken);
    const first = await joinPlayer(room.code, 'Dani');
    expect(first.ack.ok).toBe(true);
    const second = await joinPlayer(room.code, 'dani');
    expect(second.ack.ok).toBe(false);
    expect(second.ack.error).toMatch(/pris/);
  });

  it('reconnecte un joueur avec son jeton sans le supprimer', async () => {
    const room = await createRoom();
    await connectHost(room.code, room.hostToken);
    const first = await joinPlayer(room.code, 'Léa');
    expect(first.ack.ok).toBe(true);
    const { playerId, token } = first.ack;

    first.socket.disconnect();
    const again = await joinPlayer(room.code, 'Léa', token);
    expect(again.ack.ok).toBe(true);
    expect(again.ack.playerId).toBe(playerId);

    const stored = server.manager.getByCode(room.code)!;
    expect(stored.players.size).toBe(1);
  });

  it('isole les salles entre elles', async () => {
    const roomA = await createRoom();
    const roomB = await createRoom();
    await connectHost(roomA.code, roomA.hostToken);
    await connectHost(roomB.code, roomB.hostToken);

    const zoe = await joinPlayer(roomB.code, 'Zoé');
    expect(zoe.ack.ok).toBe(true);

    const a = server.manager.getByCode(roomA.code)!;
    const names = [...a.players.values()].map((p) => p.name);
    expect(names).not.toContain('Zoé');
  });

  it('nettoie les salles sans aucune connexion', async () => {
    const orphan = await createRoom();
    const kept = await createRoom();
    const keptHost = await connectHost(kept.code, kept.hostToken);

    const removed = server.manager.purgeIdle();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(server.manager.getByCode(orphan.code)).toBeUndefined();
    expect(server.manager.getByCode(kept.code)).toBeDefined();
    keptHost.disconnect();
  });
});

describe('contrôle des commandes', () => {
  it('refuse les commandes réservées à l’hôte venant d’un joueur', async () => {
    const room = await createRoom();
    await connectHost(room.code, room.hostToken);
    const { socket, ack } = await joinPlayer(room.code, 'Ezio');
    expect(ack.ok).toBe(true);

    const start = await call(socket, 'host:start');
    expect(start.ok).toBe(false);
    expect(start.error).toMatch(/réservée/);
  });

  it('refuse une action de jeu d’un socket qui n’est dans aucune salle', async () => {
    const socket = await connect();
    const res = await call(socket, 'player:action', {
      commandId: 'x-1',
      type: 'answer',
      payload: { choice: 0 },
    });
    expect(res.ok).toBe(false);
  });

  it('exclut un joueur retiré par l’hôte', async () => {
    const room = await createRoom();
    const host = await connectHost(room.code, room.hostToken);

    // Le listener est posé avant la connexion du joueur pour ne rien manquer.
    const seen = nextView<HostRoomView>(host, 'room:host', (v) =>
      v.lobby.players.some((p) => p.name === 'Farid'),
    );
    const { socket, ack } = await joinPlayer(room.code, 'Farid');
    expect(ack.ok).toBe(true);
    const view = await seen;
    const playerId = view.lobby.players.find((p) => p.name === 'Farid')!.id;

    const closed = new Promise<{ reason: string }>((resolve) => socket.once('room:closed', resolve));
    const res = await call(host, 'host:kick', { playerId });
    expect(res.ok).toBe(true);
    expect((await closed).reason).toBe('kicked');
  });
});

describe('partie Quiz Party', () => {
  it('déroule une partie complète : questions, réponses, scores et fin', async () => {
    const room = await createRoom();
    const host = await connectHost(room.code, room.hostToken);

    const p1 = await joinPlayer(room.code, 'Gina');
    const p2 = await joinPlayer(room.code, 'Hugo');
    expect(p1.ack.ok && p2.ack.ok).toBe(true);

    const cfg = await call(host, 'host:configure', {
      gameSettings: { questionCount: 2, answerSeconds: 10, speedBonus: true },
    });
    expect(cfg.ok).toBe(true);

    const started = nextView<HostRoomView>(
      host,
      'room:host',
      (v) => v.lobby.status === 'in_game' && v.game?.public && (v.game.public as any).phase === 'question',
    );
    expect((await call(host, 'host:start')).ok).toBe(true);
    const first = await started;
    expect((first.game!.public as any).total).toBe(2);

    // Question 1 : le même commandId envoyé deux fois ne compte qu'une fois.
    const dup = { commandId: 'cmd-unique-1', type: 'answer', payload: { choice: 0 } };
    expect((await call(p1.socket, 'player:action', dup)).ok).toBe(true);
    const again = await call(p1.socket, 'player:action', dup);
    expect(again.ok).toBe(true);
    expect(again.duplicate).toBe(true);

    const revealed = nextView<HostRoomView>(
      host,
      'room:host',
      (v) => (v.game?.public as any)?.phase === 'reveal',
    );
    const answer2 = await call(p2.socket, 'player:action', {
      commandId: 'cmd-p2-1',
      type: 'answer',
      payload: { choice: 1 },
    });
    expect(answer2.ok).toBe(true);
    const reveal1 = await revealed;
    expect((reveal1.game!.public as any).results).toHaveLength(2);
    expect((reveal1.game!.public as any).answer).toBeTypeOf('number');

    // Une même personne ne peut pas répondre deux fois à la même question.
    const late = await call(p2.socket, 'player:action', {
      commandId: 'cmd-p2-2',
      type: 'answer',
      payload: { choice: 2 },
    });
    expect(late.ok).toBe(false);

    // Question 2 puis fin de partie.
    const q2 = nextView<HostRoomView>(
      host,
      'room:host',
      (v) => (v.game?.public as any)?.phase === 'question' && (v.game?.public as any)?.index === 1,
    );
    expect((await call(host, 'host:next')).ok).toBe(true);
    await q2;

    // Les deux joueurs répondent : la révélation de la question 2 est automatique.
    const revealed2 = nextView<HostRoomView>(
      host,
      'room:host',
      (v) => (v.game?.public as any)?.phase === 'reveal' && (v.game?.public as any)?.index === 1,
    );
    await call(p1.socket, 'player:action', { commandId: 'c-q2-1', type: 'answer', payload: { choice: 0 } });
    await call(p2.socket, 'player:action', { commandId: 'c-q2-2', type: 'answer', payload: { choice: 0 } });
    await revealed2;

    // Après la révélation, l'hôte passe à la fin de la partie.
    const finalView = nextView<HostRoomView>(
      host,
      'room:host',
      (v) => (v.game?.public as any)?.phase === 'final',
    );
    expect((await call(host, 'host:next')).ok).toBe(true);
    const done = await finalView;
    expect(done.lobby.status).toBe('ended');
    const ranking = (done.game!.public as any).ranking as { rank: number; points: number }[];
    expect(ranking.length).toBe(2);
    expect(ranking[0]!.rank).toBe(1);

    // Relance avec les mêmes joueurs. L'écouteur est posé avant la commande :
    // la diffusion part avant l'acquittement.
    const back = nextView<HostRoomView>(host, 'room:host', (v) => v.lobby.status === 'waiting');
    const replay = await call(host, 'host:replay');
    expect(replay.ok).toBe(true);
    expect((await back).game).toBeNull();
  });

  it('empêche de lancer une partie sans assez de joueurs', async () => {
    const room = await createRoom();
    const host = await connectHost(room.code, room.hostToken);
    const res = await call(host, 'host:start');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/au moins/);
  });
});
