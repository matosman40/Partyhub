import { z } from 'zod';
import type { GameResult } from '@partyhub/shared';
import { seededRandom, shuffleWith } from './rng.js';
import type { SoloEngine } from './engine.js';

/**
 * Solitaire (Klondike) : sept colonnes, quatre fondations et une pioche. Les colonnes se
 * construisent en alternance de couleur et en ordre décroissant ; les fondations se
 * remplissent par couleur, de l’As au Roi. Le joueur tape une carte, puis sa destination.
 */

export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export type Suit = 0 | 1 | 2 | 3;

export interface Card {
  /** 1 (As) à 13 (Roi). */
  rank: number;
  suit: Suit;
  up: boolean;
}

export interface KlondikeBoard {
  drawCount: number;
  tableau: Card[][];
  stock: Card[];
  waste: Card[];
  foundations: Card[][];
}

const RED = new Set<Suit>([1, 2]);

function isRed(suit: Suit): boolean {
  return RED.has(suit);
}

export function dealKlondike(seed: number, drawCount: number): KlondikeBoard {
  const random = seededRandom(seed);
  const deck: Card[] = [];
  for (const suit of [0, 1, 2, 3] as Suit[]) {
    for (let rank = 1; rank <= 13; rank++) deck.push({ rank, suit, up: false });
  }
  const cards = shuffleWith(deck, random);
  const tableau: Card[][] = [];
  let at = 0;
  for (let col = 0; col < 7; col++) {
    const column: Card[] = [];
    for (let k = 0; k <= col; k++) {
      const card = cards[at++]!;
      column.push({ ...card, up: k === col });
    }
    tableau.push(column);
  }
  return {
    drawCount,
    tableau,
    stock: cards.slice(at).map((c) => ({ ...c, up: false })),
    waste: [],
    foundations: [[], [], [], []],
  };
}

function cloneBoard(b: KlondikeBoard): KlondikeBoard {
  return {
    drawCount: b.drawCount,
    tableau: b.tableau.map((col) => col.map((c) => ({ ...c }))),
    stock: b.stock.map((c) => ({ ...c })),
    waste: b.waste.map((c) => ({ ...c })),
    foundations: b.foundations.map((f) => f.map((c) => ({ ...c }))),
  };
}

function canStackOnTableau(card: Card, target: Card[]): boolean {
  const top = target[target.length - 1];
  if (!top) return card.rank === 13;
  return top.up && top.rank === card.rank + 1 && isRed(top.suit) !== isRed(card.suit);
}

function canStackOnFoundation(card: Card, foundation: Card[]): boolean {
  const top = foundation[foundation.length - 1];
  if (!top) return card.rank === 1;
  return top.suit === card.suit && top.rank === card.rank - 1;
}

/** Emplacement : « w » (défausse), « t0 » à « t6 » (colonnes), « f0 » à « f3 » (fondations). */
const LOCATION = /^(w|t[0-6]|f[0-3])$/;

const playSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('draw') }),
  z.object({
    type: z.literal('move'),
    from: z.string().regex(LOCATION),
    /** Nombre de cartes à déplacer depuis la carte choisie (colonnes seulement). */
    count: z.number().int().min(1).max(13).default(1),
    to: z.string().regex(LOCATION),
  }),
]);

function fail(error: string): GameResult<KlondikeBoard> {
  return { ok: false, error };
}

function draw(board: KlondikeBoard): GameResult<KlondikeBoard> {
  const next = cloneBoard(board);
  if (next.stock.length === 0) {
    if (next.waste.length === 0) return fail('Il n’y a plus de carte à piocher');
    // Recyclage de la défausse : elle redevient la pioche, retournée.
    next.stock = next.waste.reverse().map((c) => ({ ...c, up: false }));
    next.waste = [];
    return { ok: true, state: next };
  }
  for (let k = 0; k < next.drawCount && next.stock.length > 0; k++) {
    const card = next.stock.pop()!;
    next.waste.push({ ...card, up: true });
  }
  return { ok: true, state: next };
}

