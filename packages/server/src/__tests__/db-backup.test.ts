import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupFileName, DbBackupScheduler, listDbBackups, pruneDbBackups } from '../db/backup.js';
import { Store } from '../db/store.js';
import { loadConfig, type AppConfig } from '../config.js';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';

const silent = createLogger('silent', true);
const roots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ph-backup-'));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('Nom des sauvegardes', () => {
  it('suit la date UTC, à la seconde, et reste trié chronologiquement', () => {
    expect(backupFileName(new Date('2026-10-13T17:05:09Z'))).toBe('partyhub-20261013-170509.db');
    const earlier = backupFileName(new Date('2026-09-30T23:59:59Z'));
    const later = backupFileName(new Date('2026-10-01T00:00:00Z'));
    expect(earlier < later).toBe(true);
  });
});

describe('Sauvegarde de la base', () => {
  let dir: string;
  let store: Store;
  let clock: number;
  const now = () => new Date(clock);

  beforeEach(() => {
    dir = path.join(tempDir(), 'backups');
    store = new Store(path.join(tempDir(), 'live.db'));
    store.setKv('marker', 'donnee-de-test');
    clock = Date.UTC(2026, 9, 1, 12, 0, 0);
  });

  afterEach(() => {
    store.close();
  });

  it('crée une copie lisible qui contient les données, avec des permissions restreintes', () => {
    const scheduler = new DbBackupScheduler(store, { dir, everyMs: 0, keep: 7 }, silent, now);
    const result = scheduler.runNow();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const copy = new Store(path.join(dir, result.name));
    expect(copy.getKv('marker')).toBe('donnee-de-test');
    copy.close();

    if (process.platform !== 'win32') {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(dir, result.name)).mode & 0o777).toBe(0o600);
    }
  });

  it('ne garde que les sauvegardes les plus récentes', () => {
    const scheduler = new DbBackupScheduler(store, { dir, everyMs: 0, keep: 3 }, silent, now);
    for (let day = 0; day < 6; day++) {
      clock += 24 * 60 * 60 * 1000;
      expect(scheduler.runNow().ok).toBe(true);
    }
    const kept = listDbBackups(dir).map((f) => f.name);
    expect(kept).toHaveLength(3);
    // Les trois plus récents : jours 4, 5 et 6.
    expect(kept[0]).toBe(backupFileName(new Date(clock)));
    expect(kept[2]).toBe(backupFileName(new Date(clock - 2 * 24 * 60 * 60 * 1000)));
  });

  it('ignore les fichiers qui ne sont pas des sauvegardes', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'notes.txt'), 'à conserver');
    writeFileSync(path.join(dir, 'partyhub-autre.db'), 'pas une sauvegarde');
    const removed = pruneDbBackups(dir, 1);
    expect(removed).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['notes.txt', 'partyhub-autre.db']);
  });

  it('ne lève pas d’erreur si la sauvegarde échoue, et le dit clairement', () => {
    const broken = { backupTo: () => { throw new Error('disque plein'); } } as unknown as Store;
    const scheduler = new DbBackupScheduler(broken, { dir, everyMs: 0, keep: 7 }, silent, now);
    const result = scheduler.runNow();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/échoué/);
  });

  it('au démarrage, sauvegarde seulement si la plus récente date de plus d’un intervalle', () => {
    const hour = 60 * 60 * 1000;
    mkdirSync(dir, { recursive: true });
    const recent = path.join(dir, backupFileName(new Date(clock - hour)));
    writeFileSync(recent, '');
    utimesSync(recent, new Date(clock - hour), new Date(clock - hour));

    const fresh = new DbBackupScheduler(store, { dir, everyMs: 24 * hour, keep: 7 }, silent, now);
    fresh.start();
    expect(listDbBackups(dir)).toHaveLength(1);
    fresh.stop();

    const old = new Date(clock - 3 * 24 * hour);
    utimesSync(recent, old, old);
    const stale = new DbBackupScheduler(store, { dir, everyMs: 24 * hour, keep: 7 }, silent, now);
    stale.start();
    expect(listDbBackups(dir)).toHaveLength(2);
    stale.stop();
  });

  it('ne fait rien quand la sauvegarde automatique est désactivée', () => {
    const scheduler = new DbBackupScheduler(store, { dir, everyMs: 0, keep: 7 }, silent, now);
    scheduler.start();
    expect(scheduler.enabled).toBe(false);
    expect(listDbBackups(dir)).toEqual([]);
  });
});

