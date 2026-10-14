import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';

/** Fichier de la médiathèque (les octets sont sur le disque, pas en base). */
export interface AssetRow {
  id: string;
  kind: string;
  mime: string;
  name: string;
  size: number;
  created_at: string;
}

export const adminSettingsSchema = z.object({
  maxPlayers: z.number().int().min(2).max(20),
  graceSeconds: z.number().int().min(10).max(600),
  inactivityMinutes: z.number().int().min(5).max(1440),
  maxRoomAgeMinutes: z.number().int().min(15).max(1440),
});

export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  maxPlayers: 8,
  graceSeconds: 90,
  inactivityMinutes: 30,
  maxRoomAgeMinutes: 240,
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_flags (
    game_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS stats (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS profiles (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_hue    INTEGER NOT NULL,
    avatar_emoji  TEXT NOT NULL,
    avatar_image  TEXT,
    avatar_version INTEGER NOT NULL DEFAULT 0,
    avatar_shared INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profile_sessions (
    token_hash TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profile_stats (
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    game_id    TEXT NOT NULL,
    played     INTEGER NOT NULL DEFAULT 0,
    wins       INTEGER NOT NULL DEFAULT 0,
    points     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, game_id)
  );
  CREATE TABLE IF NOT EXISTS notices (
    game_id    TEXT PRIMARY KEY,
    content    TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_details (
    game_id    TEXT PRIMARY KEY,
    content    TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS card_games (
    id         TEXT PRIMARY KEY,
    definition TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS media_games (
    id         TEXT PRIMARY KEY,
    definition TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    name       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`;

/** Persistance SQLite : réglages, jeux activés et statistiques. */

/**
 * Une migration fait passer la base de `version - 1` à `version`. Règles :
 * - ne jamais modifier une migration déjà publiée ; en ajouter une nouvelle à la fin ;
 * - chaque migration s'exécute dans sa propre transaction : en cas d'erreur, rien n'est appliqué.
 */
export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

/** Schéma initial (version 1). Les bases créées avant 0.3.0 ont la version 0 et passent par ici. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Schéma initial et colonne avatar_shared',
    up(db) {
      db.exec(SCHEMA);
      const columns = (db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]).map((c) => c.name);
      if (!columns.includes('avatar_shared')) {
        db.exec('ALTER TABLE profiles ADD COLUMN avatar_shared INTEGER NOT NULL DEFAULT 0');
      }
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export interface MigrationOptions {
  /** Dossier où copier la base avant d'appliquer une migration sur une base existante. */
  backupDir?: string;
}

export interface MigrationReport {
  from: number;
  to: number;
  /** Copie de sécurité créée avant la migration, s'il y en a une. */
  backup?: string;
}

function userVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function hasTables(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { n: number };
  return row.n > 0;
}

/**
 * Applique les migrations en attente, dans l'ordre. Refuse une base plus récente que ce programme,
 * car un retour arrière pourrait la corrompre sans le savoir.
 */
export function migrate(
  db: Database.Database,
  migrations: Migration[] = MIGRATIONS,
  options: MigrationOptions = {},
): MigrationReport {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const latest = ordered[ordered.length - 1]?.version ?? 0;
  const from = userVersion(db);

  if (from > latest) {
    throw new Error(
      `La base est en version ${from}, plus récente que cette version de PartyHub (schéma ${latest}). ` +
        'Démarrage refusé pour ne pas l’abîmer : installez la version correspondante ou restaurez une sauvegarde.',
    );
  }

  const pending = ordered.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from };

  let backup: string | undefined;
  if (options.backupDir && hasTables(db)) {
    mkdirSync(options.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = path.join(options.backupDir, `avant-schema-${pending[0]!.version}-${stamp}.db`);
    db.prepare('VACUUM INTO ?').run(backup);
  }

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }

  return { from, to: pending[pending.length - 1]!.version, backup };
}

export class Store {
  readonly db: Database.Database;

  /** Résultat de la mise à jour du schéma à l'ouverture. */
  readonly migration: MigrationReport;

  constructor(file: string, options: MigrationOptions & { migrations?: Migration[] } = {}) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migration = migrate(this.db, options.migrations ?? MIGRATIONS, options);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Copie cohérente de la base dans un nouveau fichier (VACUUM INTO). La copie se fait
   * pendant que le serveur continue d'écrire : aucune transaction n'est perdue ni tronquée.
   */
  backupTo(file: string): void {
    this.db.prepare('VACUUM INTO ?').run(file);
  }

  getKv(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  getSettings(): AdminSettings {
    const raw = this.getKv('admin_settings');
    if (!raw) return { ...DEFAULT_ADMIN_SETTINGS };
    try {
      const parsed = adminSettingsSchema.safeParse({
        ...DEFAULT_ADMIN_SETTINGS,
        ...JSON.parse(raw),
      });
      return parsed.success ? parsed.data : { ...DEFAULT_ADMIN_SETTINGS };
    } catch {
      return { ...DEFAULT_ADMIN_SETTINGS };
    }
  }

  saveSettings(settings: AdminSettings): void {
    this.setKv('admin_settings', JSON.stringify(settings));
  }

  /** Un jeu est activé par défaut tant qu'aucun réglage ne le désactive. */
  isGameEnabled(gameId: string): boolean {
    const row = this.db.prepare('SELECT enabled FROM game_flags WHERE game_id = ?').get(gameId) as
      | { enabled: number }
      | undefined;
    return row ? row.enabled === 1 : true;
  }

  setGameEnabled(gameId: string, enabled: boolean): void {
    this.db
      .prepare(
        'INSERT INTO game_flags (game_id, enabled) VALUES (?, ?) ON CONFLICT(game_id) DO UPDATE SET enabled = excluded.enabled',
      )
      .run(gameId, enabled ? 1 : 0);
  }

  incrementStat(key: string, by = 1): void {
    this.db
      .prepare(
        'INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value',
      )
      .run(key, by);
  }

  /** Notice personnalisée d'un jeu, ou undefined si l'on garde celle du code. */
  getNoticeOverride(gameId: string): string | undefined {
    const row = this.db.prepare('SELECT content FROM notices WHERE game_id = ?').get(gameId) as
      | { content: string }
      | undefined;
    return row?.content;
  }

  setNoticeOverride(gameId: string, content: string): void {
    this.db
      .prepare(
        'INSERT INTO notices (game_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
      )
      .run(gameId, content, new Date().toISOString());
  }

  clearNoticeOverride(gameId: string): void {
    this.db.prepare('DELETE FROM notices WHERE game_id = ?').run(gameId);
  }

  /** Nom, icône et description modifiés par l'administrateur (JSON), ou undefined. */
  getDetailsOverride(gameId: string): string | undefined {
    const row = this.db.prepare('SELECT content FROM game_details WHERE game_id = ?').get(gameId) as
      | { content: string }
      | undefined;
    return row?.content;
  }

  setDetailsOverride(gameId: string, content: string): void {
    this.db
      .prepare(
        'INSERT INTO game_details (game_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(game_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at',
      )
      .run(gameId, content, new Date().toISOString());
  }

  clearDetailsOverride(gameId: string): void {
    this.db.prepare('DELETE FROM game_details WHERE game_id = ?').run(gameId);
  }

  /** Jeux de cartes créés dans l'administration (définition au format JSON). */
  listCardGames(): { id: string; definition: string; updatedAt: string }[] {
    const rows = this.db
      .prepare('SELECT id, definition, updated_at FROM card_games ORDER BY updated_at')
      .all() as { id: string; definition: string; updated_at: string }[];
    return rows.map((r) => ({ id: r.id, definition: r.definition, updatedAt: r.updated_at }));
  }

  saveCardGame(id: string, definition: string): void {
    this.db
      .prepare(
        'INSERT INTO card_games (id, definition, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at',
      )
      .run(id, definition, new Date().toISOString());
  }

  deleteCardGame(id: string): void {
    this.db.prepare('DELETE FROM card_games WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM game_flags WHERE game_id = ?').run(id);
    this.db.prepare('DELETE FROM notices WHERE game_id = ?').run(id);
  }

  listMediaGames(): { id: string; definition: string; updatedAt: string }[] {
    const rows = this.db
      .prepare('SELECT id, definition, updated_at FROM media_games ORDER BY updated_at')
      .all() as { id: string; definition: string; updated_at: string }[];
    return rows.map((r) => ({ id: r.id, definition: r.definition, updatedAt: r.updated_at }));
  }

  saveMediaGame(id: string, definition: string): void {
    this.db
      .prepare(
        'INSERT INTO media_games (id, definition, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at',
      )
      .run(id, definition, new Date().toISOString());
  }

  deleteMediaGame(id: string): void {
    this.db.prepare('DELETE FROM media_games WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM game_flags WHERE game_id = ?').run(id);
    this.db.prepare('DELETE FROM notices WHERE game_id = ?').run(id);
  }

  listAssets(): AssetRow[] {
    return this.db
      .prepare('SELECT id, kind, mime, name, size, created_at FROM assets ORDER BY created_at DESC')
      .all() as AssetRow[];
  }

  getAsset(id: string): AssetRow | undefined {
    return this.db
      .prepare('SELECT id, kind, mime, name, size, created_at FROM assets WHERE id = ?')
      .get(id) as AssetRow | undefined;
  }

  saveAsset(row: AssetRow): void {
    this.db
      .prepare('INSERT INTO assets (id, kind, mime, name, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.kind, row.mime, row.name, row.size, row.created_at);
  }

  deleteAsset(id: string): void {
    this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  }

  stats(): Record<string, number> {
    const rows = this.db.prepare('SELECT key, value FROM stats').all() as {
      key: string;
      value: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
