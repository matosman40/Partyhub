import { randomBytes } from 'node:crypto';
import type { GameImageKind } from '@partyhub/shared';
import type { Store } from '../db/store.js';
import type { ImageMime, GeneratedImage } from './providers.js';

/**
 * Bibliothèque d’images générées : portraits de personnages et fonds de décor, rangés par catégorie et par thème.
 * Les images sont stockées en base (comme les voix de profil) : elles suivent les sauvegardes de la base.
 * Le plafond journalier se compte dans la table clé-valeur, pour survivre à un redémarrage.
 */

/** Ce dont la bibliothèque a besoin de la base : les requêtes, et la table clé-valeur. */
export type ImageStore = Pick<Store, 'db' | 'getKv' | 'setKv'>;

export interface StoredImage {
  id: string;
  kind: GameImageKind;
  tag: string;
  mime: ImageMime;
  provider: string;
  prompt: string;
  size: number;
  createdAt: string;
}

interface ImageRow {
  id: string;
  kind: string;
  tag: string;
  mime: string;
  provider: string;
  prompt: string;
  size: number;
  created_at: string;
}

const LIST_COLUMNS = 'id, kind, tag, mime, provider, prompt, size, created_at';

function toStored(row: ImageRow): StoredImage {
  return {
    id: row.id,
    kind: row.kind as GameImageKind,
    tag: row.tag,
    mime: row.mime as ImageMime,
    provider: row.provider,
    prompt: row.prompt,
    size: row.size,
    createdAt: row.created_at,
  };
}

/** Jour UTC, pour le plafond journalier. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class ImageLibrary {
  constructor(
    private readonly store: ImageStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Garde une image générée et renvoie sa fiche. */
  add(input: {
    kind: GameImageKind;
    tag: string;
    prompt: string;
    provider: string;
    image: GeneratedImage;
  }): StoredImage {
    const id = randomBytes(12).toString('hex');
    const createdAt = this.now().toISOString();
    this.store.db
      .prepare(
        'INSERT INTO ai_images (id, kind, tag, mime, provider, prompt, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.kind,
        input.tag,
        input.image.mime,
        input.provider,
        input.prompt,
        input.image.bytes.length,
        input.image.bytes,
        createdAt,
      );
    return {
      id,
      kind: input.kind,
      tag: input.tag,
      mime: input.image.mime,
      provider: input.provider,
      prompt: input.prompt,
      size: input.image.bytes.length,
      createdAt,
    };
  }

  /** Images d’une catégorie et d’un thème, les plus anciennes d’abord. */
  list(kind: GameImageKind, tag: string): StoredImage[] {
    const rows = this.store.db
      .prepare(`SELECT ${LIST_COLUMNS} FROM ai_images WHERE kind = ? AND tag = ? ORDER BY created_at, rowid`)
      .all(kind, tag) as ImageRow[];
    return rows.map(toStored);
  }

  count(kind: GameImageKind, tag: string): number {
    const row = this.store.db
      .prepare('SELECT COUNT(*) AS n FROM ai_images WHERE kind = ? AND tag = ?')
      .get(kind, tag) as { n: number };
    return row.n;
  }

  /** Octets et type d’une image, pour la servir. Null si elle n’existe pas. */
  data(id: string): { bytes: Buffer; mime: ImageMime } | null {
    const row = this.store.db.prepare('SELECT mime, data FROM ai_images WHERE id = ?').get(id) as
      { mime: string; data: Buffer } | undefined;
    return row ? { bytes: row.data, mime: row.mime as ImageMime } : null;
  }

  /** Nombre d’images générées aujourd’hui (jour UTC). */
  usedToday(): number {
    const raw = this.store.getKv(`ai-images:usage:${dayKey(this.now())}`);
    const value = raw === undefined ? 0 : Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  /** Compte une génération réussie pour le plafond du jour. */
  recordUse(): void {
    this.store.setKv(`ai-images:usage:${dayKey(this.now())}`, String(this.usedToday() + 1));
  }
}
