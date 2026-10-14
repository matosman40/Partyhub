import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ObserverRoomView,
  PlayerRoomView,
  HostRoomView,
  ServerToClientEvents,
} from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import { MAX_OBSERVERS } from '../rooms/room.js';
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

function connect(headers: Record<string, string> = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = ioClient(base, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: headers,
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

/** Garde l'historique des vues reçues, pour ne pas manquer un événement déjà passé. */
function track<T>(socket: Client, event: string): T[] {
  const list: T[] = [];
  (socket as any).on(event, (v: T) => list.push(v));
  return list;
}

/** Attend qu'une vue reçue (la plus récente d'abord) satisfasse le prédicat. */
async function until<T>(list: T[], predicate: (v: T) => boolean, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = [...list].reverse().find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Condition non atteinte à temps');
}

/** Salle vide : pas de robots (le mode test en ajoute trois), pour compter exactement les joueurs. */
async function freshRoom(gameId = 'reflexe') {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId, practice: false }),
  });
  return (await res.json()) as { code: string; hostToken: string };
}

async function hostOf(code: string, hostToken: string): Promise<Client> {
  const host = await connect();
  const res = await call(host, 'host:connect', { code, hostToken });
  expect(res.ok).toBe(true);
  return host;
}

describe('Observateurs', () => {
  it('voit le salon sans jouer : aucune place, aucune action de jeu', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    const observer = await connect();
    const views = track<ObserverRoomView>(observer, 'room:observer');
    const res = await call(observer, 'observer:join', { code });
    expect(res.ok).toBe(true);
    const seen = await until(views, (v) => v.lobby.observers.count === 1);
    expect(seen.lobby.code).toBe(code);
    expect(seen.lobby.players).toHaveLength(0);
    expect(seen.lobby.observers.count).toBe(1);
    expect(seen.game).toBeNull();

    // Une commande de joueur est refusée à un observateur.
    const action = await call(observer, 'player:action', { commandId: 'c1', type: 'x' });
    expect(action.ok).toBe(false);
    // Et une commande d'hôte aussi.
    const start = await call(observer, 'host:start');
    expect(start.ok).toBe(false);

    host.disconnect();
  });

  it('ne compte pas comme joueur : la partie ne démarre pas avec des observateurs seuls', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    const observer = await connect();
    await call(observer, 'observer:join', { code });
    const start = await call(host, 'host:start');
    expect(start.ok).toBe(false);
    expect(start.error).toMatch(/joueur/);
    host.disconnect();
    observer.disconnect();
  });

  it('pendant la partie, l’observateur reçoit l’état public seulement, jamais l’état de l’hôte', async () => {
    const { code, hostToken } = await freshRoom('reflexe');
    const host = await hostOf(code, hostToken);
    await call(host, 'host:addBot');
    await call(host, 'host:addBot');
    await call(host, 'host:addBot');
    const observer = await connect();
    const views = track<ObserverRoomView>(observer, 'room:observer');
    await call(observer, 'observer:join', { code });
    const started = await call(host, 'host:start');
    expect(started.ok).toBe(true);
    const seen = await until(views, (v) => v.game !== null);
    expect(seen.game).not.toBeNull();
    expect(seen.game).toHaveProperty('public');
    expect(seen.game).not.toHaveProperty('host');
    host.disconnect();
    observer.disconnect();
  });

  it('peut participer à la discussion sous un nom d’observateur', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    const observer = await connect();
    await call(observer, 'observer:join', { code });
    const messages = track<{ from: string; text: string }>(host, 'room:chat');
    const res = await call(observer, 'observer:chat', { text: 'Bonne soirée !' });
    expect(res.ok).toBe(true);
    const message = await until(messages, (m) => m.text === 'Bonne soirée !');
    expect(message.from).toBe('Observateur 1');
    expect(message.text).toBe('Bonne soirée !');
    host.disconnect();
    observer.disconnect();
  });

  it('refuse un observateur au-delà de la limite de la salle', async () => {
    const { code } = await freshRoom();
    const extras: Client[] = [];
    for (let i = 0; i < MAX_OBSERVERS; i++) {
      const s = await connect();
      expect((await call(s, 'observer:join', { code })).ok).toBe(true);
      extras.push(s);
    }
    const late = await connect();
    const refused = await call(late, 'observer:join', { code });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/observateurs/);
    for (const s of [...extras, late]) s.disconnect();
  });

  it('prend le type d’appareil déclaré, sinon celui de son identifiant navigateur', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    const views = track<HostRoomView>(host, 'room:host');
    const declared = await connect();
    const joined = await call(declared, 'player:join', {
      code,
      name: 'Tablette',
      device: { kind: 'tablet', width: 1024, height: 768, touch: true, orientation: 'landscape' },
    });
    expect(joined.ok).toBe(true);

    const fromAgent = await connect({
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
    const joined2 = await call(fromAgent, 'player:join', { code, name: 'Phone' });
    expect(joined2.ok).toBe(true);

    const view = await until(
      views,
      (v) => v.lobby.players.length === 2 && v.lobby.players.every((p) => p.devices.length === 1),
    );
    const byName = Object.fromEntries(view.lobby.players.map((p) => [p.name, p.devices]));
    expect(byName.Tablette).toEqual(['tablet']);
    expect(byName.Phone).toEqual(['phone']);
    host.disconnect();
    declared.disconnect();
    fromAgent.disconnect();
  });

  it('un second appareil rejoint la même place avec le jeton : deux appareils sur un joueur', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    const views = track<HostRoomView>(host, 'room:host');
    const first = await connect();
    const joined = await call(first, 'player:join', { code, name: 'Famille', device: { kind: 'phone' } });
    expect(joined.ok).toBe(true);

    const second = await connect();
    const again = await call(second, 'player:join', {
      code,
      name: 'ignoré',
      token: joined.token,
      device: { kind: 'tablet' },
    });
    expect(again.ok).toBe(true);
    expect(again.playerId).toBe(joined.playerId);

    const seen = await until(views, (v) => v.lobby.players.some((p) => p.devices.length === 2));
    const player = seen.lobby.players.find((p) => p.name === 'Famille');
    expect(player?.devices.sort()).toEqual(['phone', 'tablet']);
    expect(seen.lobby.players).toHaveLength(1);
    host.disconnect();
    first.disconnect();
    second.disconnect();
  });

  it('quitter le salon d’observateur libère la place et met à jour le compte', async () => {
    const { code, hostToken } = await freshRoom();
    const host = await hostOf(code, hostToken);
    const views = track<HostRoomView>(host, 'room:host');
    const observer = await connect();
    await call(observer, 'observer:join', { code });
    await until(views, (v) => v.lobby.observers.count === 1);
    expect((await call(observer, 'observer:leave')).ok).toBe(true);
    await until(views, (v) => v.lobby.observers.count === 0);
    host.disconnect();
    observer.disconnect();
  });

  it('un joueur reçoit toujours sa propre vue (les observateurs ne la perturbent pas)', async () => {
    const { code } = await freshRoom();
    const observer = await connect();
    await call(observer, 'observer:join', { code });
    const player = await connect();
    const views = track<PlayerRoomView>(player, 'room:player');
    expect((await call(player, 'player:join', { code, name: 'Léa' })).ok).toBe(true);
    expect((await until(views, (v) => v.you.name === 'Léa')).you.name).toBe('Léa');
    player.disconnect();
    observer.disconnect();
  });
});
