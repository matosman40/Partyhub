import type { PokerCard } from '../rules.js';
import { RANK_LABEL, SUIT_SYMBOL, cardLabel } from '../rules.js';

/** Vue publique du poker, telle qu’émise par getPublicState (voir poker/module.ts). */
export interface PokerSeatPublic {
  id: string;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  bet: number;
  committed: number;
}

export interface PokerResultPublic {
  winners: { pid: string; amount: number; hand: string | null }[];
  reveals: Record<string, PokerCard[]>;
  board: PokerCard[];
  byFold: boolean;
}

export interface PokerPublic {
  kind: 'poker';
  phase: 'waiting' | 'betting' | 'hand-over' | 'final';
  street: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  started: boolean;
  settings: { startingChips: number; bigBlind: number; hands: number; turnSeconds: number };
  order: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  chips: Record<string, number>;
  hand: number;
  handsLeft: number;
  dealerId: string | null;
  seats: PokerSeatPublic[];
  pot: number;
  board: PokerCard[];
  current: string | null;
  currentBet: number;
  minRaise: number;
  result: PokerResultPublic | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

/** Vue privée d’un joueur : ses cartes et ce qu’il peut faire maintenant. */
export interface PokerPlayerState {
  spectator: boolean;
  holes: PokerCard[];
  chips: number;
  bet: number;
  folded: boolean;
  isMyTurn: boolean;
  toCall: number;
  callAmount: number;
  canCheck: boolean;
  canCall: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

/** Couleurs des jetons, par valeur. */
export const CHIP_COLOURS: Record<number, string> = {
  1: '#f4f4f4',
  5: '#d63a3a',
  25: '#2fa65a',
  100: '#1d1d1d',
  500: '#7b3fe4',
};

/**
 * Jetons à empiler pour un montant : les plus gros d’abord, au plus 8 pièces pour rester lisible.
 * Ce n’est qu’un aperçu : le montant exact est toujours écrit à côté.
 */
export function chipsFor(amount: number): number[] {
  const denominations = [500, 100, 25, 5, 1];
  const tokens: number[] = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const value of denominations) {
    while (rest >= value && tokens.length < 8) {
      tokens.push(value);
      rest -= value;
    }
  }
  return tokens;
}

/** Carte en texte accessible, par exemple « As de pique ». */
export function cardSpeech(card: PokerCard): string {
  return cardLabel(card);
}

export { RANK_LABEL, SUIT_SYMBOL };
