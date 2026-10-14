import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, GameModule, HostRoomView, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { MIGRATIONS, Store, migrate } from '../db/store.js';
import { originOf } from '../catalog.js';
import { settingsOverride, withOverrides } from '../game-details.js';
import { resolveGame, setCustomGames } from '../games-registry.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let dir: string;
let server: PartyServer;
let base: string;
let cookie: string;
const clients: Client[] = [];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-reglages-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'reglages-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'reglages-password-123' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = ioClient(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function adminCall(method: string, route: string, body?: unknown) {
  return fetch(`${base}/api/admin/games/${route}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface CatalogTestEntry {
  id: string;
  settings: Record<string, unknown>;
  customSettings: boolean;
  settingsStale: boolean;
  durationMin: number;
  defaultDetails: { durationMin: number };
  settingsBounds: Record<string, { min: number; max: number }>;
}

async function catalogEntry(id: string): Promise<CatalogTestEntry | undefined> {
  const res = await fetch(`${base}/api/catalog`);
  const { games } = (await res.json()) as { games: CatalogTestEntry[] };
  return games.find((g) => g.id === id);
}

describe('Réglages par défaut administrables', () => {
  it('refuse une valeur hors limites et ne change rien', async () => {
    const res = await adminCall('PUT', 'reflexe/settings', { settings: { rounds: 99 } });
    expect(res.status).toBe(400);
    const entry = await catalogEntry('reflexe');
    expect(entry?.settings).toEqual({ rounds: 5 });
    expect(entry?.customSettings).toBe(false);
  });

  it('exige une connexion administrateur', async () => {
    const res = await fetch(`${base}/api/admin/games/reflexe/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { rounds: 3 } }),
    });
    expect([401, 403]).toContain(res.status);
  });

  it('refuse un jeu inconnu', async () => {
    const res = await adminCall('PUT', 'inconnu/settings', { settings: { rounds: 3 } });
    expect(res.status).toBe(404);
  });

  it('les nouvelles salles partent des réglages choisis par l’administrateur', async () => {
    const res = await adminCall('PUT', 'reflexe/settings', { settings: { rounds: 3 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { settings: unknown }).settings).toEqual({ rounds: 3 });
    const entry = await catalogEntry('reflexe');
    expect(entry?.customSettings).toBe(true);

    const room = (await (
      await fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId: 'reflexe', practice: false }),
      })
    ).json()) as { code: string; hostToken: string };
    const host = await connect();
    const views: HostRoomView[] = [];
    host.on('room:host', (v) => views.push(v));
    const joined = await new Promise<{ ok: boolean }>((resolve) =>
      host.emit('host:connect', { code: room.code, hostToken: room.hostToken }, resolve),
    );
    expect(joined.ok).toBe(true);
    const start = Date.now();
    while (views.length === 0 && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 20));
    const view = views[views.length - 1]!;
    expect(view.lobby.gameSettings).toEqual({ rounds: 3 });
    host.disconnect();
  });

  it('revenir aux réglages d’origine efface la surcharge', async () => {
    const res = await adminCall('DELETE', 'reflexe/settings');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { settings: unknown }).settings).toEqual({ rounds: 5 });
    const entry = await catalogEntry('reflexe');
    expect(entry?.settings).toEqual({ rounds: 5 });
    expect(entry?.customSettings).toBe(false);
  });
});

describe('Durée estimée, bornes et réglages devenus invalides', () => {
  it('la durée estimée se change depuis la présentation, puis revient à celle du code', async () => {
    const before = await catalogEntry('reflexe');
    const res = await fetch(`${base}/api/admin/game-details/reflexe`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Réflexe', icon: '⚡', description: 'Test de durée.', durationMin: 12 }),
    });
    expect(res.status).toBe(200);
    expect((await catalogEntry('reflexe'))?.durationMin).toBe(12);
    const back = await fetch(`${base}/api/admin/game-details/reflexe`, { method: 'DELETE', headers: { cookie } });
    expect(back.status).toBe(200);
    expect((await catalogEntry('reflexe'))?.durationMin).toBe(before?.defaultDetails?.durationMin);
  });

  it('le catalogue donne les bornes exactes des réglages', async () => {
    const res = await fetch(`${base}/api/catalog`);
    const { games } = (await res.json()) as { games: { id: string; settingsBounds: unknown }[] };
    expect(games.find((g) => g.id === 'reflexe')?.settingsBounds).toEqual({ rounds: { min: 1, max: 15 } });
  });

  it('un refus explique le réglage concerné et la limite, en français', async () => {
    const res = await adminCall('PUT', 'reflexe/settings', { settings: { rounds: 99 } });
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Réglage « rounds » : au plus 15 attendu.');
  });

  it('des réglages enregistrés qui ne respectent plus le schéma sont signalés, puis ignorés', async () => {
    server.store.setSettingsOverride('reflexe', JSON.stringify({ rounds: 99 }));
    const entry = await catalogEntry('reflexe');
    expect(entry?.settingsStale).toBe(true);
    expect(entry?.customSettings).toBe(true);
    expect(entry?.settings).toEqual({ rounds: 5 });
    const restored = await adminCall('DELETE', 'reflexe/settings');
    expect(restored.status).toBe(200);
    expect((await catalogEntry('reflexe'))?.settingsStale).toBe(false);
  });
});

