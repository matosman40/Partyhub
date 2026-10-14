import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, Store, migrate, type Migration } from '../db/store.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ph-schema-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function userVersion(file: string): number {
  const db = new Database(file, { readonly: true });
  try {
    return db.pragma('user_version', { simple: true }) as number;
  } finally {
    db.close();
  }
}

/** Base telle que créée par une version antérieure à 0.3.0 : sans user_version, sans colonne avatar_shared. */
function createLegacyDatabase(file: string): void {
  const old = new Database(file);
  old.exec(`
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_image TEXT,
      avatar_version INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO kv (key, value) VALUES ('admin_password_hash', 'hash-existant');
    INSERT INTO profiles (id, username, display_name, avatar_version) VALUES ('p1', 'ana', 'Ana', 0);
  `);
  old.close();
}

describe('Versions du schéma', () => {
  it('crée une base neuve directement à la dernière version, sans copie de sécurité', () => {
    const file = join(dir, 'new.db');
    const store = new Store(file, { backupDir: join(dir, 'migrations') });
    expect(store.migration).toMatchObject({ from: 0, to: LATEST_SCHEMA_VERSION, backup: undefined });
    store.close();
    expect(userVersion(file)).toBe(LATEST_SCHEMA_VERSION);
    expect(existsSync(join(dir, 'migrations'))).toBe(false);
  });

  it('met à jour une base ancienne, conserve ses données et crée une copie avant la migration', () => {
    const file = join(dir, 'legacy.db');
    createLegacyDatabase(file);
    const store = new Store(file, { backupDir: join(dir, 'migrations') });
    expect(store.migration.from).toBe(0);
    expect(store.migration.to).toBe(LATEST_SCHEMA_VERSION);
    expect(store.migration.backup).toBeDefined();
    expect(store.getKv('admin_password_hash')).toBe('hash-existant');
    const profile = store.db.prepare('SELECT display_name, avatar_shared FROM profiles WHERE id = ?').get('p1') as {
      display_name: string;
      avatar_shared: number;
    };
    expect(profile).toEqual({ display_name: 'Ana', avatar_shared: 0 });
    store.close();

    // La copie garde l'état d'avant migration : pas de colonne avatar_shared, version 0.
    const copy = new Database(store.migration.backup!, { readonly: true });
    const columns = (copy.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).not.toContain('avatar_shared');
    expect(copy.pragma('user_version', { simple: true })).toBe(0);
    copy.close();
  });

  it('ne crée aucune copie et ne change rien quand la base est déjà à jour', () => {
    const file = join(dir, 'uptodate.db');
    new Store(file, { backupDir: join(dir, 'migrations') }).close();
    const again = new Store(file, { backupDir: join(dir, 'migrations') });
    expect(again.migration.from).toBe(again.migration.to);
    expect(again.migration.backup).toBeUndefined();
    again.close();
    expect(existsSync(join(dir, 'migrations'))).toBe(false);
  });

  it('refuse une base plus récente que le programme, sans la modifier', () => {
    const file = join(dir, 'future.db');
    new Store(file).close();
    const raw = new Database(file);
    raw.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 5}`);
    raw.close();

    expect(() => new Store(file, { backupDir: join(dir, 'migrations') })).toThrow(/plus récente/);
    expect(userVersion(file)).toBe(LATEST_SCHEMA_VERSION + 5);
  });

  it('annule une migration qui échoue : aucune trace partielle, version inchangée', () => {
    const file = join(dir, 'failing.db');
    createLegacyDatabase(file);
    const broken: Migration[] = [
      ...MIGRATIONS,
      {
        version: LATEST_SCHEMA_VERSION + 1,
        description: 'migration volontairement en échec',
        up(db) {
          db.exec('CREATE TABLE essai (id INTEGER)');
          throw new Error('échec simulé');
        },
      },
    ];
    const db = new Database(file);
    expect(() => migrate(db, broken, { backupDir: join(dir, 'migrations') })).toThrow('échec simulé');
    // Les migrations précédentes ont été appliquées une à une ; la suivante a été annulée.
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE name = 'essai'").get();
    expect(table).toBeUndefined();
    db.close();
  });

  it('applique les migrations dans l’ordre des versions', () => {
    const file = join(dir, 'order.db');
    const db = new Database(file);
    const seen: number[] = [];
    const steps: Migration[] = [
      { version: 2, description: 'deux', up: () => seen.push(2) },
      { version: 1, description: 'un', up: () => seen.push(1) },
    ];
    const report = migrate(db, steps);
    expect(seen).toEqual([1, 2]);
    expect(report).toMatchObject({ from: 0, to: 2 });
    db.close();
  });
});
