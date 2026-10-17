import { describe, expect, it } from 'vitest';
import {
  MAX_BAG,
  gainItem,
  gainXp,
  heal,
  levelOf,
  loseLife,
  nextLevelXp,
  relationOf,
  shiftBond,
  shiftDifficulty,
  syncLevel,
} from '../aventure/progression.js';
import type { Character } from '../aventure/types.js';

const base = (extra: Partial<Character> = {}): Character => ({
  id: 'c1',
  libraryId: null,
  name: 'Mirelle',
  title: 'Cartographe',
  emoji: '🧭',
  backstory: 'Elle dessine des cartes.',
  stats: { force: 1, ruse: 4, esprit: 3, charme: 2 },
  pvMax: 8,
  pv: 8,
  ability: { name: 'Trait', text: 'Un raccourci.' },
  flaw: 'Elle se perd.',
  item: 'Une boussole.',
  bag: [],
  level: 1,
  xp: 0,
  xpStart: 0,
  games: 0,
  victories: 0,
  ownerId: 'a',
  ...extra,
});

describe('niveaux', () => {
  it('le niveau suit l’expérience totale, plafonné à 5', () => {
    expect([0, 14, 15, 39, 40, 75, 119, 120, 999].map(levelOf)).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5]);
  });

  it('nextLevelXp indique le seuil suivant, ou null au niveau maximum', () => {
    expect(nextLevelXp(1)).toBe(15);
    expect(nextLevelXp(4)).toBe(120);
    expect(nextLevelXp(5)).toBeNull();
  });

  it('gagner assez d’expérience passe au niveau suivant : +1 PV max, +2 PV, +1 à la stat la plus basse', () => {
    const { character, lines } = gainXp(base({ xp: 10, pv: 5 }), 5);
    expect(character).toMatchObject({ level: 2, xp: 15, pvMax: 9, pv: 7 });
    expect(character.stats.force).toBe(2);
    expect(lines.join(' ')).toMatch(/passe au niveau 2 : \+1 Force/);
  });

  it('syncLevel rattrape plusieurs niveaux d’un coup, puis ne change plus rien', () => {
    const once = syncLevel(base({ xp: 40 }));
    expect(once.character.level).toBe(3);
    expect(once.lines).toHaveLength(2);
    const twice = syncLevel(once.character);
    expect(twice.lines).toEqual([]);
    expect(twice.character).toEqual(once.character);
  });

  it('les PV max plafonnent à 14, et un personnage à terre ne se relève pas au passage de niveau', () => {
    const down = gainXp(base({ xp: 10, pv: 0, pvMax: 14 }), 5).character;
    expect(down).toMatchObject({ level: 2, pvMax: 14, pv: 0 });
  });

  it('gagner zéro d’expérience ne change rien', () => {
    const c = base({ xp: 3 });
    expect(gainXp(c, 0)).toEqual({ character: c, lines: [] });
  });
});

describe('objets', () => {
  it('le sac garde quatre objets, le plus ancien part en premier', () => {
    let c = base();
    for (const item of ['a', 'b', 'c', 'd', 'e']) c = gainItem(c, item).character;
    expect(c.bag).toEqual(['b', 'c', 'd', 'e']);
    expect(c.bag).toHaveLength(MAX_BAG);
  });
});

describe('soins et blessures', () => {
  it('soigner ne relève pas un personnage à terre, et ne dépasse pas le maximum', () => {
    expect(heal(base({ pv: 0 }), 2).character.pv).toBe(0);
    expect(heal(base({ pv: 7, pvMax: 8 }), 5).character.pv).toBe(8);
  });

  it('perdre des PV jusqu’à zéro met le personnage à terre, avec une ligne dédiée', () => {
    const hurt = loseLife(base({ pv: 2 }), 5);
    expect(hurt.character.pv).toBe(0);
    expect(hurt.lines).toEqual(['Mirelle tombe à terre.']);
  });
});

describe('liens avec les personnages secondaires', () => {
  it('le lien reste entre -3 et +3, et se décrit en mots', () => {
    expect(shiftBond(3, 2)).toBe(3);
    expect(shiftBond(-3, -1)).toBe(-3);
    expect([-2, -1, 0, 2, 3].map(relationOf)).toEqual(['hostile', 'méfiant', 'neutre', 'amical', 'allié']);
  });
});

describe('difficulté', () => {
  it('une difficulté décalée reste entre 6 et 18', () => {
    expect(shiftDifficulty(16, 3)).toBe(18);
    expect(shiftDifficulty(7, -3)).toBe(6);
    expect(shiftDifficulty(10, 2)).toBe(12);
  });
});
