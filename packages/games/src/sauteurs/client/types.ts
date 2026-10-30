import type { SauteursPhase } from '../module.js';

/** Un joueur tel que l'état public de la Course des sauteurs le décrit. */
export interface SauteursPlayer {
  id: string;
  name: string;
  left: boolean;
}

/** Une ligne du bilan d'un niveau (état public, phase `between`). */
export interface LevelResultRow {
  playerId: string;
  name: string;
  finishTick: number | null;
  coins: number;
  deaths: number;
  rank: number | null;
  points: number;
}

/** État public tel que `getPublicState` du module le produit (la forme est celle du serveur). */
export interface SauteursPub {
  phase: SauteursPhase;
  step: number;
  levelCount: number;
  levelIndex: number | null;
  level: { id: string; name: string; theme: 'prairie' | 'grotte' | 'ciel'; timeLimit: number } | null;
  countdownMs: number;
  startedAt: number;
  endsAt: number;
  betweenEndsAt: number;
  players: SauteursPlayer[];
  pending: string[];
  submitted: string[];
  arrivalOrder: string[];
  levelResults: LevelResultRow[] | null;
  levelPoints: { levelIndex: number; points: Record<string, number> }[];
  points: Record<string, number>;
  ranking: { playerId: string; name: string; points: number; rank: number }[];
}

/** Ce que l'écran principal reçoit en plus (`getHostState`). */
export interface SauteursHostState {
  pending: string[];
  pendingIds: string[];
  expected: string[];
  levelIndex: number;
}

/** Ce que le téléphone reçoit (`getPlayerState`). */
export interface SauteursMine {
  submitted: boolean;
  mine: { finishTick: number | null; coins: number; deaths: number; rank: number | null; points: number } | null;
  points: number;
  racing: boolean;
}
