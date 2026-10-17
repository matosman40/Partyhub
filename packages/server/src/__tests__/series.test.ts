import { describe, expect, it } from 'vitest';
import type { ScoreEntry } from '@partyhub/shared';
import {
  assignTeams,
  createSeries,
  pointsForRank,
  recordGame,
  seriesFinished,
  seriesView,
  tierFor,
} from '../rooms/series.js';

/**
 * Championnat d'un salon, logique pure : points selon le rang, rangs de progression, équipes équilibrées,
 * icônes de victoire et vainqueur (ex æquo compris).
 */

const NAMES: Record<string, string> = { a: 'Ana', b: 'Bruno', c: 'Chloé', d: 'Dan' };

/** Classement en compétition à partir des points marqués : deux ex æquo partagent le rang. */
function scores(points: Record<string, number>): ScoreEntry[] {
  const ids = Object.keys(points);
  return ids.map((id) => ({
    playerId: id,
    name: NAMES[id]!,
    points: points[id]!,
    rank: 1 + ids.filter((other) => points[other]! > points[id]!).length,
  }));
}

describe('points et rangs de progression', () => {
  it('donne 10, 6, 4, 3, 2 puis 1 point selon le rang', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(pointsForRank)).toEqual([10, 6, 4, 3, 2, 1, 1]);
    expect(pointsForRank(0)).toBe(0);
  });

  it('place chaque joueur dans le bon rang de progression', () => {
    expect(tierFor(0).label).toBe('Recrue');
    expect(tierFor(9).label).toBe('Recrue');
    expect(tierFor(10).label).toBe('Habitué');
    expect(tierFor(25).label).toBe('Confirmé');
    expect(tierFor(49).label).toBe('Confirmé');
    expect(tierFor(50).label).toBe('Expert');
    expect(tierFor(100).label).toBe('Légende');
    expect(tierFor(900).label).toBe('Légende');
  });
});

describe('équipes', () => {
  it('répartit deux équipes à effectif égal', () => {
    expect(assignTeams(['a', 'b', 'c', 'd'], 2, {})).toEqual({ a: 0, b: 1, c: 0, d: 1 });
  });

  it("garde l'équipe d'un joueur déjà présent et envoie le nouveau dans l'équipe la moins fournie", () => {
    expect(assignTeams(['a', 'b', 'c', 'd'], 2, { a: 1, c: 0 })).toEqual({ a: 1, b: 0, c: 0, d: 1 });
  });

  it('retire un joueur absent de la répartition', () => {
    expect(assignTeams(['a'], 2, { a: 0, b: 1 })).toEqual({ a: 0 });
  });

  it('ne fait pas d’équipes sous deux', () => {
    expect(assignTeams(['a', 'b'], 0, {})).toEqual({});
    expect(assignTeams(['a', 'b'], 1, {})).toEqual({});
  });

  it('répartit trois équipes au plus équilibré possible', () => {
    expect(assignTeams(['a', 'b', 'c', 'd', 'e'], 3, {})).toEqual({ a: 0, b: 1, c: 2, d: 0, e: 1 });
  });
});

