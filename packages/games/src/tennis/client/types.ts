import type { ScoreEntry } from '@partyhub/shared';
import type { Side } from '../rules.js';
import type { TennisMatchView, TournamentView } from '../module.js';

/** Vue publique : un côté du terrain, avec son joueur s’il en a un. */
export interface TennisSeatView {
  side: number;
  playerId: string | null;
  name: string | null;
  lives: number;
  points: number;
  alive: boolean;
}

/** Vue publique de la partie : phase, règles, match en cours et championnat. */
export interface TennisPub {
  phase: 'ready' | 'play' | 'pause' | 'final';
  rules: 'vies' | 'tennis';
  format: 'libre' | 'poule' | 'eliminatoire';
  lives: number;
  sets: 1 | 3;
  matchMs: number;
  endsAt: number;
  seats: TennisSeatView[];
  ranking: ScoreEntry[];
  match: TennisMatchView | null;
  tournament: TournamentView | null;
}

/** Vue privée : le côté du joueur, et son état. `side` vaut null hors terrain. */
export interface TennisMe {
  side: Side | null;
  alive: boolean;
  /** Le joueur attend son tour (championnat), ou une pause entre deux matchs. */
  waiting: boolean;
  lives: number;
  points: number;
  /** Rang à la fin de la partie ; null avant. */
  rank: number | null;
  /** Points du jeu en cours, en règles du tennis ; vide sinon. */
  label: string;
}

/** Couleur de chaque côté, de la raquette et de son joueur (même teinte sur l’écran principal et le téléphone). */
export const SIDE_COLORS: Record<Side, string> = {
  0: '#ff4f8b',
  1: '#5eead4',
  2: '#ffd23f',
  3: '#b59cff',
};