function move(board: KlondikeBoard, from: string, count: number, to: string): GameResult<KlondikeBoard> {
  if (from === to) return fail('La carte est déjà à cet endroit');
  // Le plateau de départ n’est jamais modifié : on travaille sur une copie, et un coup refusé
  // renvoie simplement une erreur.
  const next = cloneBoard(board);

  // Cartes prises à la source.
  let moving: Card[];
  let flipSource: (() => void) | null = null;
  if (from === 'w') {
    if (count !== 1) return fail('Une seule carte à la fois depuis la défausse');
    const top = next.waste[next.waste.length - 1];
    if (!top) return fail('La défausse est vide');
    moving = [top];
    next.waste.pop();
  } else if (from.startsWith('t')) {
    const col = next.tableau[Number(from.slice(1))]!;
    if (count > col.length) return fail('Pas assez de cartes dans cette colonne');
    const start = col.length - count;
    moving = col.slice(start);
    if (moving.some((c) => !c.up)) return fail('Cette carte est face cachée');
    // Une pile déplacée doit être en séquence : rang décroissant, couleurs alternées.
    for (let i = 0; i < moving.length - 1; i++) {
      const a = moving[i]!;
      const b = moving[i + 1]!;
      if (a.rank !== b.rank + 1 || isRed(a.suit) === isRed(b.suit)) {
        return fail('Ces cartes ne forment pas une suite');
      }
    }
    col.splice(start, count);
    flipSource = () => {
      const top = col[col.length - 1];
      if (top && !top.up) top.up = true;
    };
  } else {
    const found = next.foundations[Number(from.slice(1))]!;
    if (count !== 1) return fail('Une seule carte à la fois depuis une fondation');
    const top = found[found.length - 1];
    if (!top) return fail('La fondation est vide');
    moving = [top];
    found.pop();
  }

  const first = moving[0]!;
  if (to.startsWith('t')) {
    const target = next.tableau[Number(to.slice(1))]!;
    if (!canStackOnTableau(first, target)) return fail('Cette carte ne peut pas aller ici');
    target.push(...moving);
  } else {
    if (moving.length !== 1) return fail('Une seule carte à la fois vers une fondation');
    if (Number(to.slice(1)) !== first.suit) return fail('Cette carte va sur une autre fondation');
    const found = next.foundations[first.suit]!;
    if (!canStackOnFoundation(first, found)) return fail('Cette carte ne peut pas aller sur cette fondation');
    found.push(first);
  }

  flipSource?.();
  return { ok: true, state: next };
}

export const solitaireEngine: SoloEngine<KlondikeBoard> = {
  extraSettings: {
    drawCount: z.union([z.literal(1), z.literal(3)]).default(1),
  },
  playSchema,

  create(seed, settings) {
    return dealKlondike(seed, settings.drawCount === 3 ? 3 : 1);
  },

  play(board, payload: z.infer<typeof playSchema>): GameResult<KlondikeBoard> {
    if (payload.type === 'draw') return draw(board);
    return move(board, payload.from, payload.count, payload.to);
  },

  progress(board) {
    return board.foundations.reduce((n, f) => n + f.length, 0) / 52;
  },

  solved(board) {
    return board.foundations.every((f) => f.length === 13);
  },

  view(board) {
    return {
      drawCount: board.drawCount,
      tableau: board.tableau.map((col) =>
        col.map((c) => (c.up ? { rank: c.rank, suit: c.suit, up: true } : { up: false })),
      ),
      stockCount: board.stock.length,
      waste: board.waste.map((c) => ({ rank: c.rank, suit: c.suit })),
      foundations: board.foundations.map((f) => f.map((c) => ({ rank: c.rank, suit: c.suit }))),
    };
  },
};
