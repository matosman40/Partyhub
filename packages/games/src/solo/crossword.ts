import { z } from 'zod';
import type { GameResult } from '@partyhub/shared';
import rawWords from './words-fr.json' with { type: 'json' };
import { seededRandom, shuffleWith } from './rng.js';
import type { SoloEngine } from './engine.js';

/**
 * Mots croisés : une grille générée à partir de la graine, à partir de mots et de définitions
 * en français. Chaque joueur reçoit la même grille. Le serveur vérifie les lettres contre la
 * solution, qui n’est jamais envoyée sur le téléphone.
 */

const WORDS = z
  .array(z.object({ word: z.string().regex(/^[A-Z]{3,12}$/), clue: z.string().min(3).max(90) }))
  .min(10)
  .parse(rawWords);

/** Nombre minimal de mots pour qu’une grille soit acceptée. */
const MIN_WORDS = 10;
const ATTEMPTS = 40;

export interface Clue {
  number: number;
  text: string;
  length: number;
  row: number;
  col: number;
}

export interface CrosswordGrid {
  rows: number;
  cols: number;
  /** Lettres de la solution, de gauche à droite et de haut en bas ; null pour une case noire. */
  solution: (string | null)[];
  /** Numéro affiché dans une case de début de mot, 0 sinon. */
  numbers: number[];
  clues: { across: Clue[]; down: Clue[] };
}

interface Placed {
  word: string;
  clue: string;
  row: number;
  col: number;
  across: boolean;
}

/** Côté maximal de la grille : au-delà, un mot n’est pas placé (une grille compacte se joue mieux). */
const MAX_SIDE = 15;
/** Parmi les meilleurs emplacements (à quelques points près), on tire au hasard pour varier. */
const SCORE_MARGIN = 3;

