import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GameImageKind } from '@partyhub/shared';
import type { Store } from '../db/store.js';
import { writeFileAtomic } from '../characters/packs.js';
import type { ImageMime, GeneratedImage } from './providers.js';

/**
 * Bibliothèque d’images générées : portraits de personnages et fonds de décor, rangés par catégorie et par thème.
 * Stockage dans PERSONNAGES_DIR : `images/<id>.<ext>` (les octets) et `images/<id>.json` (la fiche, écrite après
 * les octets). Rien n’est gardé dans la base, sauf le plafond journalier (table clé-valeur), pour survivre à un
 * redémarrage.
 */

/** Ce dont la bibliothèque a besoin de la base : le compteur journalier. */
export type ImageStore = Pick<Store, 'getKv' | 'setKv'>;

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

/** Extension de fichier par type d’image. */
const EXTENSION: Record<string, string | undefined> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Identifiant d’image : 24 caractères hexadécimaux. Il ne sert jamais de chemin sans cette vérification. */
const IMAGE_ID = /^[0-9a-f]{24}$/;

/** Écrit une image et sa fiche dans le dossier `images/` de PERSONNAGES_DIR. */
export function writeImage(imagesDir: string, record: StoredImage, bytes: Uint8Array): void {
  const ext = EXTENSION[record.mime] ?? 'bin';
  writeFileAtomic(path.join(imagesDir, `${record.id}.${ext}`), bytes);
  writeFileAtomic(path.join(imagesDir, `${record.id}.json`), JSON.stringify(record));
}

/** Jour UTC, pour le plafond journalier. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class ImageLibrary {
  private readonly imagesDir: string;

  /** `root` : dossier des personnages (PERSONNAGES_DIR). Les images vont dans son sous-dossier `images/`. */
  constructor(
    private readonly store: ImageStore,
    root: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.imagesDir = path.join(root, 'images');
  }

  /** Garde une image générée et renvoie sa fiche. */
  add(input: {
    kind: GameImageKind;
    tag: string;
    prompt: string;
    provider: string;
    image: GeneratedImage;
  }): StoredImage {
    const record: StoredImage = {
      id: randomBytes(12).toString('hex'),
      kind: input.kind,
      tag: input.tag,
      mime: input.image.mime,
      provider: input.provider,
      prompt: input.prompt,
      size: input.image.bytes.length,
      createdAt: this.now().toISOString(),
    };
    writeImage(this.imagesDir, record, input.image.bytes);
    return record;
  }

  /** Toutes les fiches, les plus anciennes d’abord. Une fiche illisible est ignorée. */
  private all(): StoredImage[] {
    if (!fs.existsSync(this.imagesDir)) return [];
    const records: StoredImage[] = [];
    for (const name of fs.readdirSync(this.imagesDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(this.imagesDir, name), 'utf8')) as StoredImage;
        if (IMAGE_ID.test(record.id) && name === `${record.id}.json`) records.push(record);
      } catch {
        // Fiche illisible : on ne la compte pas.
      }
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** Images d’une catégorie et d’un thème, les plus anciennes d’abord. */
  list(kind: GameImageKind, tag: string): StoredImage[] {
    return this.all().filter((record) => record.kind === kind && record.tag === tag);
  }

  count(kind: GameImageKind, tag: string): number {
    return this.list(kind, tag).length;
  }

  /** Octets et type d’une image, pour la servir. Null si elle n’existe pas. */
  data(id: string): { bytes: Buffer; mime: ImageMime } | null {
    if (!IMAGE_ID.test(id)) return null;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(this.imagesDir, `${id}.json`), 'utf8')) as StoredImage;
      const ext = EXTENSION[record.mime];
      if (!ext) return null;
      const bytes = fs.readFileSync(path.join(this.imagesDir, `${id}.${ext}`));
      return { bytes, mime: record.mime };
    } catch {
      return null;
    }
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
