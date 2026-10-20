import { gamesWon, newScore, other, addPoint, leaderOf, type BestOf, type TennisScore, type Who } from './score.js';
import type { MatchResult } from './tournament.js';

/**
 * Un match entre deux joueurs : celui du bas (0) et celui du haut (1). Deux manières de le jouer :
 * - règles simples : chacun a un nombre de vies ; une balle perdue en coûte une, et le dernier à en avoir gagne ;
 * - règles du tennis : le score réel (voir `score.ts`).
 *
 * Le temps limite un match : à la fin, celui qui mène gagne (vies puis touches, ou sets, jeux et points), et une
 * égalité parfaite est un nul. Fichier pur, comme `score.ts`.
 */

export type Rules = 'vies' | 'tennis';

interface DuelBase {
  /** Coups réussis par chaque joueur : une statistique, sans effet sur le résultat. */
  hits: [number, number];
  done: boolean;
  /** Vainqueur. Null tant que le match n’est pas fini, et en cas de nul. */
  winner: Who | null;
}

export interface LivesDuel extends DuelBase {
  rules: 'vies';
  /** Vies restantes de chaque joueur. */
  lives: [number, number];
}

export interface TennisDuel extends DuelBase {
  rules: 'tennis';
  score: TennisScore;
}

export type Duel = LivesDuel | TennisDuel;

/** Match neuf : chacun a `lives` vies (règles simples), ou le score part de zéro avec `first` au service. */
export function newDuel(rules: Rules, lives: number, bestOf: BestOf, first: Who): Duel {
  const base: DuelBase = { hits: [0, 0], done: false, winner: null };
  if (rules === 'tennis') return { ...base, rules: 'tennis', score: newScore(bestOf, first) };
  return { ...base, rules: 'vies', lives: [lives, lives] };
}

/** Un joueur réussit un coup : une statistique, rien de plus. */
export function hitBy(d: Duel, who: Who): Duel {
  if (d.done) return d;
  const hits: [number, number] = [d.hits[0], d.hits[1]];
  hits[who] += 1;
  return { ...d, hits };
}

/**
 * Une balle perdue par `loser`. Règles simples : il perd une vie, et le match finit à zéro. Règles du tennis : le
 * point revient à l’autre joueur.
 */
export function lostBall(d: Duel, loser: Who): Duel {
  if (d.done) return d;
  if (d.rules === 'vies') {
    const lives: [number, number] = [d.lives[0], d.lives[1]];
    lives[loser] = Math.max(0, lives[loser] - 1);
    if (lives[loser] === 0) return { ...d, lives, done: true, winner: other(loser) };
    return { ...d, lives };
  }
  const score = addPoint(d.score, other(loser));
  if (score.winner !== null) return { ...d, score, done: true, winner: score.winner };
  return { ...d, score };
}

function leadOf(values: [number, number]): Who | null {
  if (values[0] === values[1]) return null;
  return values[0] > values[1] ? 0 : 1;
}

/** Temps écoulé : celui qui mène gagne. Règles simples : vies, puis touches. Une égalité parfaite est un nul. */
export function expire(d: Duel): Duel {
  if (d.done) return d;
  if (d.rules === 'vies') {
    return { ...d, done: true, winner: leadOf(d.lives) ?? leadOf(d.hits) };
  }
  return { ...d, done: true, winner: leaderOf(d.score) };
}

/** Résultat du match, tel que le classement le lit (les manches et les points marqués, par joueur). */
export function resultOf(d: Duel, a: string, b: string): MatchResult {
  if (d.rules === 'vies') {
    return { a, b, winner: d.winner, wins: [d.lives[0], d.lives[1]], scored: [d.hits[0], d.hits[1]] };
  }
  const { setsWon } = d.score;
  return {
    a,
    b,
    winner: d.winner,
    wins: [setsWon[0], setsWon[1]],
    scored: [gamesWon(d.score, 0), gamesWon(d.score, 1)],
  };
}
