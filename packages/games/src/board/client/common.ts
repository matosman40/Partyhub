import type { BoardCellKind } from '@partyhub/shared';

/** Forme publique d’une partie de plateau, telle que renvoyée par `getPublicState`. */
export interface BoardCellPub {
  label: string;
  kind: BoardCellKind;
  value: number;
}

export interface BoardRanking {
  playerId: string;
  name: string;
  points: number;
  rank: number;
}

export interface BoardPub {
  phase: 'lobby' | 'play' | 'final';
  name: string;
  icon: string;
  theme: string;
  description: string;
  cells: BoardCellPub[];
  rules: { minPlayers: number; maxPlayers: number; dice: number; turnSeconds: number };
  turnSeconds: number;
  order: string[];
  names: Record<string, string>;
  positions: Record<string, number>;
  scores: Record<string, number>;
  skip: Record<string, boolean>;
  finished: string[];
  current: string | null;
  turnNumber: number;
  lastRoll: { playerId: string; dice: number[]; total: number; landed: number; event: string } | null;
  turnEndsAt: number | null;
  log: string[];
  ranking: BoardRanking[] | null;
}

/** Vue privée d’un joueur. */
export interface BoardMe {
  isMyTurn: boolean;
  canRoll: boolean;
  spectator: boolean;
  position: number;
  skipped: boolean;
  arrived: boolean;
}

/** Face d’un dé (⚀ à ⚅). */
export function faceOf(value: number): string {
  return String.fromCodePoint(0x2680 + Math.min(6, Math.max(1, value)) - 1);
}

/** Texte court affiché sur une case. Vide pour une case normale. */
export function badgeOf(cell: BoardCellPub): string {
  switch (cell.kind) {
    case 'avance':
      return `+${cell.value}`;
    case 'recule':
      return `−${cell.value}`;
    case 'gain':
      return `+${cell.value} pts`;
    case 'perte':
      return `−${cell.value} pts`;
    case 'passe':
      return '⏸';
    case 'arrivee':
      return '🏁';
    default:
      return '';
  }
}
