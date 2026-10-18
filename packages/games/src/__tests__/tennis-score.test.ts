import { describe, expect, it } from 'vitest';
import {
  addPoint,
  gamesLabel,
  gamesWon,
  isDeuce,
  leaderOf,
  newScore,
  other,
  pointLabels,
  tiebreakServer,
  type TennisScore,
  type Who,
} from '../tennis/score.js';

/** Joue une suite de points (0 ou 1) à partir d’un score. */
function play(s: TennisScore, points: Who[]): TennisScore {
  return points.reduce((acc, who) => addPoint(acc, who), s);
}

/** Répète un joueur `n` fois : `n` points d’affilée. */
function run(who: Who, n: number): Who[] {
  return Array.from({ length: n }, () => who);
}

describe('jeu', () => {
  it('compte 0, 15, 30, 40 puis gagne le jeu', () => {
    let s = newScore();
    expect(pointLabels(s)).toEqual(['0', '0']);
    s = addPoint(s, 0);
    expect(pointLabels(s)).toEqual(['15', '0']);
    s = addPoint(s, 0);
    expect(pointLabels(s)).toEqual(['30', '0']);
    s = addPoint(s, 0);
    expect(pointLabels(s)).toEqual(['40', '0']);
    s = addPoint(s, 0);
    expect(s.games).toEqual([[1, 0]]);
    expect(s.points).toEqual([0, 0]);
  });

  it('passe par l’égalité puis l’avantage, et revient à l’égalité si l’avantage est perdu', () => {
    let s = play(newScore(), [0, 1, 0, 1, 0, 1]);
    expect(pointLabels(s)).toEqual(['40', '40']);
    expect(isDeuce(s)).toBe(true);
    s = addPoint(s, 0);
    expect(pointLabels(s)).toEqual(['Avantage', '40']);
    expect(isDeuce(s)).toBe(false);
    s = addPoint(s, 1);
    expect(pointLabels(s)).toEqual(['40', '40']);
    s = addPoint(s, 1);
    expect(pointLabels(s)).toEqual(['40', 'Avantage']);
    s = addPoint(s, 1);
    expect(s.games).toEqual([[0, 1]]);
  });

  it('exige deux points d’avance après l’égalité', () => {
    const s = play(newScore(), [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(s.games).toEqual([[0, 0]]);
    expect(pointLabels(s)).toEqual(['40', '40']);
  });
});

describe('service', () => {
  it('change de joueur à chaque jeu', () => {
    let s = newScore(1, 0);
    expect(s.server).toBe(0);
    s = play(s, run(0, 4));
    expect(s.server).toBe(1);
    s = play(s, run(1, 4));
    expect(s.server).toBe(0);
  });

  it('suit l’ordre du tie-break : un service, puis deux chacun', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => tiebreakServer(0, n))).toEqual([0, 1, 1, 0, 0, 1]);
    expect([0, 1, 2, 3].map((n) => tiebreakServer(1, n))).toEqual([1, 0, 0, 1]);
  });
});

describe('set', () => {
  it('se gagne à 6 jeux avec deux d’écart', () => {
    // Le joueur 0 gagne six jeux d’affilée : 6-0.
    const s = play(newScore(), run(0, 24));
    expect(s.setsWon).toEqual([1, 0]);
    expect(s.winner).toBe(0);
  });

  it('ne se gagne pas à 6-5 : il faut 7-5', () => {
    let s = newScore(3);
    // 5-5 : une série de jeux alternés, sans rien gagner de plus.
    const alternate: Who[] = [];
    for (let k = 0; k < 10; k++) alternate.push(...run((k % 2) as Who, 4));
    s = play(s, alternate);
    expect(gamesLabel(s)).toBe('5-5');
    s = play(s, run(0, 4));
    expect(gamesLabel(s)).toBe('6-5');
    expect(s.setsWon).toEqual([0, 0]);
    s = play(s, run(0, 4));
    expect(s.setsWon).toEqual([1, 0]);
    expect(gamesLabel(s)).toBe('7-5 0-0');
  });

  it('ouvre un tie-break à 6 jeux partout', () => {
    let s = newScore();
    const alternate: Who[] = [];
    for (let k = 0; k < 12; k++) alternate.push(...run((k % 2) as Who, 4));
    s = play(s, alternate);
    expect(gamesLabel(s)).toBe('6-6');
    expect(s.tiebreak).toBe(true);
    expect(pointLabels(s)).toEqual(['0', '0']);
  });
});

