import { afterEach, describe, expect, it } from 'vitest';
import type { GameModule } from '@partyhub/shared';
import { allGames, resolveGame, setCustomGames, sourceOf } from '../games-registry.js';

/** Module de test : seule l'identité compte pour le registre. */
function fakeCodeGame(id: string): GameModule {
  return { manifest: { id, name: id } } as unknown as GameModule;
}

describe('paquet de code qui remplace un jeu intégré', () => {
  afterEach(() => setCustomGames('code', []));

  it('sans paquet, le jeu intégré répond', () => {
    expect(sourceOf('plus-ou-moins')).toBe('builtin');
    expect(resolveGame('plus-ou-moins')?.manifest.version).toBeTruthy();
  });

  it('un paquet actif passe avant le jeu intégré, sans doublon dans la liste', () => {
    setCustomGames('code', [fakeCodeGame('plus-ou-moins')]);
    expect(sourceOf('plus-ou-moins')).toBe('code');
    expect(resolveGame('plus-ou-moins')).toBe(allGames().find((g) => g.manifest.id === 'plus-ou-moins'));
    expect(allGames().filter((g) => g.manifest.id === 'plus-ou-moins')).toHaveLength(1);
  });

  it('le jeu intégré revient quand le paquet est retiré', () => {
    setCustomGames('code', [fakeCodeGame('plus-ou-moins')]);
    setCustomGames('code', []);
    expect(sourceOf('plus-ou-moins')).toBe('builtin');
    expect(allGames().filter((g) => g.manifest.id === 'plus-ou-moins')).toHaveLength(1);
  });
});