describe('Configuration des sauvegardes', () => {
  it('utilise 24 h, 7 sauvegardes et un dossier dans DATA_DIR par défaut', () => {
    const config = loadConfig({ DATA_DIR: '/données/partyhub' });
    expect(config.backup).toEqual({
      dir: path.join('/données/partyhub', 'backups'),
      everyMs: 24 * 60 * 60 * 1000,
      keep: 7,
    });
  });

  it('accepte 0 pour désactiver, et refuse les valeurs invalides', () => {
    expect(loadConfig({ DB_BACKUP_EVERY_HOURS: '0' }).backup?.everyMs).toBe(0);
    expect(() => loadConfig({ DB_BACKUP_EVERY_HOURS: 'souvent' })).toThrow(/DB_BACKUP_EVERY_HOURS/);
    expect(() => loadConfig({ DB_BACKUP_KEEP: '0' })).toThrow(/DB_BACKUP_KEEP/);
    expect(() => loadConfig({ DB_BACKUP_KEEP: '1.5' })).toThrow(/DB_BACKUP_KEEP/);
  });
});

describe('Sauvegardes dans le serveur', () => {
  const PASSWORD = 'backup-password-123';
  let server: PartyServer;
  let base: string;
  let cookie: string;
  let backupDir: string;

  async function start(everyMs: number): Promise<void> {
    backupDir = path.join(tempDir(), 'backups');
    const config: AppConfig = {
      port: 0,
      host: '127.0.0.1',
      dataDir: tempDir(),
      dbFile: ':memory:',
      staticDir: '/nonexistent',
      adminPassword: PASSWORD,
      logLevel: 'silent',
      secureCookies: false,
      backup: { dir: backupDir, everyMs, keep: 7 },
    };
    server = await createServer({ config, logger: silent, sweepEveryMs: 0 });
    const port = await server.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }

  afterEach(async () => {
    await server?.close();
  });

  it('crée une sauvegarde au démarrage quand aucune n’existe', async () => {
    await start(24 * 60 * 60 * 1000);
    expect(listDbBackups(backupDir)).toHaveLength(1);
  });

  it('une sauvegarde se restaure : la copie, placée comme base d’un nouveau serveur, retrouve tout', async () => {
    const dataDir = tempDir();
    const liveDb = path.join(dataDir, 'partyhub.db');
    const seed = new Store(liveDb);
    seed.setKv('marker', 'avant-sauvegarde');
    seed.close();

    const config: AppConfig = {
      port: 0,
      host: '127.0.0.1',
      dataDir,
      dbFile: liveDb,
      staticDir: '/nonexistent',
      adminPassword: PASSWORD,
      logLevel: 'silent',
      secureCookies: false,
      backup: { dir: path.join(dataDir, 'backups'), everyMs: 0, keep: 7 },
    };
    const first = await createServer({ config, logger: silent, sweepEveryMs: 0 });
    const port = await first.listen(0, '127.0.0.1');
    const login = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const sessionCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const created = await fetch(`http://127.0.0.1:${port}/api/admin/db-backups`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    const { name } = (await created.json()) as { name: string };
    await first.close();

    // Restauration : on remplace la base par la copie, sans fichiers WAL.
    const restoredDir = tempDir();
    const restoredDb = path.join(restoredDir, 'partyhub.db');
    copyFileSync(path.join(dataDir, 'backups', name), restoredDb);
    const second = await createServer({
      config: { ...config, dataDir: restoredDir, dbFile: restoredDb, backup: undefined },
      logger: silent,
      sweepEveryMs: 0,
    });
    const port2 = await second.listen(0, '127.0.0.1');
    const relogin = await fetch(`http://127.0.0.1:${port2}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(relogin.status).toBe(200);
    await second.close();

    const restored = new Store(restoredDb);
    expect(restored.getKv('marker')).toBe('avant-sauvegarde');
    restored.close();
  });

  it('liste et crée des sauvegardes depuis l’administration, réservées à l’administrateur', async () => {
    await start(0);

    const anonymous = await fetch(`${base}/api/admin/db-backups`);
    expect(anonymous.status).toBe(401);

    const before = await (await fetch(`${base}/api/admin/db-backups`, { headers: { cookie } })).json();
    expect(before).toEqual({ enabled: false, everyHours: 0, keep: 7, backups: [] });

    const created = await fetch(`${base}/api/admin/db-backups`, { method: 'POST', headers: { cookie } });
    expect(created.status).toBe(201);
    const { name } = (await created.json()) as { name: string };
    expect(name).toMatch(/^partyhub-\d{8}-\d{6}\.db$/);

    const after = await (await fetch(`${base}/api/admin/db-backups`, { headers: { cookie } })).json();
    expect(after.backups.map((b: { name: string }) => b.name)).toEqual([name]);
    expect(after.backups[0].size).toBeGreaterThan(0);
  });
});
