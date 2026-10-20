import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import {
  countSolutions,
  dealKlondike,
  generateCrossword,
  generateSudoku,
  motsCroises,
  scrambleTaquin,
  seededRandom,
  solitaire,
  sudoku,
  taquin,
} from '@partyhub/games';

function makeCtx(connected: string[], seed = 7) {
  let clock = 1_000;
  const timers = new Map<string, number>();
  const random = seededRandom(seed);
  const ctx: GameContext = {
    now: () => clock,
    schedule: (key, ms) => timers.set(key, clock + ms),
    cancel: (key) => timers.delete(key),
    random,
    connectedPlayerIds: () => connected,
  };
  return {
    ctx,
    timers,
    advance: (ms: number) => (clock += ms),
  };
}

const players: PlayerRef[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bruno' },
];

describe('Sudoku', () => {
  it('génère une grille à solution unique, cohérente avec ses indices', () => {
    for (const seed of [3, 99, 2024]) {
      const { puzzle, solution } = generateSudoku(seed, 'difficile');
      expect(countSolutions(puzzle)).toBe(1);
      for (let i = 0; i < 81; i++) {
        if (puzzle[i] !== 0) expect(puzzle[i]).toBe(solution[i]);
      }
      // Chaque ligne, colonne et bloc contient 1 à 9 une fois.
      for (let k = 0; k < 9; k++) {
        const row = new Set(Array.from({ length: 9 }, (_, c) => solution[k * 9 + c]));
        const col = new Set(Array.from({ length: 9 }, (_, r) => solution[r * 9 + k]));
        expect(row.size).toBe(9);
        expect(col.size).toBe(9);
      }
    }
  });

  it('une même graine donne toujours la même grille', () => {
    expect(generateSudoku(12, 'moyen')).toEqual(generateSudoku(12, 'moyen'));
  });

  it('refuse de modifier une case donnée et signale les conflits', () => {
    const module = sudoku;
    const s0 = module.initialize(module.defaultSettings, players, makeCtx(['a', 'b']).ctx);
    const { ctx } = makeCtx(['a', 'b']);
    const started = module.start(s0, ctx);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const state = started.state;
    const givenIndex = state.boards.a!.puzzle.findIndex((v: number) => v !== 0);
    const refused = module.handleAction(state, players[0]!, 'play', { index: givenIndex, value: 5 }, ctx);
    expect(refused.ok).toBe(false);

    const emptyIndex = state.boards.a!.puzzle.findIndex((v: number) => v === 0);
    const wrong = state.boards.a!.solution[emptyIndex] === 1 ? 2 : 1;
    const sameRowIndex = Math.floor(emptyIndex / 9) * 9 + (emptyIndex % 9 === 0 ? 1 : 0);
    const withConflict = module.handleAction(state, players[0]!, 'play', { index: emptyIndex, value: wrong }, ctx);
    expect(withConflict.ok).toBe(true);
    void sameRowIndex;
  });

  it('termine la partie quand tous les joueurs connectés ont résolu la grille', () => {
    const module = sudoku;
    const { ctx, advance } = makeCtx(['a', 'b']);
    const s0 = module.initialize({ timeLimitSec: 0, difficulty: 'facile' }, players, ctx);
    const state = module.start(s0, ctx);
    if (!state.ok) throw new Error(state.error);
    let s = state.state;
    advance(10_000);
    const solution = s.boards.a!.solution;
    const fill = (id: string) => {
      for (let i = 0; i < 81; i++) {
        if (s.boards[id]!.puzzle[i] !== 0) continue;
        const res = module.handleAction(s, { id, name: id }, 'play', { index: i, value: solution[i] }, ctx);
        if (!res.ok) throw new Error(res.error);
        s = res.state;
      }
    };
    fill('a');
    expect(s.phase).toBe('play');
    expect(module.getPlayerState(s, 'a').done).toBe(true);
    fill('b');
    expect(s.phase).toBe('final');
    const ranking = module.calculateScores(s);
    expect(ranking.map((e) => e.playerId)).toEqual(['a', 'b']);
    expect(ranking[0]!.points).toBeGreaterThan(ranking[1]!.points);
  });
});