describe('tie-break', () => {
  /** Score au tie-break, après 6-6 dans un set d’un match en un set. */
  function tiebreakScore(): TennisScore {
    const alternate: Who[] = [];
    for (let k = 0; k < 12; k++) alternate.push(...run((k % 2) as Who, 4));
    return play(newScore(1, 0), alternate);
  }

  it('se gagne à 7 points avec deux d’écart, et donne le set 7-6', () => {
    let s = tiebreakScore();
    s = play(s, run(0, 7));
    expect(s.winner).toBe(0);
    expect(gamesLabel(s)).toBe('7-6');
  });

  it('continue au-delà de 7-6 tant que l’écart n’est pas de deux', () => {
    let s = tiebreakScore();
    s = play(s, [0, 1, 0, 1, 0, 1]); // 3-3
    s = play(s, [1, 0, 1, 0, 1, 0]); // 6-6
    expect(s.tiebreak).toBe(true);
    s = addPoint(s, 0); // 7-6
    expect(s.winner).toBeNull();
    s = addPoint(s, 0); // 8-6
    expect(s.winner).toBe(0);
  });

  it('change le service après chaque deux points, à partir du premier', () => {
    const first = tiebreakScore().server;
    let s = tiebreakScore();
    const seen: Who[] = [];
    for (let k = 0; k < 4; k++) {
      seen.push(s.server);
      s = addPoint(s, 0);
    }
    expect(seen).toEqual([first, other(first), other(first), first]);
  });

  it('donne le service du set suivant au joueur qui n’a pas servi en premier le tie-break', () => {
    let s = tiebreakScore();
    const first = s.tiebreakFirst;
    // Match en trois sets : le tie-break ferme le premier set, le suivant ne se termine pas.
    s = { ...s, bestOf: 3 };
    s = play(s, run(0, 7));
    expect(s.setsWon).toEqual([1, 0]);
    expect(s.winner).toBeNull();
    expect(s.server).toBe(other(first));
    expect(s.games.length).toBe(2);
  });
});

describe('match', () => {
  it('se gagne au meilleur de trois sets', () => {
    let s = newScore(3);
    s = play(s, run(0, 24)); // set 1 : 6-0
    expect(s.setsWon).toEqual([1, 0]);
    s = play(s, run(1, 24)); // set 2 : 0-6
    expect(s.setsWon).toEqual([1, 1]);
    expect(s.winner).toBeNull();
    s = play(s, run(0, 24)); // set 3 : 6-0
    expect(s.setsWon).toEqual([2, 1]);
    expect(s.winner).toBe(0);
  });

  it('ignore les points une fois le match fini', () => {
    const done = play(newScore(1), run(1, 24));
    expect(done.winner).toBe(1);
    expect(addPoint(done, 0)).toBe(done);
  });

  it('compte les jeux gagnés sur tous les sets', () => {
    let s = newScore(3);
    s = play(s, run(0, 24));
    s = play(s, run(0, 4));
    expect(gamesWon(s, 0)).toBe(7);
    expect(gamesWon(s, 1)).toBe(0);
  });
});

describe('temps écoulé', () => {
  it('donne le match au joueur en tête par les sets, puis les jeux, puis les points', () => {
    expect(leaderOf(newScore())).toBeNull();
    expect(leaderOf(play(newScore(), [0]))).toBe(0);
    expect(leaderOf(play(newScore(), [1, 1]))).toBe(1);
    // Même nombre de jeux, mais le joueur 1 a plus de points dans le jeu en cours.
    const s = play(newScore(), [...run(0, 4), ...run(1, 4), 1, 1, 0]);
    expect(gamesLabel(s)).toBe('1-1');
    expect(s.points).toEqual([1, 2]);
    expect(leaderOf(s)).toBe(1);
  });
});
