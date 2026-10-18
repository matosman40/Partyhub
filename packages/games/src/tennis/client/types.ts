import type { ScoreEntry } from '@partyhub/shared';
import type { Side } from '../rules.js';

/** Vue publique : un côté du terrain, avec son joueur s’il en a un. */
export interface TennisSeatView {
  side: number;
  playerId: string | null;
  name: string | null;
  lives: number;
  points: number;
  alive: boolean;
}

export interface TennisPub {
  phase: 'ready' | 'play' | 'final';
  lives: number;
  matchMs: number;
  endsAt: number;
  seats: TennisSeatView[];
  ranking: ScoreEntry[];
}

/** Vue privée : le côté du joueur, et son état. `side` vaut null hors terrain. */
export interface TennisMe {
  side: Side | null;
  alive: boolean;
  lives: number;
  points: number;
}

/** Couleur de chaque côté, de la raquette et de son joueur (même teinte sur l’écran principal et le téléphone). */
export const SIDE_COLORS: Record<Side, string> = {
  0: '#ff4f8b',
  1: '#5eead4',
  2: '#ffd23f',
  3: '#b59cff',
};