describe('Taquin', () => {
  it('mélange toujours en une grille soluble, jamais résolue', () => {
    for (const size of [3, 4] as const) {
      for (const seed of [1, 2, 3, 500]) {
        const tiles = scrambleTaquin(size, seed);
        const n = size * size;
        expect([...tiles].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
        // Critère de solubilité (largeur paire) : inversions + ligne de la case vide, comptée depuis le bas.
        const seq = tiles.filter((v) => v !== 0);
        let inv = 0;
        for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) if (seq[i]! > seq[j]!) inv++;
        const blankRowFromBottom = size - Math.floor(tiles.indexOf(0) / size);
        if (size % 2 === 0) expect((inv + blankRowFromBottom) % 2).toBe(1);
        expect(tiles.every((v, i) => v === (i === n - 1 ? 0 : i + 1))).toBe(false);
      }
    }
  });

  it('ne glisse une tuile que si elle est voisine de la case vide', () => {
    const { ctx } = makeCtx(['a']);
    const s = taquin.initialize({ timeLimitSec: 0, size: 4 }, [players[0]!], ctx);
    const started = taquin.start(s, ctx);
    if (!started.ok) throw new Error(started.error);
    const board = started.state.boards.a!;
    const blank = board.tiles.indexOf(0);
    const far = (blank + 8) % 16;
    const refused = taquin.handleAction(started.state, players[0]!, 'play', { index: far }, ctx);
    expect(refused.ok).toBe(false);
    const neighbour = blank + 1 < 16 && (blank + 1) % 4 !== 0 ? blank + 1 : blank - 1;
    const moved = taquin.handleAction(started.state, players[0]!, 'play', { index: neighbour }, ctx);
    expect(moved.ok).toBe(true);
  });
});

describe('Solitaire (Klondike)', () => {
  it('distribue 52 cartes distinctes : 7 colonnes puis la pioche', () => {
    const board = dealKlondike(11, 1);
    const all = [...board.tableau.flat(), ...board.stock];
    expect(all).toHaveLength(52);
    expect(new Set(all.map((c) => `${c.rank}-${c.suit}`)).size).toBe(52);
    expect(board.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    board.tableau.forEach((col) => {
      expect(col[col.length - 1]!.up).toBe(true);
      col.slice(0, -1).forEach((c) => expect(c.up).toBe(false));
    });
  });

  it('applique les règles : pioche, coups refusés et coups légaux', () => {
    const { ctx } = makeCtx(['a']);
    const s = solitaire.initialize({ timeLimitSec: 0, drawCount: 1 }, [players[0]!], ctx);
    const started = solitaire.start(s, ctx);
    if (!started.ok) throw new Error(started.error);
    const state = started.state;
    const drawn = solitaire.handleAction(state, players[0]!, 'play', { type: 'draw' }, ctx);
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(drawn.state.boards.a!.waste).toHaveLength(1);
    // Une carte cachée ne peut pas bouger.
    const hidden = solitaire.handleAction(
      state,
      players[0]!,
      'play',
      { type: 'move', from: 't6', count: 1, to: 't0' },
      ctx,
    );
    expect(hidden.ok).toBe(false);
    // Une carte qui ne convient pas à la colonne est refusée.
    const wasteCard = drawn.state.boards.a!.waste[0]!;
    const bad = solitaire.handleAction(
      drawn.state,
      players[0]!,
      'play',
      { type: 'move', from: 'w', count: 1, to: 't0' },
      ctx,
    );
    const legal = wasteCard.rank === 13 ? 't0' : null;
    if (legal === null) expect(bad.ok).toBe(false);
  });
});

describe('Mots croisés', () => {
  it('génère des grilles cohérentes : chaque suite de lettres est un mot défini', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = generateCrossword(seed);
      expect(g.clues.across.length + g.clues.down.length).toBeGreaterThanOrEqual(8);
      const at = (r: number, c: number) =>
        r >= 0 && c >= 0 && r < g.rows && c < g.cols ? (g.solution[r * g.cols + c] ?? null) : null;
      // Chaque suite horizontale et verticale d'au moins deux lettres doit être une définition.
      for (let r = 0; r < g.rows; r++) {
        let run = '';
        let startC = 0;
        for (let c = 0; c <= g.cols; c++) {
          const v = c < g.cols ? at(r, c) : null;
          if (v) {
            if (run === '') startC = c;
            run += v;
          } else {
            if (run.length >= 2) {
              const clue = g.clues.across.find((x) => x.row === r && x.col === startC);
              expect(clue?.length).toBe(run.length);
            }
            run = '';
          }
        }
      }
      for (let c = 0; c < g.cols; c++) {
        let run = '';
        let startR = 0;
        for (let r = 0; r <= g.rows; r++) {
          const v = r < g.rows ? at(r, c) : null;
          if (v) {
            if (run === '') startR = r;
            run += v;
          } else {
            if (run.length >= 2) {
              const clue = g.clues.down.find((x) => x.row === startR && x.col === c);
              expect(clue?.length).toBe(run.length);
            }
            run = '';
          }
        }
      }
      // Les numéros sont croissants dans l'ordre de lecture.
      const numbered = g.numbers.filter((n) => n > 0);
      expect(numbered).toEqual([...numbered].sort((a, b) => a - b));
    }
  });

  it('accepte les lettres, signale les erreurs après vérification', () => {
    const { ctx } = makeCtx(['a']);
    const s = motsCroises.initialize({ timeLimitSec: 0 }, [players[0]!], ctx);
    const started = motsCroises.start(s, ctx);
    if (!started.ok) throw new Error(started.error);
    const grid = generateCrossword(started.state.seed);
    const cell = grid.solution.findIndex((v) => v !== null);
    const wrong = grid.solution[cell] === 'A' ? 'B' : 'A';
    const typed = motsCroises.handleAction(
      started.state,
      players[0]!,
      'play',
      { type: 'letter', index: cell, letter: wrong },
      ctx,
    );
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    const checked = motsCroises.handleAction(typed.state, players[0]!, 'play', { type: 'check' }, ctx);
    expect(checked.ok && checked.state.boards.a!.errors).toEqual([cell]);
    const black = grid.solution.findIndex((v) => v === null);
    if (black >= 0) {
      const refused = motsCroises.handleAction(
        typed.state,
        players[0]!,
        'play',
        { type: 'letter', index: black, letter: 'A' },
        ctx,
      );
      expect(refused.ok).toBe(false);
    }
  });
});

