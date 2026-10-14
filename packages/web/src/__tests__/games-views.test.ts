import { describe, expect, it } from 'vitest';
import { viewsFor } from '../games.js';

describe('vues des jeux', () => {
  it('chaque jeu connu a ses vues (salon, hôte, joueur)', () => {
    const views = viewsFor('reflexe');
    expect(views).toBeTruthy();
    expect(views?.Host).toBeTruthy();
    expect(views?.Player).toBeTruthy();
  });

  it('un jeu inconnu n’a pas de vues', () => {
    expect(viewsFor('jeu-inexistant')).toBeNull();
  });
});
