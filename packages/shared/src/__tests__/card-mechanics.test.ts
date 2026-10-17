import { describe, expect, it } from 'vitest';
import { WILD_FAMILY, cardGameDefinitionSchema } from '../card-games.js';

/**
 * Règles de validation propres à chaque mécanique : ressemblance (race), plis (trick), mémo (memory) et
 * défausse. Les messages sont ceux que voit l'administrateur, à l'emplacement exact du champ fautif.
 */

const FAMILIES = [
  { id: 'rouge', label: 'Rouge', color: '#ff0000' },
  { id: 'bleu', label: 'Bleu', color: '#0000ff' },
];

function cardsOf(n: number, extra: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    label: `Carte ${i}`,
    symbol: String(i % 9),
    family: i % 2 ? 'rouge' : 'bleu',
    effect: 'none',
    count: 1,
    points: 1,
    ...extra,
  }));
}

function game(rules: Record<string, unknown>, cards = cardsOf(12)): unknown {
  return {
    name: 'Essai',
    description: 'Un jeu de test.',
    icon: '🎴',
    theme: 'arcade',
    families: FAMILIES,
    cards,
    rules: { minPlayers: 2, maxPlayers: 3, handSize: 3, matchOn: 'either', targetScore: 50, turnSeconds: 10, ...rules },
    notice: { goal: 'Gagner.', steps: ['Jouer.'], tips: [] },
  };
}

/** Liste « chemin: message » des erreurs du schéma, vide si la définition est valide. */
function issues(input: unknown): string[] {
  const res = cardGameDefinitionSchema.safeParse(input);
  return res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('Ressemblance (race)', () => {
  it('accepte un paquet sans effet, assez grand pour la distribution et le centre', () => {
    expect(issues(game({ mechanic: 'race' }))).toEqual([]);
  });

  it('refuse un effet sur une carte, à son emplacement', () => {
    const cards = cardsOf(12);
    cards[3] = { ...cards[3], effect: 'skip' } as (typeof cards)[number];
    expect(issues(game({ mechanic: 'race' }, cards)).some((m) => m.startsWith('cards.3.effect'))).toBe(true);
  });

  it('refuse un joker', () => {
    const cards = cardsOf(12);
    cards[0] = { ...cards[0], family: WILD_FAMILY, effect: 'wild' } as (typeof cards)[number];
    expect(issues(game({ mechanic: 'race' }, cards)).some((m) => m.startsWith('cards.0.effect'))).toBe(true);
  });

  it('exige une carte de plus que les mains, pour le centre', () => {
    // 3 joueurs à 3 cartes : 9 pour les mains, 10 avec le centre.
    expect(issues(game({ mechanic: 'race' }, cardsOf(9)))).toEqual([
      expect.stringContaining('Il faut au moins 10 cartes'),
    ]);
    expect(issues(game({ mechanic: 'race' }, cardsOf(10)))).toEqual([]);
  });

  it('refuse plus de 120 cartes', () => {
    expect(issues(game({ mechanic: 'race' }, cardsOf(121)))).toEqual([expect.stringContaining('Au plus 120')]);
  });

  it('refuse un atout', () => {
    expect(issues(game({ mechanic: 'race', trump: 'rouge' })).some((m) => m.startsWith('rules.trump'))).toBe(true);
  });
});

describe('Plis (trick)', () => {
  it('accepte un paquet tout juste assez grand : une carte de moins qu’à la ressemblance', () => {
    expect(issues(game({ mechanic: 'trick' }, cardsOf(9)))).toEqual([]);
  });

  it('accepte un atout qui est une famille du jeu', () => {
    expect(issues(game({ mechanic: 'trick', trump: 'rouge' }))).toEqual([]);
  });

  it('refuse un atout qui n’est pas une famille du jeu', () => {
    expect(issues(game({ mechanic: 'trick', trump: 'vert' }))).toEqual([
      expect.stringContaining('L’atout « vert » n’est pas une famille'),
    ]);
  });

  it('refuse un joker et un effet', () => {
    const cards = cardsOf(12);
    cards[1] = { ...cards[1], effect: 'draw2' } as (typeof cards)[number];
    expect(issues(game({ mechanic: 'trick' }, cards)).some((m) => m.startsWith('cards.1.effect'))).toBe(true);
  });
});

describe('Atout hors plis', () => {
  it('est refusé à la défausse et au mémo', () => {
    const shedding = issues(game({ trump: 'rouge' }, cardsOf(20)));
    expect(shedding).toEqual([expect.stringContaining('Seule la mécanique « plis » accepte un atout')]);
    const memory = issues(game({ mechanic: 'memory', trump: 'rouge' }, cardsOf(4)));
    expect(memory.some((m) => m.startsWith('rules.trump'))).toBe(true);
  });
});

describe('Mémo : paires sur un espace de clés séparé', () => {
  it('une carte identifiée « x » et une carte dont la paire est « x » forment deux groupes distincts', () => {
    // Sans séparation des clés, les deux groupes se confondraient (4 cartes sous « x »).
    const cards = [
      { id: 'x', label: 'Un', symbol: '1', family: 'rouge', effect: 'none', count: 2, points: 1 },
      { id: 'y', label: 'Deux', symbol: '2', family: 'bleu', effect: 'none', count: 2, points: 1, pair: 'x' },
    ];
    expect(issues(game({ mechanic: 'memory' }, cards))).toEqual([]);
  });
});
