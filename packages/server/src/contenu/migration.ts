import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { PACK_FILE, writeFileAtomic, type StoredLook, type StoredPack } from '../characters/packs.js';
import { writeImage, type StoredImage } from '../images/library.js';
import type { Logger } from '../logger.js';

/**
 * Passage au stockage en fichiers, au démarrage. Deux déplacements, tous deux sans perte :
 *
 * 1. `games/` et `code-games/` passent de l’ancien dossier de données (DATA_DIR) à JEUX_DIR, s’ils sont ailleurs.
 *    Les volumes Docker sont des systèmes de fichiers distincts : on copie, puis on supprime l’original.
 * 2. Les personnages et les images générées passent de la base vers PERSONNAGES_DIR. Les fichiers sont écrits
 *    d’abord ; les lignes de la base ne sont supprimées qu’ensuite, puis la base est compactée.
 *
 * Les deux opérations sont idempotentes : rien à faire = rien ne change. Une erreur est journalisée et la
 * donnée reste à son emplacement d’origine.
 */

/** Déplace `games/` et `code-games/` vers JEUX_DIR. Renvoie les noms déplacés. */
export function moveLegacyGameFolders(dataDir: string, jeuxDir: string, logger: Logger): string[] {
  if (path.resolve(dataDir) === path.resolve(jeuxDir)) return [];
  const moved: string[] = [];
  for (const name of ['games', 'code-games']) {
    const from = path.join(dataDir, name);
    const to = path.join(jeuxDir, name);
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) {
      logger.warn(
        { event: 'contenu.legacy-kept', from, to },
        `Le dossier « ${name} » existe aux deux emplacements : rien n’a été déplacé. Vérifiez lequel garder.`,
      );
      continue;
    }
    try {
      fs.mkdirSync(jeuxDir, { recursive: true });
      fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
      fs.rmSync(from, { recursive: true, force: true });
      moved.push(name);
      logger.info({ event: 'contenu.moved', from, to }, `Le dossier « ${name} » est passé dans JEUX_DIR`);
    } catch (err) {
      // La copie a échoué : on retire la copie partielle (le dossier cible n’existait pas), l’original reste intact.
      fs.rmSync(to, { recursive: true, force: true });
      logger.error(
        { event: 'contenu.move-failed', from, to, error: (err as Error).message },
        `Déplacement de « ${name} » impossible : il reste dans ${dataDir}`,
      );
    }
  }
  return moved;
}

interface PackRow {
  id: string;
  name: string;
  created_at: string;
}

interface LookRow {
  id: string;
  name: string;
  meta: string;
  created_at: string;
}

interface FileRow {
  look_id: string;
  atlas: string;
  data: Buffer;
}

interface ImageRow {
  id: string;
  kind: string;
  tag: string;
  mime: string;
  provider: string;
  prompt: string;
  size: number;
  data: Buffer;
  created_at: string;
}

export interface CharacterMigration {
  packs: number;
  images: number;
}

/** Personnages et images générées de la base → PERSONNAGES_DIR. Renvoie ce qui a été migré. */
export function moveCharactersFromDatabase(db: Database.Database, root: string, logger: Logger): CharacterMigration {
  const packRows = db.prepare('SELECT id, name, created_at FROM character_packs').all() as PackRow[];
  const imageRows = db
    .prepare('SELECT id, kind, tag, mime, provider, prompt, size, data, created_at FROM ai_images')
    .all() as ImageRow[];
  if (packRows.length === 0 && imageRows.length === 0) return { packs: 0, images: 0 };

  const looksOf = db.prepare('SELECT id, name, meta, created_at FROM character_looks WHERE pack_id = ?');
  const filesOf = db.prepare('SELECT look_id, atlas, data FROM character_look_files WHERE pack_id = ?');
  const migratedPacks: string[] = [];
  for (const row of packRows) {
    try {
      const looks = looksOf.all(row.id) as LookRow[];
      const files = filesOf.all(row.id) as FileRow[];
      const stored: StoredPack = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        looks: looks.map((look): StoredLook => ({
          id: look.id,
          name: look.name,
          createdAt: look.created_at,
          atlases: (JSON.parse(look.meta) as { atlases: StoredLook['atlases'] }).atlases,
        })),
      };
      const dir = path.join(root, 'packs', row.id);
      for (const file of files) {
        const target = path.join(dir, file.look_id, `${file.atlas}.png`);
        if (!fs.existsSync(target)) writeFileAtomic(target, file.data);
      }
      writeFileAtomic(path.join(dir, PACK_FILE), JSON.stringify(stored));
      migratedPacks.push(row.id);
    } catch (err) {
      logger.error(
        { event: 'contenu.pack-failed', id: row.id, error: (err as Error).message },
        `Personnage « ${row.id} » non migré : il reste dans la base`,
      );
    }
  }

  const imagesDir = path.join(root, 'images');
  const migratedImages: string[] = [];
  for (const row of imageRows) {
    try {
      const record: StoredImage = {
        id: row.id,
        kind: row.kind as StoredImage['kind'],
        tag: row.tag,
        mime: row.mime as StoredImage['mime'],
        provider: row.provider,
        prompt: row.prompt,
        size: row.size,
        createdAt: row.created_at,
      };
      if (!fs.existsSync(path.join(imagesDir, `${row.id}.json`))) writeImage(imagesDir, record, row.data);
      migratedImages.push(row.id);
    } catch (err) {
      logger.error(
        { event: 'contenu.image-failed', id: row.id, error: (err as Error).message },
        `Image « ${row.id} » non migrée : elle reste dans la base`,
      );
    }
  }

  // Les lignes ne partent qu’une fois leurs fichiers écrits.
  db.transaction(() => {
    for (const id of migratedPacks) {
      db.prepare('DELETE FROM character_look_files WHERE pack_id = ?').run(id);
      db.prepare('DELETE FROM character_looks WHERE pack_id = ?').run(id);
      db.prepare('DELETE FROM character_packs WHERE id = ?').run(id);
    }
    for (const id of migratedImages) db.prepare('DELETE FROM ai_images WHERE id = ?').run(id);
  })();
  if (migratedPacks.length > 0 || migratedImages.length > 0) {
    // Rend la place aux pages libérées : la base de sauvegarde ne garde plus les images.
    db.exec('VACUUM');
  }
  logger.info(
    { event: 'contenu.characters-moved', packs: migratedPacks.length, images: migratedImages.length },
    'Personnages et images passés dans PERSONNAGES_DIR',
  );
  return { packs: migratedPacks.length, images: migratedImages.length };
}
