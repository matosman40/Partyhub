import { describe, expect, it } from 'vitest';
import { gameRegistry } from '../index.js';

describe('registre des jeux intégrés', () => {
  it('chaque jeu a un identifiant unique', () => {
    const ids = gameRegistry.map((g) => g.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('les réglages par défaut respectent le schéma de chaque jeu', () => {
    for (const game of gameRegistry) {
      const parsed = game.settingsSchema.safeParse(game.defaultSettings);
      expect(parsed.success, game.manifest.id).toBe(true);
    }
  });

  it('le nombre de joueurs et la durée estimée sont cohérents', () => {
    for (const game of gameRegistry) {
      expect(game.manifest.minPlayers, game.manifest.id).toBeGreaterThanOrEqual(1);
      expect(game.manifest.maxPlayers, game.manifest.id).toBeGreaterThanOrEqual(game.manifest.minPlayers);
      expect(game.manifest.durationMin, game.manifest.id).toBeGreaterThan(0);
    }
  });
});
