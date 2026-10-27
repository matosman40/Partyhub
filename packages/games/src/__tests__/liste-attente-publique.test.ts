import { describe, expect, it } from 'vitest';
import type { GameModule } from '@partyhub/shared';
import { gameRegistry } from '../index.js';
import { PLAYERS } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

/**
 * Les listes « qui n’a pas encore répondu » sont publiques : la vue publique (téléphones, écran commun)
 * doit donner la même liste que la vue hôte, à chaque phase qui attend des joueurs.
 */
const GAMES = [
  'quiz-party',
  'phrases-trous',
  'association',
  'plutot-qui',
  'imposteur',
  'plus-ou-moins',
  'micro-defis',
  'gags-en-rafale',
  'funambule',
  'imite-moi',
  'aventure-ia',
];

describe('liste des joueurs en attente, visible en vue publique', () => {
  for (const id of GAMES) {
    it(`${id} : vue publique = vue hôte`, () => {
      const game = gameRegistry.find((g) => g.manifest.id === id) as GameModule | undefined;
      expect(game, id).toBeDefined();
      if (!game) return;
      const h = harness();
      let state = game.initialize(game.defaultSettings, PLAYERS, h.ctx);
      const started = game.start(state, h.ctx);
      expect(started.ok, id).toBe(true);
      if (!started.ok) return;
      state = started.state;
      const pub = game.getPublicState(state) as { pending?: unknown };
      const host = game.getHostState(state) as { pending?: unknown };
      expect(Array.isArray(pub.pending), `${id} pending public`).toBe(true);
      expect(pub.pending, id).toEqual(host.pending ?? []);
    });
  }
});