describe('Jeux importés', () => {
  const schema = z.object({ rounds: z.number().int().min(1).max(5).default(2) });
  const pkg = {
    manifest: {
      id: 'pkg-reglages',
      name: 'Paquet',
      description: '',
      icon: '📦',
      version: '1.0.0',
      category: 'cartes',
      minPlayers: 2,
      maxPlayers: 6,
      durationMin: 5,
      notice: { goal: '', steps: [], tips: [] },
      apiVersion: 1,
    },
    settingsSchema: schema,
    defaultSettings: { rounds: 2 },
  } as unknown as GameModule;

  beforeAll(() => setCustomGames('packages', [pkg]));
  afterAll(() => setCustomGames('packages', []));

  it('un paquet importé se règle comme un jeu intégré, avec le même contrôle de valeurs', async () => {
    const refused = await adminCall('PUT', 'pkg-reglages/settings', { settings: { rounds: 9 } });
    expect(refused.status).toBe(400);
    const saved = await adminCall('PUT', 'pkg-reglages/settings', { settings: { rounds: 4 } });
    expect(saved.status).toBe(200);
    const entry = await catalogEntry('pkg-reglages');
    expect(entry?.settings).toEqual({ rounds: 4 });
    expect(entry?.customSettings).toBe(true);
    const back = await adminCall('DELETE', 'pkg-reglages/settings');
    expect(back.status).toBe(200);
    expect((await catalogEntry('pkg-reglages'))?.settings).toEqual({ rounds: 2 });
  });
});

describe('Surcharges, nettoyage et origine des jeux', () => {
  it('une base déjà en version 6 reçoit la table des réglages à la mise à jour', () => {
    const upgradeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-upgrade-'));
    const file = path.join(upgradeDir, 'partyhub.db');
    try {
      const old = new Database(file);
      migrate(
        old,
        MIGRATIONS.filter((m) => m.version <= 6),
      );
      old.close();
      const store = new Store(file, { backupDir: path.join(upgradeDir, 'migrations') });
      try {
        store.setSettingsOverride('reflexe', JSON.stringify({ rounds: 4 }));
        expect(store.getSettingsOverride('reflexe')).toBe(JSON.stringify({ rounds: 4 }));
      } finally {
        store.close();
      }
    } finally {
      fs.rmSync(upgradeDir, { recursive: true, force: true });
    }
  });

  it('une surcharge qui ne respecte plus le schéma est ignorée', () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-surcharge-'));
    const store = new Store(path.join(dbDir, 'partyhub.db'));
    try {
      const game = resolveGame('reflexe');
      expect(game).toBeDefined();
      store.setSettingsOverride('reflexe', JSON.stringify({ rounds: 99 }));
      expect(settingsOverride(store, game!)).toBeUndefined();
      expect(withOverrides(game!, store).defaultSettings).toEqual({ rounds: 5 });
    } finally {
      store.close();
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  });

  it('supprimer un jeu efface sa notice, sa présentation et ses réglages', () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-suppr-'));
    const store = new Store(path.join(dbDir, 'partyhub.db'));
    try {
      const id = 'custom-abcd1234';
      store.saveCardGame(id, '{}');
      store.setNoticeOverride(id, '{}');
      store.setDetailsOverride(id, JSON.stringify({ name: 'Test', icon: '🎲', description: 'Test' }));
      store.setSettingsOverride(id, '{}');
      store.deleteCardGame(id);
      expect(store.getNoticeOverride(id)).toBeUndefined();
      expect(store.getDetailsOverride(id)).toBeUndefined();
      expect(store.getSettingsOverride(id)).toBeUndefined();
    } finally {
      store.close();
      fs.rmSync(dbDir, { recursive: true, force: true });
    }
  });

  it('l’origine d’un jeu vient de la table qui le porte, pas de son nom', () => {
    const fake = (id: string) => ({ manifest: { id } }) as unknown as GameModule;
    setCustomGames('boards', [fake('board-essai')]);
    setCustomGames('packages', [fake('pkg-essai'), fake('pkgb-essai')]);
    try {
      expect(originOf('reflexe')).toBe('builtin');
      expect(originOf('board-essai')).toBe('board');
      expect(originOf('pkg-essai')).toBe('package');
      expect(originOf('pkgb-essai')).toBe('package');
    } finally {
      setCustomGames('boards', []);
      setCustomGames('packages', []);
    }
  });
});
