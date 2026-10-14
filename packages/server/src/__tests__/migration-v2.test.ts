import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MIGRATIONS, Store } from '../db/store.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ph-migration-v2-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 2 : table des paquets', () => {
  it('fait passer une base version 1 (0.4.x) en version 2 sans perdre de données', () => {
    const file = path.join(dir, 'partyhub.db');
    const backupDir = path.join(dir, 'migrations');

    // Base telle que créée par la version 0.4.x : seule la migration 1 existe.
    const old = new Store(file, { migrations: MIGRATIONS.slice(0, 1) });
    old.setKv('admin_password_hash', 'hash-existant');
    old.saveCardGame('custom-avant', '{"name":"Ancien jeu"}');
    old.close();

    const upgraded = new Store(file, { backupDir });
    expect(upgraded.migration).toMatchObject({ from: 1, to: 2 });
    expect(upgraded.migration.backup).toBeDefined();
    expect(existsSync(upgraded.migration.backup!)).toBe(true);

    expect(upgraded.getKv('admin_password_hash')).toBe('hash-existant');
    expect(upgraded.listCardGames().map((r) => r.id)).toEqual(['custom-avant']);
    expect(upgraded.listPackages()).toEqual([]);
    upgraded.close();
  });
});
