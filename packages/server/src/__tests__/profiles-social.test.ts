import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Profils (compte, connexion, session, mot de passe) et interactions entre
 * joueurs (messages et réactions relayés à toute la salle, avec limite de débit).
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

function json(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('Profils : compte et session', () => {
  it('crée un compte, se reconnecte et retrouve son profil', async () => {
    const username = `ana_${uniq()}`.slice(0, 20);
    const reg = await json('/api/profiles/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'motdepasse1', displayName: 'Ana' }),
    });
    expect(reg.status).toBe(201);
    const { token, profile } = await reg.json();
    expect(token).toBeTruthy();
    expect(profile.displayName).toBe('Ana');

    const me = await json('/api/profiles/me', { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect((await me.json()).profile.username).toBe(username);

    const login = await json('/api/profiles/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'motdepasse1' }),
    });
    expect(login.status).toBe(200);
    expect((await login.json()).token).toBeTruthy();
  });

  it('refuse un mauvais mot de passe sans révéler lequel est faux', async () => {
    const username = `ben_${uniq()}`.slice(0, 20);
    await json('/api/profiles/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'motdepasse1', displayName: 'Ben' }),
    });
    const bad = await json('/api/profiles/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'mauvais-mot' }),
    });
    expect(bad.status).toBe(401);
    const unknown = await json('/api/profiles/login', {
      method: 'POST',
      body: JSON.stringify({ username: `inconnu_${uniq()}`.slice(0, 20), password: 'mauvais-mot' }),
    });
    expect(unknown.status).toBe(401);
    expect((await bad.json()).error).toBe((await unknown.json()).error);
  });

  it('refuse un identifiant déjà pris', async () => {
    const username = `cleo_${uniq()}`.slice(0, 20);
    const body = JSON.stringify({ username, password: 'motdepasse1', displayName: 'Cléo' });
    expect((await json('/api/profiles/register', { method: 'POST', body })).status).toBe(201);
    expect((await json('/api/profiles/register', { method: 'POST', body })).status).toBe(409);
  });

  it('change le mot de passe et invalide les anciennes sessions', async () => {
    const username = `dan_${uniq()}`.slice(0, 20);
    const reg = await json('/api/profiles/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'motdepasse1', displayName: 'Dan' }),
    });
    const { token } = await reg.json();
    const auth = { authorization: `Bearer ${token}` };

    const change = await json('/api/profiles/me/password', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ current: 'motdepasse1', next: 'nouveaumdp2' }),
    });
    expect(change.status).toBe(200);
    const renewed = (await change.json()).token as string;
    expect(renewed).toBeTruthy();

    const old = await json('/api/profiles/me', { headers: auth });
    expect(old.status).toBe(401);
    const fresh = await json('/api/profiles/me', { headers: { authorization: `Bearer ${renewed}` } });
    expect(fresh.status).toBe(200);
  });

  it('accepte une image d’avatar valide et la sert avec un cache', async () => {
    const username = `eve_${uniq()}`.slice(0, 20);
    const { token, profile } = await (
      await json('/api/profiles/register', {
        method: 'POST',
        body: JSON.stringify({ username, password: 'motdepasse1', displayName: 'Eve' }),
      })
    ).json();
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const put = await json('/api/profiles/me', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ avatarImage: pixel }),
    });
    expect(put.status).toBe(200);
    const updated = (await put.json()).profile;
    expect(updated.avatar.imageUrl).toMatch(/^\/api\/avatars\/.+\?v=/);

    const img = await fetch(`${base}${updated.avatar.imageUrl}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toContain('image/png');
    expect(img.headers.get('cache-control')).toContain('max-age');
    void profile;
  });

  it('rejette une image qui n’est pas une image autorisée', async () => {
    const username = `fay_${uniq()}`.slice(0, 20);
    const { token } = await (
      await json('/api/profiles/register', {
        method: 'POST',
        body: JSON.stringify({ username, password: 'motdepasse1', displayName: 'Fay' }),
      })
    ).json();
    const put = await json('/api/profiles/me', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ avatarImage: 'data:text/html;base64,PGgxPnBpcmF0ZTwvaDE+' }),
    });
    expect(put.status).toBe(400);
  });
});

describe('Interactions entre joueurs', () => {
  async function roomWithPlayer() {
    const created = await json('/api/rooms', { method: 'POST', body: JSON.stringify({ gameId: 'quiz-party' }) }).then(
      (r) => r.json(),
    );
    const host = await connect();
    expect((await call(host, 'host:connect', { code: created.code, hostToken: created.hostToken })).ok).toBe(true);
    const player = await connect();
    const joined = await call(player, 'player:join', { code: created.code, name: 'Gus' });
    expect(joined.ok).toBe(true);
    return { host, player };
  }

  it('relaie un message de joueur à toute la salle, hôte compris', async () => {
    const { host, player } = await roomWithPlayer();
    const onHost = new Promise<any>((resolve) => host.once('room:chat', resolve));
    const onPlayer = new Promise<any>((resolve) => player.once('room:chat', resolve));
    const ack = await call(player, 'player:chat', { text: 'Bonjour à tous !' });
    expect(ack.ok).toBe(true);
    const [h, p] = await Promise.all([onHost, onPlayer]);
    expect(h.text).toBe('Bonjour à tous !');
    expect(h.from).toBe('Gus');
    expect(p.text).toBe('Bonjour à tous !');
  });

  it('limite le débit des messages', async () => {
    const { player } = await roomWithPlayer();
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      results.push((await call(player, 'player:chat', { text: `message ${i}` })).ok);
    }
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(6);
    expect(results.at(-1)).toBe(false);
  });

  it('relaie une réaction emoji et refuse un emoji hors liste', async () => {
    const { host, player } = await roomWithPlayer();
    const onHost = new Promise<any>((resolve) => host.once('room:reaction', resolve));
    const ack = await call(player, 'player:reaction', { emoji: '🎉' });
    expect(ack.ok).toBe(true);
    const reaction = await onHost;
    expect(reaction.emoji).toBe('🎉');
    expect(reaction.from).toBe('Gus');

    const bad = await call(player, 'player:reaction', { emoji: '🍕' });
    expect(bad.ok).toBe(false);
  });
});