describe('championnat individuel', () => {
  it('cumule les points, les victoires, les séries et les icônes', () => {
    const s = createSeries(3, 0);
    recordGame(s, 'Jeu 1', scores({ a: 5, b: 5, c: 1, d: 0 })); // a, b : 1er ex æquo ; c 3e ; d 4e
    recordGame(s, 'Jeu 2', scores({ a: 9, b: 2, c: 3, d: 0 })); // a 1er ; c 2e ; b 3e ; d 4e
    expect(seriesFinished(s)).toBe(false);

    const view = seriesView(s);
    expect(view.played).toBe(2);
    expect(view.finished).toBe(false);
    expect(view.champion).toBeNull();
    expect(view.standings.map((r) => [r.name, r.points, r.rank])).toEqual([
      ['Ana', 20, 1],
      ['Bruno', 14, 2],
      ['Chloé', 10, 3],
      ['Dan', 6, 4],
    ]);

    const ana = view.standings[0]!;
    expect(ana.tier.label).toBe('Habitué');
    expect(ana.badges.map((b) => b.id)).toEqual(['serie', 'invaincu', 'regulier']);
    expect(view.standings[3]!.tier.label).toBe('Recrue');
    expect(view.standings[3]!.badges).toEqual([]);
  });

  it('désigne le vainqueur à la dernière manche et lui donne l’icône de champion', () => {
    const s = createSeries(3, 0);
    recordGame(s, 'Jeu 1', scores({ a: 5, b: 5, c: 1, d: 0 }));
    recordGame(s, 'Jeu 2', scores({ a: 9, b: 2, c: 3, d: 0 }));
    recordGame(s, 'Jeu 3', scores({ a: 0, b: 9, c: 1, d: 2 }));
    expect(seriesFinished(s)).toBe(true);

    const view = seriesView(s);
    expect(view.finished).toBe(true);
    expect(view.champion).toEqual({ names: ['Bruno'], team: null });
    const bruno = view.standings.find((r) => r.name === 'Bruno')!;
    expect(bruno.rank).toBe(1);
    expect(bruno.badges.map((b) => b.id)).toContain('champion');
    expect(bruno.badges.map((b) => b.id)).toContain('regulier');
    expect(bruno.badges.map((b) => b.id)).not.toContain('invaincu');
  });

  it('partage le titre entre ex æquo', () => {
    const s = createSeries(1, 0);
    recordGame(s, 'Seul', scores({ a: 5, b: 5 }));
    const view = seriesView(s);
    expect(view.champion).toEqual({ names: ['Ana', 'Bruno'], team: null });
    expect(view.standings.every((r) => r.badges.some((b) => b.id === 'champion'))).toBe(true);
  });

  it('garde l’historique des manches avec leurs vainqueurs', () => {
    const s = createSeries(2, 0);
    recordGame(s, 'Quiz', scores({ a: 3, b: 1 }));
    recordGame(s, 'Réflexe', scores({ a: 1, b: 4 }));
    expect(seriesView(s).history).toEqual([
      { index: 1, game: 'Quiz', winners: ['Ana'] },
      { index: 2, game: 'Réflexe', winners: ['Bruno'] },
    ]);
  });
});

describe('championnat par équipes', () => {
  it('classe les équipes sur la somme de leurs membres et donne le titre à l’équipe gagnante', () => {
    const s = createSeries(1, 2);
    s.teams = assignTeams(['a', 'b', 'c', 'd'], 2, {}); // Ana et Chloé : Rouge ; Bruno et Dan : Bleue
    recordGame(s, 'Jeu', scores({ a: 9, b: 7, c: 5, d: 1 })); // Rouge : 10 + 4 ; Bleue : 6 + 3

    const view = seriesView(s);
    expect(view.teams?.map((t) => [t.name, t.points, t.rank, t.members])).toEqual([
      ['Rouge', 14, 1, ['Ana', 'Chloé']],
      ['Bleue', 9, 2, ['Bruno', 'Dan']],
    ]);
    expect(view.champion).toEqual({ names: ['Rouge'], team: 0 });
    const ana = view.standings.find((r) => r.name === 'Ana')!;
    const bruno = view.standings.find((r) => r.name === 'Bruno')!;
    expect(ana.team).toBe(0);
    expect(ana.badges.map((b) => b.id)).toContain('champion');
    expect(bruno.badges.map((b) => b.id)).not.toContain('champion');
  });

  it('partage le titre quand deux équipes sont à égalité', () => {
    const s = createSeries(1, 2);
    s.teams = assignTeams(['a', 'b', 'c', 'd'], 2, {});
    recordGame(s, 'Jeu', scores({ a: 9, b: 9, c: 1, d: 1 })); // Rouge : 10 + 4 ; Bleue : 10 + 4
    expect(seriesView(s).champion).toEqual({ names: ['Rouge', 'Bleue'], team: null });
  });

  it('ne renvoie pas d’équipes sans équipes', () => {
    const s = createSeries(1, 0);
    recordGame(s, 'Jeu', scores({ a: 2, b: 1 }));
    expect(seriesView(s).teams).toBeNull();
    expect(seriesView(s).standings.every((r) => r.team === null)).toBe(true);
  });
});
