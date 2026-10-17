import { describe, expect, it } from 'vitest';
import { Store } from '../db/store.js';
import { gameDataFor, GAME_DATA_LIMIT_CHARS, gameDataKey } from '../profiles/game-data.js';
import { ProfileService } from '../profiles/service.js';

/**
 * Données de jeu par profil : chaque jeu a ses entrées, bornées en taille, et elles partent avec le profil.
 */

function setup() {
  const store = new Store(':memory:');
  const profiles = new ProfileService(store);
  return { store, profiles, data: gameDataFor(store) };
}

describe('Données de jeu par profil', () => {
  it('relit ce qui a été écrit, pour le même jeu et le même profil seulement', () => {
    const { store, data } = setup();
    const aventure = data('aventure-ia');
    const autre = data('autre-jeu');

    expect(aventure.read('p1')).toBeNull();
    aventure.write('p1', { version: 1, characters: [{ name: 'Mirelle' }] });

    expect(aventure.read('p1')).toEqual({ version: 1, characters: [{ name: 'Mirelle' }] });
    expect(aventure.read('p2')).toBeNull();
    expect(autre.read('p1')).toBeNull();
    store.close();
  });

  it('refuse une donnée trop volumineuse, sans rien écrire', () => {
    const { store, data } = setup();
    const aventure = data('aventure-ia');
    aventure.write('p1', { ok: true });

    const huge = { text: 'x'.repeat(GAME_DATA_LIMIT_CHARS) };
    expect(() => aventure.write('p1', huge)).toThrow('trop volumineuse');
    expect(aventure.read('p1')).toEqual({ ok: true });
    store.close();
  });

  it('une valeur abîmée en base se lit comme absente', () => {
    const { store, data } = setup();
    store.setKv(gameDataKey('aventure-ia', 'p1'), '{pas du json');
    expect(data('aventure-ia').read('p1')).toBeNull();
    store.close();
  });

  it('supprimer un profil efface ses données de jeu, sans toucher à celles des autres', async () => {
    const { store, profiles, data } = setup();
    const gone = (await profiles.register({ displayName: 'Léa' })).profile.id;
    const kept = (await profiles.register({ displayName: 'Tom' })).profile.id;
    const aventure = data('aventure-ia');
    aventure.write(gone, { characters: [1] });
    aventure.write(kept, { characters: [2] });

    profiles.delete(gone);

    expect(aventure.read(gone)).toBeNull();
    expect(aventure.read(kept)).toEqual({ characters: [2] });
    store.close();
  });
});
