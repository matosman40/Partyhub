import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Installation neuve avec BUILTIN_GAMES=off (le défaut) : les jeux intégrés sont désactivés,
 * mais le plateau de test doit rester ouvrable depuis le bouton de l'accueil.
 */
let server: PartyServer;
let base: string;

beforeAll(async () => {
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: '/tmp/partyhub-tests-fresh',
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'test-password-123',
    logLevel: 'silent',
    secureCookies: false,
    builtinGames: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

describe('Installation neuve, jeux intégrés désactivés', () => {
  it('le plateau de test s’ouvre quand même', async () => {
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'plateau-test', practice: false }),
    });
    expect(res.status).toBe(201);
  });

  it('les jeux intégrés restent désactivés, et le catalogue public est vide', async () => {
    const catalog = (await (await fetch(`${base}/api/catalog`)).json()) as { games: unknown[] };
    expect(catalog.games).toHaveLength(0);
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'reflexe', practice: false }),
    });
    expect(res.status).toBe(404);
  });
});
