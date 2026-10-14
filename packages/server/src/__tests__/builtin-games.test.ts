import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import { builtinGamesFromEnv, loadConfig, type AppConfig } from '../config.js';

let dir: string;
const servers: PartyServer[] = [];

function configFor(extra: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    dbFile: join(dir, 'partyhub.db'),
    staticDir: join(dir, 'static-absent'),
    adminPassword: 'builtin-password-123',
    logLevel: 'silent',
    secureCookies: false,
    ...extra,
  };
}

async function start(extra: Partial<AppConfig> = {}): Promise<PartyServer> {
  const server = await createServer({
    config: configFor(extra),
    logger: createLogger('silent', true),
    sweepEveryMs: 0,
  });
  servers.push(server);
  return server;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ph-builtin-'));
});

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('jeux intégrés sur une installation neuve', () => {
  it('désactive les jeux intégrés quand BUILTIN_GAMES=off', async () => {
    const server = await start({ builtinGames: false });
    expect(server.store.isGameEnabled('quiz-party')).toBe(false);
    expect(server.store.isGameEnabled('poker')).toBe(false);
    expect(server.store.isGameEnabled('tarot')).toBe(false);
  });

  it('garde les jeux intégrés actifs sans réglage explicite (usage en bibliothèque, tests)', async () => {
    const server = await start({});
    expect(server.store.isGameEnabled('quiz-party')).toBe(true);
  });

  it('laisse l’administrateur activer un jeu intégré', async () => {
    const server = await start({ builtinGames: false });
    server.store.setGameEnabled('poker', true);
    expect(server.store.isGameEnabled('poker')).toBe(true);
  });

  it('ne modifie pas une installation existante au redémarrage', async () => {
    const first = await start({ builtinGames: false });
    first.store.setGameEnabled('poker', true);
    await first.close();
    servers.splice(servers.indexOf(first), 1);

    // Deuxième démarrage : le mot de passe administrateur existe, donc l'installation n'est plus « neuve ».
    const second = await start({ builtinGames: false });
    expect(second.store.isGameEnabled('poker')).toBe(true);
    expect(second.store.isGameEnabled('quiz-party')).toBe(false);
  });

  it('ne désactive rien sur une installation existante créée avant ce réglage', async () => {
    // Installation précédente : mot de passe déjà créé, jeux actifs.
    const old = await start({});
    expect(old.store.getKv('admin_password_hash')).toBeDefined();
    await old.close();
    servers.splice(servers.indexOf(old), 1);

    const upgraded = await start({ builtinGames: false });
    expect(upgraded.store.isGameEnabled('quiz-party')).toBe(true);
  });
});

describe('réglage BUILTIN_GAMES', () => {
  it('vaut off par défaut, accepte on, refuse le reste', () => {
    expect(builtinGamesFromEnv(undefined)).toBe(false);
    expect(builtinGamesFromEnv('off')).toBe(false);
    expect(builtinGamesFromEnv('ON')).toBe(true);
    expect(() => builtinGamesFromEnv('peut-etre')).toThrow('BUILTIN_GAMES invalide');
  });

  it('est lu depuis l’environnement', () => {
    expect(loadConfig({ DATA_DIR: dir }).builtinGames).toBe(false);
    expect(loadConfig({ DATA_DIR: dir, BUILTIN_GAMES: 'on' }).builtinGames).toBe(true);
  });
});
