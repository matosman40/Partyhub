import { describe, expect, it } from 'vitest';
import { gameRegistry } from '@partyhub/games';
import { clientViews } from '@partyhub/games/client';

/**
 * Tout jeu qui a des réglages doit avoir un formulaire : sans lui, l'administrateur (et l'hôte)
 * ne peut pas les modifier.
 */
describe('formulaires de réglages', () => {
  it('chaque jeu du registre qui a des réglages a un formulaire', () => {
    for (const game of gameRegistry) {
      const shape = (game.settingsSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      if (Object.keys(shape).length === 0) continue;
      expect(clientViews[game.manifest.id]?.Settings, game.manifest.id).toBeDefined();
    }
  });
});
