import { z } from 'zod';
import type { GameResult } from '@partyhub/shared';
import { seededRandom } from './rng.js';
import type { SoloEngine } from './engine.js';

/**
 * Taquin : des tuiles numérotées à remettre dans l'ordre en les faisant glisser vers la case
 * vide. Le mélange se fait par une suite de coups légaux depuis la grille résolue, donc
 * chaque grille est toujours soluble.
 */

export interface TaquinBoard {
  size: number;
  /** Valeurs de 1 à n²−1, et 0 pour la case vide. */
  tiles: number[];
}

const SCRAMBLE_MOVES = 400;

function solvedTiles(size: number): number[] {
  const n = size * size;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 0 : i + 1));
}

function neighbours(size: number, i: number): number[] {
  const r = Math.floor(i / size);
  const c = i % size;
  const out: number[] = [];
  if (r > 0) out.push(i - size);
  if (r < size - 1) out.push(i + size);
  if (c > 0) out.push(i - 1);
  if (c < size - 1) out.push(i + 1);
  return out;
}

export function scrambleTaquin(size: number, seed: number): number[] {
  const random = seededRandom(seed);
  let tiles = solvedTiles(size);
  let blank = tiles.indexOf(0);
  let previous = -1;
  for (let step = 0; step < SCRAMBLE_MOVES; step++) {
    const options = neighbours(size, blank).filter((i) => i !== previous);
    const pick = options[Math.floor(random() * options.length)]!;
    tiles = [...tiles];
    [tiles[blank], tiles[pick]] = [tiles[pick]!, tiles[blank]!];
    previous = blank;
    blank = pick;
  }
  // Une grille déjà résolue ne serait pas un défi : on recommence avec un coup de plus.
  if (tiles.every((v, i) => v === solvedTiles(size)[i])) {
    const i = tiles.indexOf(0);
    const other = neighbours(size, i)[0]!;
    [tiles[i], tiles[other]] = [tiles[other]!, tiles[i]!];
  }
  return tiles;
}

const playSchema = z.object({ index: z.number().int().min(0).max(63) });

export const taquinEngine: SoloEngine<TaquinBoard> = {
  extraSettings: {
    size: z.union([z.literal(3), z.literal(4)]).default(4),
  },
  playSchema,

  create(seed, settings) {
    const size = settings.size === 3 ? 3 : 4;
    return { size, tiles: scrambleTaquin(size, seed) };
  },

  play(board, payload: z.infer<typeof playSchema>): GameResult<TaquinBoard> {
    const { index } = payload;
    if (index >= board.tiles.length) return { ok: false, error: 'Case inconnue' };
    const blank = board.tiles.indexOf(0);
    if (!neighbours(board.size, blank).includes(index)) {
      return { ok: false, error: 'Seule une tuile voisine de la case vide peut glisser' };
    }
    const tiles = [...board.tiles];
    [tiles[blank], tiles[index]] = [tiles[index]!, tiles[blank]!];
    return { ok: true, state: { ...board, tiles } };
  },

  progress(board) {
    const target = solvedTiles(board.size);
    let right = 0;
    board.tiles.forEach((v, i) => {
      if (v === target[i]) right++;
    });
    return right / board.tiles.length;
  },

  solved(board) {
    const target = solvedTiles(board.size);
    return board.tiles.every((v, i) => v === target[i]);
  },

  view(board) {
    return { size: board.size, tiles: board.tiles };
  },
};
