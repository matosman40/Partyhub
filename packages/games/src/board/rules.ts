import type { BoardCell, BoardGameDefinition } from '@partyhub/shared';

/** Règles pures du jeu de plateau : déplacements, effets des cases, tour et classement. */

export type BoardPhase = 'lobby' | 'play' | 'final';

export interface LastRoll {
  playerId: string;
  dice: number[];
  total: number;
  landed: number;
  event: string;
}

export interface BoardState {
  def: BoardGameDefinition;
  turnSeconds: number;
  names: Record<string, string>;
  order: string[];
  positions: Record<string, number>;
  scores: Record<string, number>;
  /** Joueurs qui passent leur prochain tour. */
  skip: Record<string, boolean>;
  /** Joueurs arrivés, dans l'ordre d'arrivée. */
  finished: string[];
  phase: BoardPhase;
  turn: number;
  turnNumber: number;
  lastRoll: LastRoll | null;
  turnEndsAt: number | null;
  log: string[];
}

export const LOG_SIZE = 6;

export function rollDice(count: number, random: () => number): number[] {
  return Array.from({ length: count }, () => 1 + Math.floor(random() * 6));
}

export function currentPlayer(state: BoardState): string | null {
  return state.phase === 'play' ? (state.order[state.turn] ?? null) : null;
}

export function logLine(state: BoardState, line: string): void {
  state.log = [...state.log, line].slice(-LOG_SIZE);
}

function cellName(cell: BoardCell, index: number): string {
  return cell.label || `case ${index}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

/** Passe au joueur suivant encore en course. Consomme les passages de tour. */
export function nextTurn(state: BoardState): void {
  const n = state.order.length;
  let idx = state.turn;
  for (let guard = 0; guard < n * 2 + 2; guard++) {
    idx = (idx + 1) % n;
    const pid = state.order[idx]!;
    if (state.finished.includes(pid)) continue;
    state.turnNumber++;
    if (state.skip[pid]) {
      state.skip[pid] = false;
      logLine(state, `${state.names[pid] ?? '?'} passe son tour.`);
      continue;
    }
    state.turn = idx;
    return;
  }
  // Plus personne ne peut jouer : la partie se termine.
  state.phase = 'final';
}

/**
 * Joue le tour d'un joueur avec les dés donnés : déplacement, effet de la case
 * d'arrivée, puis tour suivant. Le premier arrivé met fin à la partie.
 */
export function playTurn(state: BoardState, pid: string, dice: number[]): void {
  const last = state.def.cells.length - 1;
  const total = dice.reduce((sum, d) => sum + d, 0);
  const name = state.names[pid] ?? '?';
  const from = state.positions[pid] ?? 0;
  const landed = Math.min(last, from + total);
  const cell = state.def.cells[landed]!;

  let position = landed;
  let finishes = landed === last;
  let text = `${name} fait ${total} et arrive sur « ${cellName(cell, landed)} ».`;
  if (!finishes) {
    switch (cell.kind) {
      case 'avance':
        position = Math.min(last, landed + cell.value);
        finishes = position === last;
        text += ` Avance de ${plural(cell.value, 'case')}.`;
        break;
      case 'recule':
        position = Math.max(0, landed - cell.value);
        text += ` Recule de ${plural(cell.value, 'case')}.`;
        break;
      case 'gain':
        state.scores[pid] = (state.scores[pid] ?? 0) + cell.value;
        text += ` Gagne ${plural(cell.value, 'point')}.`;
        break;
      case 'perte':
        state.scores[pid] = (state.scores[pid] ?? 0) - cell.value;
        text += ` Perd ${plural(cell.value, 'point')}.`;
        break;
      case 'passe':
        state.skip[pid] = true;
        text += ' Passera son prochain tour.';
        break;
      default:
        break;
    }
  }

  state.positions[pid] = position;
  state.lastRoll = { playerId: pid, dice, total, landed, event: text };
  logLine(state, text);

  if (finishes) {
    state.finished.push(pid);
    logLine(state, `${name} arrive le premier : fin de la partie.`);
    state.phase = 'final';
    return;
  }
  nextTurn(state);
}

export interface RankRow {
  playerId: string;
  name: string;
  points: number;
  rank: number;
}

/**
 * Classement : les arrivés d'abord (dans l'ordre d'arrivée), puis les autres par case
 * atteinte. Deux joueurs sur la même case avec le même score partagent un rang.
 */
export function ranking(state: BoardState): RankRow[] {
  const rest = state.order
    .filter((id) => !state.finished.includes(id))
    .sort(
      (a, b) =>
        (state.positions[b] ?? 0) - (state.positions[a] ?? 0) ||
        (state.scores[b] ?? 0) - (state.scores[a] ?? 0) ||
        state.order.indexOf(a) - state.order.indexOf(b),
    );
  const ordered = [...state.finished, ...rest];
  const rows: RankRow[] = [];
  let previousKey: string | null = null;
  let rank = 0;
  ordered.forEach((id, i) => {
    const key = state.finished.includes(id)
      ? `arrive:${i}`
      : `case:${state.positions[id] ?? 0}:${state.scores[id] ?? 0}`;
    if (key !== previousKey) rank = i + 1;
    previousKey = key;
    rows.push({ playerId: id, name: state.names[id] ?? '?', points: state.scores[id] ?? 0, rank });
  });
  return rows;
}
