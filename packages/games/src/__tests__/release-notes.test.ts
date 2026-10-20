import { describe, expect, it } from 'vitest';
import { RELEASE_NOTES, gameRegistry } from '../index.js';

const VERSION = /^\d+\.\d+\.\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('journal des versions des jeux', () => {
  it.each(gameRegistry.map((game) => [game.manifest.id, game.manifest.version] as const))(
    '%s : une entrée en tête, au numéro du manifeste (%s)',
    (id, version) => {
      const notes = RELEASE_NOTES[id] ?? [];
      expect(notes.length, `aucune entrée pour ${id}`).toBeGreaterThan(0);
      expect(notes[0]?.version).toBe(version);
    },
  );

  it('chaque entrée a un numéro, une date AAAA-MM-JJ valide et des changements lisibles', () => {
    for (const [id, notes] of Object.entries(RELEASE_NOTES)) {
      for (const note of notes ?? []) {
        expect(note.version, id).toMatch(VERSION);
        expect(note.date, id).toMatch(DATE);
        expect(Number.isNaN(Date.parse(note.date)), id).toBe(false);
        expect(note.changes.length, id).toBeGreaterThan(0);
        for (const change of note.changes) {
          expect(change.trim().length, `${id} : changement trop court`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('les entrées sont classées de la plus récente à la plus ancienne', () => {
    for (const [id, notes] of Object.entries(RELEASE_NOTES)) {
      const dates = (notes ?? []).map((note) => note.date);
      expect(dates, id).toEqual([...dates].sort().reverse());
    }
  });

  it('aucune entrée pour un jeu absent du registre', () => {
    const ids = new Set(gameRegistry.map((game) => game.manifest.id));
    for (const id of Object.keys(RELEASE_NOTES)) {
      expect(ids.has(id), `${id} n’est pas dans le registre`).toBe(true);
    }
  });
});
