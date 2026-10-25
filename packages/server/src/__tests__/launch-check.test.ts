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

  it('refuse un jeu dont la vue change d’une partie à l’autre (une horloge lue directement)', () => {
    // Une horloge qui avance : deux parties ne peuvent pas la lire à l'identique. Avec l'horloge réelle, le test
    // dépendrait de la milliseconde où tourne chaque partie.
    let clock = 0;
    const clocked = wrap(first, (mod) => {
      const host = mod.getHostState.bind(mod);
      return { ...mod, getHostState: (state: unknown) => ({ ...(host(state) as object), at: ++clock }) };
    });
    const result = launchCheck(clocked);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ctx.now()');
  });
});

describe('contrôle de lancement : temps réel', () => {
  // Bombes party est un jeu en temps réel : sa fin de manche passe par un minuteur. Les robots jouent sans
  // relâche, donc sans horloge simulée la manche ne finirait jamais (voir STEP_MS dans launch-check.ts).
  it('mène à leur fin les parties de Bombes party, dont la manche se termine par minuteur', () => {
    const bombes = gameRegistry.find((g) => g.manifest.id === 'bombes-party') as GameModule | undefined;
    expect(bombes).toBeDefined();
    expect(launchCheck(bombes!)).toMatchObject({ ok: true });
  }, 120_000);
});
