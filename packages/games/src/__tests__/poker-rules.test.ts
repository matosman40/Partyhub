import { describe, expect, it } from 'vitest';
import {
  buildPots,
  compareHands,
  evaluateBest,
  evaluateFive,
  parseCard,
  resolvePots,
} from '../poker/rules.js';

describe('Lecture des cartes du poker', () => {
  it('lit le rang puis la couleur, avec les figures et l’as', () => {
    expect(parseCard('As')).toEqual({ rank: 14, suit: 0 });
    expect(parseCard('Th')).toEqual({ rank: 10, suit: 1 });
    expect(parseCard('2c')).toEqual({ rank: 2, suit: 3 });
  });
});

describe('Évaluation des mains', () => {
  it('reconnaît la quinte flush, le carré, le full, la couleur, la suite et la paire', () => {
    expect(evaluateFive(['Ts', 'Js', 'Qs', 'Ks', 'As'].map(parseCard)).category).toBe(8);
    expect(evaluateFive(['9h', '9d', '9s', '9c', '2d'].map(parseCard)).category).toBe(7);
    expect(evaluateFive(['Kh', 'Kd', 'Ks', '4c', '4d'].map(parseCard)).category).toBe(6);
    expect(evaluateFive(['2h', '5h', '9h', 'Jh', 'Kh'].map(parseCard)).category).toBe(5);
    expect(evaluateFive(['5s', '6d', '7c', '8h', '9s'].map(parseCard)).category).toBe(4);
    expect(evaluateFive(['Ah', 'Ad', 'Ks', '7c', '2d'].map(parseCard)).category).toBe(1);
  });

  it('reconnaît la suite basse as-5 (la roue), dont la plus haute carte est le 5', () => {
    const wheel = evaluateFive(['As', '2h', '3d', '4c', '5s'].map(parseCard));
    expect(wheel.category).toBe(4);
    expect(wheel.ranks).toEqual([5]);
  });

  it('choisit la meilleure main parmi sept cartes', () => {
    // Paire de rois en main, trois rois sur la table : brelan.
    const best = evaluateBest(['Kh', 'Kd', 'Ks', '3c', '8d', '2h', '9c']);
    expect(best.category).toBe(3);
  });

  it('classe les mains : une couleur bat une suite, une paire d’as bat une paire de rois', () => {
    const flush = evaluateFive(['2h', '5h', '9h', 'Jh', 'Kh'].map(parseCard));
    const straight = evaluateFive(['5s', '6d', '7c', '8h', '9s'].map(parseCard));
    expect(compareHands(flush, straight)).toBeGreaterThan(0);

    const aces = evaluateFive(['Ah', 'Ad', '3s', '7c', '2d'].map(parseCard));
    const kings = evaluateFive(['Kh', 'Kd', '3s', '7c', '2d'].map(parseCard));
    expect(compareHands(aces, kings)).toBeGreaterThan(0);
    expect(compareHands(kings, aces)).toBeLessThan(0);
  });

  it('départage deux mains identiques par les cartes suivantes (kicker)', () => {
    const better = evaluateFive(['Ah', 'Ad', 'Ks', '7c', '2d'].map(parseCard));
    const worse = evaluateFive(['Ac', 'As', 'Qs', '7d', '2c'].map(parseCard));
    expect(compareHands(better, worse)).toBeGreaterThan(0);
    expect(compareHands(better, better)).toBe(0);
  });
});

describe('Pots principal et secondaires', () => {
  it('ouvre un pot par niveau de mise ; un joueur tapi ne gagne que les pots auxquels il a contribué', () => {
    // a a misé 100, b et c 50 chacun : pot principal de 150 pour les trois, pot secondaire de 50 pour a seul.
    const pots = buildPots({ a: 100, b: 50, c: 50 }, []);
    expect(pots).toEqual([
      { amount: 150, eligible: ['a', 'b', 'c'] },
      { amount: 50, eligible: ['a'] },
    ]);
  });

  it('exclut les joueurs couchés des ayants droit, sans perdre leur mise', () => {
    const pots = buildPots({ a: 40, b: 40, c: 40 }, ['c']);
    expect(pots).toEqual([{ amount: 120, eligible: ['a', 'b'] }]);
    expect(pots.reduce((sum, p) => sum + p.amount, 0)).toBe(120);
  });

  it('attribue chaque pot à la meilleure main de ses ayants droit', () => {
    const pots = buildPots({ a: 100, b: 50, c: 50 }, []);
    const values = {
      a: evaluateBest(['Ah', 'Ad', 'Ks', 'Kd', '2c']),
      b: evaluateBest(['Kc', 'Kh', '9s', '9d', '3c']),
      c: evaluateBest(['Qs', 'Qd', '7c', '5h', '2d']),
    };
    const result = resolvePots(pots, values, ['a', 'b', 'c']);
    expect(result.awards).toEqual({ a: 200 });
    expect(Object.values(result.awards).reduce((s, v) => s + v, 0)).toBe(200);
  });

  it('partage un pot entre ex æquo et garde la somme exacte', () => {
    const pots = buildPots({ a: 30, b: 30 }, []);
    const same = evaluateBest(['Ah', 'Kd', 'Qs', 'Jc', '3d']);
    const result = resolvePots(pots, { a: same, b: same }, ['a', 'b']);
    expect(result.awards.a! + result.awards.b!).toBe(60);
    expect(Math.abs(result.awards.a! - result.awards.b!)).toBeLessThanOrEqual(1);
  });
});
