import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, HostRoomView, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { Store } from '../db/store.js';

/**
 * Photo de profil : elle n'est montrée aux autres joueurs qu'avec un consentement explicite,
 * et ce consentement retiré se voit tout de suite dans la salle en cours.
 */

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

/** Attend la prochaine vue de l'hôte qui satisfait `match` (à appeler avant l'action qui la déclenche). */
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

async function registerWithPhoto(displayName: string) {
  const username = `${displayName.toLowerCase()}_${uniq()}`.slice(0, 20);
  const reg = await json('/api/profiles/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'motdepasse1', displayName }),
  });
  const { token } = await reg.json();
  const auth = { authorization: `Bearer ${token}` };
  const put = await json('/api/profiles/me', {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ avatarImage: PIXEL }),
  });
  expect(put.status).toBe(200);
  return { token, auth };
}

describe('Photo de profil et consentement', () => {
  it('ne montre la photo aux autres joueurs qu’après consentement, et la retire aussitôt sur retrait', async () => {
    const { token, auth } = await registerWithPhoto('Iris');

    const created = await (
      await json('/api/rooms', { method: 'POST', body: JSON.stringify({ gameId: 'quiz-party' }) })
    ).json();
    const host = await connect();
    expect((await call(host, 'host:connect', { code: created.code, hostToken: created.hostToken })).ok).toBe(true);

    // 1. Par défaut : la photo existe, mais elle n'est pas transmise à la salle.
    const joinedView = waitForView(host, (v) => v.lobby.players.some((p) => p.name === 'Iris'));
    const player = await connect();
    const joined = await call(player, 'player:join', { code: created.code, name: 'Iris', profileToken: token });
    expect(joined.ok).toBe(true);
    const seen = (await joinedView).lobby.players.find((p) => p.name === 'Iris');
    expect(seen?.avatar.imageUrl).toBeNull();

    // Le joueur, lui, voit toujours sa propre photo dans son profil.
    const me = await (await json('/api/profiles/me', { headers: auth })).json();
    expect(me.profile.avatar.imageUrl).toMatch(/^\/api\/avatars\//);
    expect(me.profile.avatarShared).toBe(false);

    // 2. Consentement donné : la salle reçoit la photo immédiatement.
    const shared = waitForView(host, (v) => !!v.lobby.players.find((p) => p.name === 'Iris')?.avatar.imageUrl);
    const on = await json('/api/profiles/me', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ avatarShared: true }),
    });
    expect(on.status).toBe(200);
    const withPhoto = (await shared).lobby.players.find((p) => p.name === 'Iris');
    expect(withPhoto?.avatar.imageUrl).toMatch(/^\/api\/avatars\/.+\?v=/);

    // 3. Consentement retiré en pleine partie : la photo disparaît de la salle sans attendre une nouvelle entrée.
    const hidden = waitForView(host, (v) => !v.lobby.players.find((p) => p.name === 'Iris')?.avatar.imageUrl);
    const off = await json('/api/profiles/me', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ avatarShared: false }),
    });
    expect(off.status).toBe(200);
    expect((await hidden).lobby.players.find((p) => p.name === 'Iris')?.avatar.imageUrl).toBeNull();

    player.disconnect();
  });
});

describe('Migration de la base : colonne avatar_shared', () => {
  it('ajoute la colonne à une base créée avant cette version, sans perdre les profils', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ph-migr-'));
    const file = join(dir, 'old.db');
    try {
      const old = new Database(file);
      old.exec(`
        CREATE TABLE profiles (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          avatar_image TEXT,
          avatar_version INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO profiles (id, username, display_name, avatar_image, avatar_version)
          VALUES ('p1', 'ana', 'Ana', 'data:image/png;base64,AAAA', 1);
      `);
      old.close();

      const store = new Store(file);
      const columns = (store.db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]).map((c) => c.name);
      expect(columns).toContain('avatar_shared');
      const row = store.db.prepare('SELECT display_name, avatar_shared FROM profiles WHERE id = ?').get('p1') as {
        display_name: string;
        avatar_shared: number;
      };
      expect(row.display_name).toBe('Ana');
      expect(row.avatar_shared).toBe(0);
      store.db.close();

      // Une seconde ouverture ne doit pas échouer (la colonne existe déjà).
      new Store(file).db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
