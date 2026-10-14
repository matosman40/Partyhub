import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  defaultCharacterFor,
  type ClientToServerEvents,
  type HostRoomView,
  type ServerToClientEvents,
} from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Personnage du profil : généré à l'inscription, modifiable, validé, et vu par la salle.
 */

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: PartyServer;
let base: string;
const sockets: Client[] = [];
const uniq = () => randomUUID().slice(0, 8).replace(/-/g, '');

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

function json(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

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

function waitForView(socket: Client, match: (v: HostRoomView) => boolean): Promise<HostRoomView> {
  return new Promise((resolve, reject) => {
    const on = (view: HostRoomView) => {
      if (!match(view)) return;
      clearTimeout(timer);
      socket.off('room:host', on);
      resolve(view);
    };
    const timer = setTimeout(() => {
      socket.off('room:host', on);
      reject(new Error('Aucune vue de salle reçue à temps'));
    }, 3000);
    socket.on('room:host', on);
  });
}

async function register(displayName: string) {
  const username = `${displayName.toLowerCase()}${uniq()}`.slice(0, 20);
  const reg = await json('/api/profiles/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'motdepasse1', displayName }),
  });
  const { token } = await reg.json();
  return { username, token, auth: { authorization: `Bearer ${token}` } };
}

const CUSTOM = { body: 3, skin: 4, hair: 2, hairColor: 5, accessory: 1 };

describe('Personnage du profil', () => {
  it('reçoit à l’inscription le personnage généré à partir de son identifiant', async () => {
    const { username, auth } = await register('Nina');
    const me = await (await json('/api/profiles/me', { headers: auth })).json();
    expect(me.profile.avatar.character).toEqual(defaultCharacterFor(username));
  });

  it('enregistre le personnage choisi et le renvoie au titulaire', async () => {
    const { auth } = await register('Omar');
    const put = await json('/api/profiles/me', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ avatarCharacter: CUSTOM }),
    });
    expect(put.status).toBe(200);
    const me = await (await json('/api/profiles/me', { headers: auth })).json();
    expect(me.profile.avatar.character).toEqual(CUSTOM);
  });

  it('refuse un personnage hors des listes, sans rien enregistrer', async () => {
    const { auth } = await register('Pia');
    await json('/api/profiles/me', { method: 'PUT', headers: auth, body: JSON.stringify({ avatarCharacter: CUSTOM }) });
    const bad = await json('/api/profiles/me', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ avatarCharacter: { ...CUSTOM, body: 99 } }),
    });
    expect(bad.status).toBe(400);
    const me = await (await json('/api/profiles/me', { headers: auth })).json();
    expect(me.profile.avatar.character).toEqual(CUSTOM);
  });

  it('revient au personnage généré quand il est remis à null', async () => {
    const { username, auth } = await register('Remi');
    await json('/api/profiles/me', { method: 'PUT', headers: auth, body: JSON.stringify({ avatarCharacter: CUSTOM }) });
    const reset = await json('/api/profiles/me', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ avatarCharacter: null }),
    });
    expect(reset.status).toBe(200);
    const me = await (await json('/api/profiles/me', { headers: auth })).json();
    expect(me.profile.avatar.character).toEqual(defaultCharacterFor(username));
  });

  it('est visible dans la salle, pour un profil connecté comme pour un invité', async () => {
    const { token, auth } = await register('Sara');
    await json('/api/profiles/me', { method: 'PUT', headers: auth, body: JSON.stringify({ avatarCharacter: CUSTOM }) });

    const created = await (
      await json('/api/rooms', { method: 'POST', body: JSON.stringify({ gameId: 'quiz-party' }) })
    ).json();
    const host = await connect();
    expect((await call(host, 'host:connect', { code: created.code, hostToken: created.hostToken })).ok).toBe(true);

    const withProfile = waitForView(host, (v) => v.lobby.players.some((p) => p.name === 'Sara'));
    const player = await connect();
    expect((await call(player, 'player:join', { code: created.code, name: 'Sara', profileToken: token })).ok).toBe(
      true,
    );
    expect((await withProfile).lobby.players.find((p) => p.name === 'Sara')?.avatar.character).toEqual(CUSTOM);

    const withGuest = waitForView(host, (v) => v.lobby.players.some((p) => p.name === 'Invité'));
    const guest = await connect();
    expect((await call(guest, 'player:join', { code: created.code, name: 'Invité' })).ok).toBe(true);
    const guestSeen = (await withGuest).lobby.players.find((p) => p.name === 'Invité');
    expect(guestSeen?.avatar.character).toEqual(defaultCharacterFor('Invité'));
  });
});
