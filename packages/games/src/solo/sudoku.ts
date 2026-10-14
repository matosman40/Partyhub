import { z } from 'zod';
import type { GameResult } from '@partyhub/shared';
import { seededRandom, shuffleWith } from './rng.js';
import type { SoloEngine } from './engine.js';

/**
 * Sudoku 9×9. La grille complète est tirée depuis la graine, puis des cases sont retirées
 * tant que la solution reste unique : chaque grille a une seule solution, et la vérification
 * se fait sur le serveur contre cette solution.
 */

export const DIFFICULTY = ['facile', 'moyen', 'difficile'] as const;
export type Difficulty = (typeof DIFFICULTY)[number];

/** Nombre d'indices (cases données au départ) selon la difficulté. */
const GIVENS: Record<Difficulty, number> = { facile: 40, moyen: 32, difficile: 26 };

export interface SudokuBoard {
  puzzle: number[];
  solution: number[];
  /** Valeurs saisies par le joueur (0 = vide). Les indices restent fixes. */
  grid: number[];
  /** Cases dont la valeur est en conflit avec une autre case de même ligne, colonne ou bloc. */
  conflicts: number[];
}

const cache = new Map<string, { puzzle: number[]; solution: number[] }>();
const CACHE_LIMIT = 64;

function peers(i: number): number[] {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  const out = new Set<number>();
  for (let k = 0; k < 9; k++) {
    out.add(r * 9 + k);
    out.add(k * 9 + c);
    out.add((br + Math.floor(k / 3)) * 9 + bc + (k % 3));
  }
  out.delete(i);
  return [...out];
}

const PEERS = Array.from({ length: 81 }, (_, i) => peers(i));

function canPlace(grid: number[], i: number, v: number): boolean {
  return PEERS[i]!.every((j) => grid[j] !== v);
}

/** Nombre de solutions, arrêté à `limit` (suffit pour vérifier l'unicité). */
export function countSolutions(grid: number[], limit = 2): number {
  const g = [...grid];
  let found = 0;
  const search = (): void => {
    if (found >= limit) return;
    let best = -1;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i] !== 0) continue;
      let count = 0;
      for (let v = 1; v <= 9; v++) if (canPlace(g, i, v)) count++;
      if (count < bestCount) {
        best = i;
        bestCount = count;
        if (count === 0) break;
      }
    }
    if (best === -1) {
      found++;
      return;
    }
    for (let v = 1; v <= 9; v++) {
      if (!canPlace(g, best, v)) continue;
      g[best] = v;
      search();
      g[best] = 0;
      if (found >= limit) return;
    }
  };
  search();
  return found;
}

/** Remplit une grille complète, chiffres dans un ordre aléatoire à chaque case. */
function fullGrid(random: () => number): number[] {
  const g = new Array<number>(81).fill(0);
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    if (g[i] !== 0) return fill(i + 1);
    for (const v of shuffleWith([1, 2, 3, 4, 5, 6, 7, 8, 9], random)) {
      if (!canPlace(g, i, v)) continue;
      g[i] = v;
      if (fill(i + 1)) return true;
      g[i] = 0;
    }
    return false;
  };
  fill(0);
  return g;
}

export function generateSudoku(seed: number, difficulty: Difficulty): { puzzle: number[]; solution: number[] } {
  const key = `${seed}:${difficulty}`;
  const hit = cache.get(key);
  if (hit) return { puzzle: [...hit.puzzle], solution: [...hit.solution] };

  const random = seededRandom(seed);
  const solution = fullGrid(random);
  const puzzle = [...solution];
  let givens = 81;
  for (const i of shuffleWith(
    Array.from({ length: 81 }, (_, k) => k),
    random,
  )) {
    if (givens <= GIVENS[difficulty]) break;
    const keep = puzzle[i];
    puzzle[i] = 0;
    if (countSolutions(puzzle) === 1) {
      givens--;
    } else {
      puzzle[i] = keep!;
    }
  }

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, { puzzle, solution });
  return { puzzle: [...puzzle], solution: [...solution] };
}

function conflictsOf(grid: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 81; i++) {
    const v = grid[i];
    if (!v) continue;
    if (PEERS[i]!.some((j) => grid[j] === v)) out.push(i);
  }
  return out;
}

const playSchema = z.object({
  index: z.number().int().min(0).max(80),
  value: z.number().int().min(0).max(9),
});

export const sudokuEngine: SoloEngine<SudokuBoard> = {
  extraSettings: {
    difficulty: z.enum(DIFFICULTY).default('moyen'),
  },
  playSchema,

  create(seed, settings) {
    const difficulty = (DIFFICULTY as readonly string[]).includes(settings.difficulty as string)
      ? (settings.difficulty as Difficulty)
      : 'moyen';
    const { puzzle, solution } = generateSudoku(seed, difficulty);
    return { puzzle, solution, grid: [...puzzle], conflicts: [] };
  },

  play(board, payload: z.infer<typeof playSchema>): GameResult<SudokuBoard> {
    const { index, value } = payload;
    if (board.puzzle[index] !== 0) return { ok: false, error: 'Cette case est donnée au départ' };
    const grid = [...board.grid];
    grid[index] = value;
    return { ok: true, state: { ...board, grid, conflicts: conflictsOf(grid) } };
  },

  progress(board) {
    let right = 0;
    for (let i = 0; i < 81; i++) if (board.grid[i] === board.solution[i]) right++;
    return right / 81;
  },

  solved(board) {
    return board.grid.every((v, i) => v === board.solution[i]);
  },

  view(board) {
    return {
      givens: board.puzzle,
      grid: board.grid,
      conflicts: board.conflicts,
    };
  },
};
