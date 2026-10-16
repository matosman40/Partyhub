import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Profil « nom seul » : créé avec le seul pseudo, sans mot de passe, gardé par son jeton sur l'appareil.
 * Les anciens comptes (identifiant et mot de passe) restent connectables.
 */

let server: PartyServer;
let base: string;

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
  await server.close();
});

function json(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('Profil nom seul', () => {
  it('se crée avec le seul pseudo, sans identifiant ni mot de passe', async () => {
    const res = await json('/api/profiles/register', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Léa' }),
    });
    expect(res.status).toBe(201);
    const { token, profile } = await res.json();
    expect(token).toBeTruthy();
    expect(profile.displayName).toBe('Léa');
    expect(profile.hasPassword).toBe(false);
    expect(profile.username).toMatch(/^p[a-f0-9]{12}$/);
    expect(profile.avatar.character).toBeTruthy();
  });

  it('retrouve le profil avec son seul jeton, sans passer par un mot de passe', async () => {
    const { token } = await (
      await json('/api/profiles/register', { method: 'POST', body: JSON.stringify({ displayName: 'Mona' }) })
    ).json();
    const me = await json('/api/profiles/me', { headers: bearer(token) });
    expect(me.status).toBe(200);
    expect((await me.json()).profile.displayName).toBe('Mona');
  });

  it('ne se connecte pas par identifiant : il n’a pas de mot de passe', async () => {
    const { profile } = await (
      await json('/api/profiles/register', { method: 'POST', body: JSON.stringify({ displayName: 'Nina' }) })
    ).json();
    const res = await json('/api/profiles/login', {
      method: 'POST',
      body: JSON.stringify({ username: profile.username, password: 'nimporte-quoi' }),
    });
    expect(res.status).toBe(401);
  });

  it('refuse de changer un mot de passe qu’il n’a pas', async () => {
    const { token } = await (
      await json('/api/profiles/register', { method: 'POST', body: JSON.stringify({ displayName: 'Omar' }) })
    ).json();
    const res = await json('/api/profiles/me/password', {
      method: 'PUT',
      headers: bearer(token),
      body: JSON.stringify({ current: 'motdepasse1', next: 'nouveau-motdepasse' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepte encore la création avec identifiant et mot de passe (anciens comptes)', async () => {
    const username = `old_${randomUUID().slice(0, 6)}`;
    const res = await json('/api/profiles/register', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'motdepasse1', displayName: 'Ancienne' }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).profile.hasPassword).toBe(true);
    const login = await json('/api/profiles/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'motdepasse1' }),
    });
    expect(login.status).toBe(200);
  });

  it('refuse un identifiant sans mot de passe, ou l’inverse', async () => {
    const onlyUser = await json('/api/profiles/register', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Paul', username: 'paul_seul' }),
    });
    expect(onlyUser.status).toBe(400);
    const onlyPassword = await json('/api/profiles/register', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Paul', password: 'motdepasse1' }),
    });
    expect(onlyPassword.status).toBe(400);
  });

  it('refuse un pseudo vide', async () => {
    const res = await json('/api/profiles/register', {
      method: 'POST',
      body: JSON.stringify({ displayName: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});
