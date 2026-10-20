import { describe, expect, it } from 'vitest';
import {
  championOf,
  createTournament,
  isFinished,
  nextMatch,
  placings,
  recordMatch,
  seedOrder,
  standings,
  type MatchResult,
  type Tournament,
} from '../tennis/tournament.js';

/** Résultat d’un match : `winner` 0 ou 1, ou null pour une égalité. */
function result(a: string, b: string, winner: 0 | 1 | null, wins: [number, number] = [0, 0]): MatchResult {
  return { a, b, winner, wins, scored: [0, 0] };
}

/** Joue tous les matchs de la poule, dans l’ordre du programme, en donnant toujours la victoire au premier. */
function playPoule(t: Tournament, pick: (a: string, b: string) => 0 | 1 | null = () => 0): Tournament {
  let cur = t;
  for (let next = nextMatch(cur); next; next = nextMatch(cur)) {
    if (next.a === null || next.b === null) break;
    cur = recordMatch(cur, next.id, result(next.a, next.b, pick(next.a, next.b)));
  }
  return cur;
}

describe('poule', () => {
  it('fait jouer chaque paire une seule fois', () => {
    const ids = ['ana', 'bob', 'cléo', 'dan'];
    const t = createTournament('poule', ids);
    expect(t.matches).toHaveLength(6);
    const pairs = t.matches.map((m) => [m.a, m.b].sort().join('|')).sort();
    expect(new Set(pairs).size).toBe(6);
  });

  it('ne fait jouer qu’une fois un même joueur par manche', () => {
    const t = createTournament('poule', ['a', 'b', 'c', 'd', 'e', 'f']);
    const byRound = new Map<number, string[]>();
    for (const m of t.matches) {
      const players = byRound.get(m.round) ?? [];
      players.push(m.a ?? '', m.b ?? '');
      byRound.set(m.round, players);
    }
    for (const players of byRound.values()) {
      expect(new Set(players).size).toBe(players.length);
    }
    expect(t.matches).toHaveLength(15);
  });

  it('gère un nombre impair de joueurs : chacun joue contre tous les autres', () => {
    const ids = ['a', 'b', 'c'];
    const t = createTournament('poule', ids);
    expect(t.matches).toHaveLength(3);
    for (const id of ids) {
      const count = t.matches.filter((m) => m.a === id || m.b === id).length;
      expect(count).toBe(2);
    }
  });

  it('se termine quand tous les matchs ont un résultat', () => {
    const t = playPoule(createTournament('poule', ['a', 'b', 'c', 'd']));
    expect(isFinished(t)).toBe(true);
    expect(nextMatch(t)).toBeNull();
  });

  it('compte 3 points par victoire et 1 par nul', () => {
    const rows = standings(['a', 'b'], [result('a', 'b', null)]);
    expect(rows.map((r) => [r.id, r.points, r.drawn])).toEqual([
      ['a', 1, 1],
      ['b', 1, 1],
    ]);
  });

  it('classe par points, puis par manches, puis par jeux', () => {
    // a bat b et c ; b bat c. Trois victoires pour a, deux pour b, une pour c : a premier, b deuxième.
    const rows = standings(
      ['a', 'b', 'c'],
      [
        { a: 'a', b: 'b', winner: 0, wins: [2, 1], scored: [6, 4] },
        { a: 'a', b: 'c', winner: 0, wins: [2, 0], scored: [6, 1] },
        { a: 'b', b: 'c', winner: 0, wins: [2, 0], scored: [6, 2] },
      ],
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0]?.points).toBe(6);
  });

  it('donne le même rang aux joueurs à égalité parfaite', () => {
    const rows = standings(
      ['a', 'b', 'c'],
      [
        { a: 'a', b: 'b', winner: null, wins: [1, 1], scored: [4, 4] },
        { a: 'a', b: 'c', winner: null, wins: [1, 1], scored: [4, 4] },
        { a: 'b', b: 'c', winner: null, wins: [1, 1], scored: [4, 4] },
      ],
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it('classe la poule terminée', () => {
    // Le joueur du bas gagne toujours : cléo gagne deux fois, ana une fois, bob jamais.
    const t = playPoule(createTournament('poule', ['ana', 'bob', 'cléo']));
    expect(placings(t)).toEqual([
      { id: 'cléo', rank: 1 },
      { id: 'ana', rank: 2 },
      { id: 'bob', rank: 3 },
    ]);
  });
});

describe('élimination directe', () => {
  it('place deux joueurs en finale directe', () => {
    const t = createTournament('eliminatoire', ['ana', 'bob']);
    expect(t.matches).toHaveLength(1);
    expect(nextMatch(t)?.a).toBe('ana');
    const done = recordMatch(t, 'r0m0', result('ana', 'bob', 1));
    expect(championOf(done)).toBe('bob');
    expect(isFinished(done)).toBe(true);
  });

  it('suit l’ordre des graines : 1 contre 4 et 2 contre 3 pour quatre joueurs', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    const t = createTournament('eliminatoire', ['p1', 'p2', 'p3', 'p4']);
    expect(t.matches.map((m) => [m.a, m.b])).toEqual([
      ['p1', 'p4'],
      ['p2', 'p3'],
      [null, null],
    ]);
  });

  it('donne les exemptions aux premières graines quand le nombre n’est pas une puissance de deux', () => {
    const t = createTournament('eliminatoire', ['s1', 's2', 's3', 's4', 's5']);
    const byes = t.matches.filter((m) => m.bye);
    expect(byes.map((m) => m.winner)).toEqual(['s1', 's2', 's3']);
    // La seule rencontre du premier tour oppose les deux dernières graines.
    const first = t.matches.filter((m) => m.round === 0 && !m.bye);
    expect(first.map((m) => [m.a, m.b])).toEqual([['s4', 's5']]);
    // Les exemptés attendent au tour suivant, et jouent dès qu’ils ont un adversaire.
    expect(t.matches.find((m) => m.id === 'r1m0')).toMatchObject({ a: 's1', b: null });
    expect(t.matches.find((m) => m.id === 'r1m1')).toMatchObject({ a: 's2', b: 's3' });
  });

  it('fait avancer les vainqueurs jusqu’au champion', () => {
    let t = createTournament('eliminatoire', ['a', 'b', 'c', 'd']);
    t = recordMatch(t, 'r0m0', result('a', 'd', 0));
    t = recordMatch(t, 'r0m1', result('b', 'c', 1));
    expect(nextMatch(t)?.id).toBe('r1m0');
    expect(t.matches.find((m) => m.id === 'r1m0')).toMatchObject({ a: 'a', b: 'c' });
    t = recordMatch(t, 'r1m0', result('a', 'c', 1));
    expect(championOf(t)).toBe('c');
    const rank = placings(t);
    expect(rank).toEqual([
      { id: 'c', rank: 1 },
      { id: 'a', rank: 2 },
      { id: 'b', rank: 3 },
      { id: 'd', rank: 3 },
    ]);
  });

  it('rejoue un match sans vainqueur', () => {
    const t = createTournament('eliminatoire', ['a', 'b']);
    const draw = recordMatch(t, 'r0m0', result('a', 'b', null));
    expect(isFinished(draw)).toBe(false);
    expect(nextMatch(draw)?.id).toBe('r0m0');
    expect(championOf(recordMatch(draw, 'r0m0', result('a', 'b', 0)))).toBe('a');
  });

  it('ne peut pas être terminé tant que la finale n’est pas jouée', () => {
    let t = createTournament('eliminatoire', ['a', 'b', 'c', 'd']);
    t = recordMatch(t, 'r0m0', result('a', 'd', 0));
    expect(isFinished(t)).toBe(false);
    expect(championOf(t)).toBeNull();
  });
});