function attemptGrid(random: () => number): Placed[] {
  const letters = new Map<string, string>();
  const acrossCells = new Set<string>();
  const downCells = new Set<string>();
  const placed: Placed[] = [];
  const key = (r: number, c: number) => `${r},${c}`;
  const has = (r: number, c: number) => letters.has(key(r, c));
  const box = { minR: 0, maxR: 0, minC: 0, maxC: 0 };

  /** Nombre de cases communes si le mot peut être posé ici, 0 sinon. */
  const crossingsAt = (word: string, r0: number, c0: number, across: boolean): number => {
    const dr = across ? 0 : 1;
    const dc = across ? 1 : 0;
    // La case juste avant et juste après le mot doivent rester vides.
    if (has(r0 - dr, c0 - dc) || has(r0 + word.length * dr, c0 + word.length * dc)) return 0;
    let crossings = 0;
    for (let i = 0; i < word.length; i++) {
      const r = r0 + i * dr;
      const c = c0 + i * dc;
      const existing = letters.get(key(r, c));
      if (existing !== undefined) {
        if (existing !== word[i]) return 0;
        // Deux mots dans la même direction sur la même case : impossible.
        if (across ? acrossCells.has(key(r, c)) : downCells.has(key(r, c))) return 0;
        crossings++;
      } else if (across) {
        // Une case neuve ne doit pas toucher un autre mot par-dessus ou par-dessous.
        if (has(r - 1, c) || has(r + 1, c)) return 0;
      } else if (has(r, c - 1) || has(r, c + 1)) {
        return 0;
      }
    }
    return crossings;
  };

  const place = (word: string, clue: string, r0: number, c0: number, across: boolean): void => {
    for (let i = 0; i < word.length; i++) {
      const r = across ? r0 : r0 + i;
      const c = across ? c0 + i : c0;
      letters.set(key(r, c), word[i]!);
      (across ? acrossCells : downCells).add(key(r, c));
      box.minR = Math.min(box.minR, r);
      box.maxR = Math.max(box.maxR, r);
      box.minC = Math.min(box.minC, c);
      box.maxC = Math.max(box.maxC, c);
    }
    placed.push({ word, clue, row: r0, col: c0, across });
  };

  // Premier mot : horizontal, à l’origine.
  const ordered = [...WORDS].sort((a, b) => b.word.length - a.word.length);
  const pool = shuffleWith(ordered, random).sort((a, b) => b.word.length - a.word.length);
  const first = pool[0]!;
  place(first.word, first.clue, 0, 0, true);
  let remaining = pool.slice(1);

  // Passes successives : un mot qui ne trouve pas de place peut en trouver une plus tard.
  for (let pass = 0; pass < 3 && remaining.length > 0; pass++) {
    const next: typeof remaining = [];
    for (const entry of remaining) {
      const candidates: Array<{ r: number; c: number; across: boolean; score: number }> = [];
      const seen = new Set<string>();
      for (const [cellKey, letter] of letters) {
        const [r, c] = cellKey.split(',').map(Number) as [number, number];
        for (let k = 0; k < entry.word.length; k++) {
          if (entry.word[k] !== letter) continue;
          for (const across of [true, false]) {
            const r0 = across ? r : r - k;
            const c0 = across ? c - k : c;
            const id = `${r0},${c0},${across}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const crossings = crossingsAt(entry.word, r0, c0, across);
            if (crossings === 0) continue;
            // Taille de la boîte englobante après pose : on la garde petite.
            const rEnd = across ? r0 : r0 + entry.word.length - 1;
            const cEnd = across ? c0 + entry.word.length - 1 : c0;
            const rows = Math.max(box.maxR, rEnd) - Math.min(box.minR, r0) + 1;
            const cols = Math.max(box.maxC, cEnd) - Math.min(box.minC, c0) + 1;
            if (rows > MAX_SIDE || cols > MAX_SIDE) continue;
            candidates.push({ r: r0, c: c0, across, score: rows * cols - 4 * crossings });
          }
        }
      }
      if (candidates.length === 0) {
        next.push(entry);
        continue;
      }
      const best = Math.min(...candidates.map((x) => x.score));
      const close = candidates.filter((x) => x.score <= best + SCORE_MARGIN);
      const pick = close[Math.floor(random() * close.length)]!;
      place(entry.word, entry.clue, pick.r, pick.c, pick.across);
    }
    remaining = next;
  }
  return placed;
}

function buildGrid(placed: Placed[]): CrosswordGrid {
  const minR = Math.min(...placed.map((p) => p.row));
  const minC = Math.min(...placed.map((p) => p.col));
  let maxR = 0;
  let maxC = 0;
  const cellsAt = new Map<string, string>();
  for (const p of placed) {
    for (let i = 0; i < p.word.length; i++) {
      const r = p.across ? p.row : p.row + i;
      const c = p.across ? p.col + i : p.col;
      cellsAt.set(`${r - minR},${c - minC}`, p.word[i]!);
      maxR = Math.max(maxR, r - minR);
      maxC = Math.max(maxC, c - minC);
    }
  }
  const rows = maxR + 1;
  const cols = maxC + 1;
  const solution: (string | null)[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) solution.push(cellsAt.get(`${r},${c}`) ?? null);
  }
  const at = (r: number, c: number) => (r >= 0 && c >= 0 && r < rows && c < cols ? solution[r * cols + c] : null);

  // Numérotation : une case qui commence un mot horizontal ou vertical reçoit le prochain numéro.
  const numbers = new Array<number>(rows * cols).fill(0);
  let next = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(r, c)) continue;
      const startsAcross = at(r, c - 1) === null && at(r, c + 1) !== null;
      const startsDown = at(r - 1, c) === null && at(r + 1, c) !== null;
      if (startsAcross || startsDown) numbers[r * cols + c] = next++;
    }
  }

  const clues: CrosswordGrid['clues'] = { across: [], down: [] };
  for (const p of placed) {
    const r = p.row - minR;
    const c = p.col - minC;
    const clue: Clue = {
      number: numbers[r * cols + c]!,
      text: p.clue,
      length: p.word.length,
      row: r,
      col: c,
    };
    (p.across ? clues.across : clues.down).push(clue);
  }
  clues.across.sort((a, b) => a.number - b.number);
  clues.down.sort((a, b) => a.number - b.number);
  return { rows, cols, solution, numbers, clues };
}

const cache = new Map<number, CrosswordGrid>();

/** Grille de la graine donnée : la même pour tous les joueurs d’une salle. */
export function generateCrossword(seed: number): CrosswordGrid {
  const hit = cache.get(seed);
  if (hit) return hit;
  const random = seededRandom(seed);
  let best: Placed[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const placed = attemptGrid(random);
    if (placed.length > best.length) best = placed;
    if (placed.length >= MIN_WORDS) break;
  }
  const grid = buildGrid(best);
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(seed, grid);
  return grid;
}

const playSchema = z.union([
  z.object({
    type: z.literal('letter'),
    index: z.number().int().min(0).max(199),
    letter: z.string().regex(/^[A-Z]?$/),
  }),
  z.object({ type: z.literal('check') }),
]);

export interface CrosswordBoard {
  grid: CrosswordGrid;
  letters: string[];
  /** Cases dont la lettre est fausse, signalées après « Vérifier ». */
  errors: number[];
}

export const crosswordEngine: SoloEngine<CrosswordBoard> = {
  extraSettings: {},
  playSchema,

  create(seed) {
    const grid = generateCrossword(seed);
    return { grid, letters: grid.solution.map(() => ''), errors: [] };
  },

  play(board, payload: z.infer<typeof playSchema>): GameResult<CrosswordBoard> {
    if (payload.type === 'check') {
      const errors = board.grid.solution
        .map((s, i) => (s !== null && board.letters[i] && board.letters[i] !== s ? i : -1))
        .filter((i) => i >= 0);
      return { ok: true, state: { ...board, errors } };
    }
    const { index, letter } = payload;
    if (index >= board.grid.solution.length || board.grid.solution[index] === null) {
      return { ok: false, error: 'Case noire : rien à écrire ici' };
    }
    const letters = [...board.letters];
    letters[index] = letter;
    return {
      ok: true,
      state: { ...board, letters, errors: board.errors.filter((i) => i !== index) },
    };
  },

  progress(board) {
    const cells = board.grid.solution.filter((s) => s !== null).length;
    const right = board.grid.solution.filter((s, i) => s !== null && board.letters[i] === s).length;
    return cells === 0 ? 0 : right / cells;
  },

  solved(board) {
    return board.grid.solution.every((s, i) => s === null || board.letters[i] === s);
  },

  view(board) {
    return {
      rows: board.grid.rows,
      cols: board.grid.cols,
      black: board.grid.solution.map((s) => s === null),
      numbers: board.grid.numbers,
      letters: board.letters,
      errors: board.errors,
      clues: board.grid.clues,
    };
  },
};
