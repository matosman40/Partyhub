import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../db/store.js';
import { CharacterPackService } from '../characters/packs.js';
import { moveCharactersFromDatabase, moveLegacyGameFolders } from '../contenu/migration.js';
import { personnageFiles, restorePersonnages } from '../contenu/personnages.js';
import { ImageLibrary } from '../images/library.js';
import { createLogger } from '../logger.js';

/**
 * Passage au stockage en fichiers (JEUX_DIR, PERSONNAGES_DIR) : les jeux déjà installés et les personnages
 * de la base sont déplacés au démarrage, sans perte et sans refaire le travail deux fois.
 */

const logger = createLogger('info', true);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'partyhub-contenu-'));
  dirs.push(dir);
  return dir;
}

describe('jeux installés : déplacement vers JEUX_DIR', () => {
  it('games/ et code-games/ passent dans le nouveau dossier, l’original disparaît', () => {
    const data = scratch();
    const jeux = path.join(scratch(), 'jeux');
    mkdirSync(path.join(data, 'games', 'quiz', '1.0.0'), { recursive: true });
    writeFileSync(path.join(data, 'games', 'quiz', '1.0.0', 'package.phgame'), 'paquet');
    mkdirSync(path.join(data, 'code-games', 'jeu-x'), { recursive: true });
    writeFileSync(path.join(data, 'code-games', 'jeu-x', 'x.txt'), 'code');

    expect(moveLegacyGameFolders(data, jeux, logger)).toEqual(['games', 'code-games']);
    expect(readFileSync(path.join(jeux, 'games', 'quiz', '1.0.0', 'package.phgame'), 'utf8')).toBe('paquet');
    expect(readFileSync(path.join(jeux, 'code-games', 'jeu-x', 'x.txt'), 'utf8')).toBe('code');
    expect(existsSync(path.join(data, 'games'))).toBe(false);
    expect(existsSync(path.join(data, 'code-games'))).toBe(false);
  });

  it('sans changement de dossier, ou si la cible existe déjà, rien ne bouge', () => {
    const data = scratch();
    mkdirSync(path.join(data, 'games'));
    expect(moveLegacyGameFolders(data, data, logger)).toEqual([]);

    const jeux = scratch();
    mkdirSync(path.join(jeux, 'games'));
    expect(moveLegacyGameFolders(data, jeux, logger)).toEqual([]);
    expect(existsSync(path.join(data, 'games'))).toBe(true);
  });
});

describe('personnages et images : de la base vers PERSONNAGES_DIR', () => {
  /** Données telles qu’une version précédente les écrivait dans la base. */
  function seedLegacy(store: Store): void {
    const db = store.db;
    const at = '2026-10-01T10:00:00.000Z';
    db.prepare('INSERT INTO character_packs (id, name, created_at) VALUES (?, ?, ?)').run('ana', 'Ana', at);
    db.prepare('INSERT INTO character_looks (pack_id, id, name, meta, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'ana',
      'standard',
      'Standard',
      JSON.stringify({ atlases: {} }),
      at,
    );
    db.prepare('INSERT INTO character_look_files (pack_id, look_id, atlas, data) VALUES (?, ?, ?, ?)').run(
      'ana',
      'standard',
      'visages',
      Buffer.from('PNG-VISAGES'),
    );
    db.prepare(
      'INSERT INTO ai_images (id, kind, tag, mime, provider, prompt, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('a'.repeat(24), 'portrait', 'v', 'image/png', 'test', 'un portrait', 4, Buffer.from('IMG1'), at);
  }

  it('les personnages et les images passent dans le dossier dédié, la base est allégée', () => {
    const store = new Store(':memory:');
    seedLegacy(store);
    const root = scratch();

    expect(moveCharactersFromDatabase(store.db, root, logger)).toEqual({ packs: 1, images: 1 });

    const count = (table: string) => (store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count('character_packs')).toBe(0);
    expect(count('character_looks')).toBe(0);
    expect(count('character_look_files')).toBe(0);
    expect(count('ai_images')).toBe(0);

    const packs = new CharacterPackService(root);
    expect(packs.list()).toEqual([
      {
        id: 'ana',
        name: 'Ana',
        createdAt: '2026-10-01T10:00:00.000Z',
        looks: [{ id: 'standard', name: 'Standard', atlases: {} }],
      },
    ]);
    expect(packs.atlasFile('ana', 'standard', 'visages')?.toString()).toBe('PNG-VISAGES');

    const library = new ImageLibrary(store, root);
    expect(library.list('portrait', 'v')).toHaveLength(1);
    expect(library.data('a'.repeat(24))?.bytes.toString()).toBe('IMG1');
    store.close();
  });

  it('une deuxième passe ne fait rien', () => {
    const store = new Store(':memory:');
    seedLegacy(store);
    const root = scratch();
    moveCharactersFromDatabase(store.db, root, logger);
    expect(moveCharactersFromDatabase(store.db, root, logger)).toEqual({ packs: 0, images: 0 });
    store.close();
  });

  it('l’archive reprend les personnages et les images, sans rien remplacer à la restauration', () => {
    const store = new Store(':memory:');
    seedLegacy(store);
    const source = scratch();
    moveCharactersFromDatabase(store.db, source, logger);

    const files = personnageFiles(source);
    const names = files.map((f) => f.name);
    expect(names).toHaveLength(4);
    expect(names).toEqual(
      expect.arrayContaining([
        'personnages/packs/ana/pack.json',
        'personnages/packs/ana/standard/visages.png',
        `personnages/images/${'a'.repeat(24)}.json`,
        `personnages/images/${'a'.repeat(24)}.png`,
      ]),
    );

    const target = scratch();
    const entries = new Map(files.map((f) => [f.name, f.data] as const));
    expect(restorePersonnages(target, entries)).toEqual({ added: 2, present: 0 });
    expect(new CharacterPackService(target).list().map((p) => p.id)).toEqual(['ana']);
    expect(new ImageLibrary(store, target).list('portrait', 'v')).toHaveLength(1);

    // Une seconde restauration laisse tout en place.
    expect(restorePersonnages(target, entries)).toEqual({ added: 0, present: 2 });

    // Un nom hors des dossiers prévus n’est jamais écrit.
    const hostile = new Map<string, Uint8Array>([
      ['personnages/../../evil.txt', new Uint8Array([1])],
      ['personnages/packs/ana/pack.json.tmp', new Uint8Array([1])],
    ]);
    const other = scratch();
    expect(restorePersonnages(other, hostile)).toEqual({ added: 0, present: 0 });
    expect(existsSync(path.join(other, 'packs'))).toBe(false);
    store.close();
  });

  it('un identifiant mal formé ne sert jamais de chemin', () => {
    const root = scratch();
    const packs = new CharacterPackService(root);
    expect(packs.atlasFile('../../etc', 'standard', 'visages')).toBeNull();
    expect(packs.atlasFile('ana', '../..', 'visages')).toBeNull();
    expect(packs.atlasFile('ana', 'standard', '../../secret')).toBeNull();
    expect(packs.get('../../etc')).toBeNull();
    expect(packs.remove('../../etc')).toBe(false);

    const library = new ImageLibrary(new Store(':memory:'), root);
    expect(library.data('../../../etc/passwd')).toBeNull();
  });
});
