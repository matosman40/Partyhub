import type { Choice, ChoiceKind } from '../rules.js';
import type { PlateauPhase } from '../module.js';

/** Vue publique de la partie, telle que `getPublicState` la produit. Tout le monde la reçoit, téléphones compris. */
export interface PlateauPlayerView {
  id: string;
  name: string;
  dist: number;
  cell: number;
  coins: number;
  stars: number;
  rolled: boolean;
  /** Le dé n’est visible qu’une fois le déplacement joué. */
  roll: number | null;
  choosing: boolean;
}

export interface PlateauStanding {
  id: string;
  name: string;
  stars: number;
  coins: number;
  rank: number;
}

export interface MoveView {
  id: string;
  roll: number;
  path: number[];
  to: number;
}

export interface EventView {
  id: string;
  name: string;
  icon: string;
  text: string;
  by: string;
}

export interface MicrogameView {
  id: string;
  name: string;
  icon: string;
  instruction: string;
  hint: string;
  durationMs: number;
  sensor:
    'shake' | 'tilt' | 'spin' | 'mic' | 'tap' | 'timing' | 'swipe' | 'vibrate' | 'camera' | 'clap' | 'pinch' | 'flick';
  target: number;
}

export interface MiniView {
  number: number;
  round: number;
  rounds: number;
  game: MicrogameView | null;
  sequence: { icon: string; name: string }[];
  endsAt: number;
  submitted: string[];
  reveal: Record<string, { success: boolean; points: number }> | null;
  points: Record<string, number>;
  payouts: Record<string, number> | null;
}

export interface PlateauPub {
  phase: PlateauPhase;
  turn: number;
  turns: number;
  ring: number;
  nextAt: number;
  starCells: number[];
  players: PlateauPlayerView[];
  standings: PlateauStanding[];
  waiting: string[];
  moves: MoveView[];
  moveStamp: number;
  event: EventView | null;
  notes: string[];
  mini: MiniView | null;
  final: { id: string; stars: number; coins: number; rank: number }[] | null;
  names: Record<string, string>;
}

/** Vue privée d’un joueur, telle que `getPlayerState` la produit. */
export interface PlateauMine {
  seated: boolean;
  rolled: boolean;
  roll: number | null;
  cell: number;
  coins: number;
  stars: number;
  starCost: number;
  choice: { kind: ChoiceKind; title: string; options: [Choice, Choice] } | null;
  mini: {
    submitted: boolean;
    reveal: { success: boolean; points: number } | null;
    points: number;
    payout: number | null;
  } | null;
}
