import type { RankRow } from '../../client/ui.js';

/** Vent d’une manche, tel que la vue publique le décrit : la graine suffit à le reproduire sur chaque écran. */
export interface WindView {
  seed: number;
  strength: number;
  label: string;
  walkMs: number;
}

export interface FunambulePub {
  phase: 'ready' | 'intro' | 'walk' | 'reveal' | 'final';
  round: number;
  rounds: number;
  wind: WindView | null;
  introEndsAt: number;
  startedAt: number;
  endsAt: number;
  revealEndsAt: number;
  players: { id: string; name: string }[];
  submitted: string[];
  fallen: string[];
  crossed: string[];
  results: { playerId: string; name: string; success: boolean; survived: number; points: number }[] | null;
  ranking: RankRow[];
}

export interface FunambuleMine {
  submitted: boolean;
  mine: { success: boolean; survived: number; points: number } | null;
  points: number;
}