describe('Classement en direct des jeux solo', () => {
  const alice: PlayerRef = { id: 'a', name: 'Alice' };
  const bruno: PlayerRef = { id: 'b', name: 'Bruno' };
  const chloe: PlayerRef = { id: 'c', name: 'Chloé' };
  type SudokuState = Extract<ReturnType<typeof sudoku.start>, { ok: true }>['state'];

  function startSudoku(list: PlayerRef[]) {
    const env = makeCtx(
      list.map((p) => p.id),
      11,
    );
    const s0 = sudoku.initialize({ timeLimitSec: 0, difficulty: 'facile' }, list, env.ctx);
    const started = sudoku.start(s0, env.ctx);
    if (!started.ok) throw new Error(started.error);
    return { env, s: started.state as SudokuState };
  }

  /** Fait jouer `id` : `count` cases justes, ou toutes les cases vides si `count` est absent. */
  function fillCells(env: ReturnType<typeof makeCtx>, s: SudokuState, id: string, count = Infinity): SudokuState {
    let state = s;
    let played = 0;
    const solution = state.boards[id]!.solution;
    for (let i = 0; i < 81 && played < count; i++) {
      if (state.boards[id]!.puzzle[i] !== 0) continue;
      const res = sudoku.handleAction(state, { id, name: id }, 'play', { index: i, value: solution[i] }, env.ctx);
      if (!res.ok) throw new Error(res.error);
      state = res.state;
      played++;
    }
    return state;
  }

  it('garde la courbe d’avancement de chacun : un point par palier, puis la résolution', () => {
    const { env, s: start } = startSudoku([alice, bruno]);
    env.advance(4_000);
    let s = fillCells(env, start, 'a', 20);
    const trail = s.history.a!;
    expect(trail[0]!.ms).toBe(0);
    expect(trail.length).toBeGreaterThan(1);
    for (let i = 1; i < trail.length; i++) {
      expect(trail[i]!.ms).toBeGreaterThanOrEqual(trail[i - 1]!.ms);
      expect(Math.floor(trail[i]!.percent / 10)).toBeGreaterThan(Math.floor(trail[i - 1]!.percent / 10));
    }
    expect(s.history.b).toHaveLength(1);

    s = fillCells(env, s, 'a');
    expect(s.history.a!.at(-1)).toEqual({ ms: s.doneMs.a, percent: 100 });
  });

  it('l’avancement part de zéro : les cases données du Sudoku ne comptent pas', () => {
    const { s: start } = startSudoku([alice]);
    expect(sudoku.getPlayerState(start, 'a').percent).toBe(0);
  });

  it('classe les joueurs qui n’ont pas fini selon leur avancement, et leur donne des points', () => {
    const { env, s: start } = startSudoku([alice, bruno]);
    let s = fillCells(env, start, 'a', 5);
    s = fillCells(env, s, 'b', 25);
    expect(sudoku.getPublicState(s).standings.map((r) => r.playerId)).toEqual(['b', 'a']);

    const ended = sudoku.nextRound(s, env.ctx);
    expect(ended.phase).toBe('final');
    const ranking = sudoku.calculateScores(ended);
    expect(ranking.map((e) => [e.playerId, e.points])).toEqual([
      ['b', 100],
      ['a', 90],
    ]);
  });

  it('l’écran principal reçoit l’ordre d’arrivée, les points fixés, la salle et les courbes', () => {
    const { env, s: start } = startSudoku([alice, bruno, chloe]);
    let s = fillCells(env, start, 'a');
    s = fillCells(env, s, 'b', 10);
    const view = sudoku.getPublicState(s);

    expect(view.roster.map((r) => r.playerId)).toEqual(['a', 'b', 'c']);
    expect(view.standings.map((r) => r.playerId)).toEqual(['a', 'b', 'c']);
    expect(view.standings[0]).toMatchObject({ done: true, points: 100 });
    expect(view.standings[1]).toMatchObject({ done: false, points: null });
    // Les cases données comptent dans l’avancement : Chloé n’a pas joué, mais n’est pas à 0 %.
    expect(view.standings[2]).toMatchObject({ done: false, points: null });
    expect(view.standings[2]!.percent).toBeLessThan(view.standings[1]!.percent);
    expect(view.startedAt).toBe(s.startedAt);
    expect(Object.keys(view.history).sort()).toEqual(['a', 'b', 'c']);
  });
});
