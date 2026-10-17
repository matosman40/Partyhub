import type { RankRow } from '../../client/ui.js';

/** Défi tel que la vue publique le décrit (sans le résultat). */
export interface MicrogameView {
  id: string;
  name: string;
  icon: string;
  instruction: string;
  hint: string;
  durationMs: number;
  sensor: 'shake' | 'tilt' | 'spin' | 'mic' | 'tap' | 'timing';
  /** Valeur à atteindre (secousses, millisecondes, degrés, tapotements). 0 pour « Pile ». */
  target: number;
}

export interface MicroDefisPub {
  phase: 'ready' | 'intro' | 'play' | 'reveal' | 'final';
  round: number;
  rounds: number;
  microgame: MicrogameView | null;
  introEndsAt: number;
  startedAt: number;
  endsAt: number;
  revealEndsAt: number;
  players: { id: string; name: string }[];
  submitted: string[];
  results: { playerId: string; name: string; success: boolean; points: number }[] | null;
  ranking: RankRow[];
}

export interface MicroDefisMine {
  submitted: boolean;
  mine: { success: boolean; points: number } | null;
  points: number;
}
