import { describe, expect, it } from 'vitest';
import { gameRegistry } from '@partyhub/games';
import type { GameModule } from '@partyhub/shared';
import { launchCheck } from '../packages/launch-check.js';

/** Enveloppe un jeu intégré ; `patch` modifie une méthode pour y glisser un défaut précis. */
function wrap(base: GameModule, patch: (mod: GameModule) => GameModule): GameModule {
  return patch({ ...base });
}

const first = gameRegistry[0] as GameModule;

describe('contrôle de lancement', () => {
  // Jeux intégrés que les robots mènent à leur fin. Les trois autres (bombes-party, banquise : parties
  // que les robots ne terminent pas ; plateau-test : plateau d'essai) échouaient déjà avant ce contrôle.
  const PLAYABLE_BY_BOTS = [
    'quiz-party',
    'phrases-trous',
    'association',
    'plutot-qui',
    'imposteur',
    'aventure-ia',
    'plus-ou-moins',
    'reflexe',
    'micro-defis',
    'gags-en-rafale',
    'funambule',
    'cartes-couleurs',
    'cartes-coco',
    'president',
    'promoteur',
    'loups-village',
    'sudoku',
    'solitaire',
    'taquin',
    'mots-croises',
    'rami-51',
    'tarot',
    'poker-texas',
    'imite-moi',
    'boum',
  ];

  it('ne signale aucun faux positif sur les jeux intégrés que les robots peuvent finir', () => {
    for (const id of PLAYABLE_BY_BOTS) {
      const game = gameRegistry.find((g) => g.manifest.id === id) as GameModule | undefined;
      expect(game, id).toBeDefined();
      expect(launchCheck(game!), id).toMatchObject({ ok: true });
    }
  }, 300_000);

  it('refuse un jeu qui garde un état entre parties', () => {
    let calls = 0;
    const leaky = wrap(first, (mod) => {
      const host = mod.getHostState.bind(mod);
      return { ...mod, getHostState: (state: unknown) => ({ ...(host(state) as object), calls: ++calls }) };
    });
    const result = launchCheck(leaky);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/partie \d/);
  });

  it('refuse un jeu qui lit l’horloge réelle', () => {
    const clocked = wrap(first, (mod) => {
      const host = mod.getHostState.bind(mod);
      return { ...mod, getHostState: (state: unknown) => ({ ...(host(state) as object), at: Date.now() }) };
    });
    const result = launchCheck(clocked);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ctx.now()');
  });
});
