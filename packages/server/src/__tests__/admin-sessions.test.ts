import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { AdminSessions } from '../auth.js';
import { Store } from '../db/store.js';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

const silent = createLogger('silent', true);
const PASSWORD = 'test-password-123';
const roots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ph-admin-sessions-'));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('Sessions d’administration en base', () => {
  const started: PartyServer[] = [];
  afterEach(async () => {
    for (const s of started.splice(0)) await s.close().catch(() => undefined);
  });

  it('une session créée est valide, puis révoquée', () => {
    const store = new Store(':memory:');
    const sessions = new AdminSessions(store.db);
    const token = sessions.create();
    expect(sessions.valid(token)).toBe(true);
    sessions.revoke(token);
    expect(sessions.valid(token)).toBe(false);
    store.close();
  });

  it('une session expire après sa durée de vie', () => {
    const store = new Store(':memory:');
    let now = 1_000_000;
    const sessions = new AdminSessions(store.db, () => now, 60_000);
    const token = sessions.create();
    now += 59_999;
    expect(sessions.valid(token)).toBe(true);
    now += 2;
    expect(sessions.valid(token)).toBe(false);
    store.close();
  });

  it('ne stocke que l’empreinte du jeton, jamais le jeton lui-même', () => {
    const store = new Store(':memory:');
    const sessions = new AdminSessions(store.db);
    const token = sessions.create();
    const rows = store.db.prepare('SELECT token_hash FROM admin_sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    store.close();
  });

  it('nettoie les sessions expirées à la création d’une nouvelle', () => {
    const store = new Store(':memory:');
    let now = 0;
    const sessions = new AdminSessions(store.db, () => now, 1_000);
    sessions.create();
    sessions.create();
    expect(sessions.count()).toBe(2);
    now = 5_000;
    sessions.create();
    expect(sessions.count()).toBe(1);
    store.close();
  });

  it('une session survit à la fermeture et à la réouverture de la base', () => {
    const file = path.join(tempDir(), 'partyhub.db');
    const first = new Store(file);
    const token = new AdminSessions(first.db).create();
    first.close();

    const second = new Store(file);
    expect(new AdminSessions(second.db).valid(token)).toBe(true);
    second.close();
  });

  it('reste valide après un redémarrage complet du serveur, puis se révoque à la déconnexion', async () => {
    const dataDir = tempDir();
    const config: AppConfig = {
      port: 0,
      host: '127.0.0.1',
      dataDir,
      dbFile: path.join(dataDir, 'partyhub.db'),
      staticDir: '/nonexistent',
      adminPassword: PASSWORD,
      logLevel: 'silent',
      secureCookies: false,
    };
    const boot = async () => {
      const server = await createServer({ config, logger: silent, sweepEveryMs: 0 });
      started.push(server);
      const port = await server.listen(0, '127.0.0.1');
      return { server, base: `http://127.0.0.1:${port}` };
    };

    const first = await boot();
    const login = await fetch(`${first.base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    await first.server.close();

    const second = await boot();
    const session = await fetch(`${second.base}/api/admin/session`, { headers: { cookie } });
    expect(await session.json()).toEqual({ authenticated: true });

    const logout = await fetch(`${second.base}/api/admin/logout`, { method: 'POST', headers: { cookie } });
    expect(logout.status).toBe(200);
    const after = await fetch(`${second.base}/api/admin/session`, { headers: { cookie } });
    expect(await after.json()).toEqual({ authenticated: false });
  });
});
