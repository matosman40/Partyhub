import { z } from 'zod';
import {
  type BoardGameDefinition,
  type GameContext,
  type GameManifest,
  type GameModule,
  type GameResult,
  type PlayerRef,
  type ScoreEntry,
} from '@partyhub/shared';
import { directory, fail, ok } from '../common/engine.js';
import { currentPlayer, logLine, playTurn, ranking, rollDice, type BoardState } from './rules.js';

/**
 * Jeu de plateau de parcours, généré à partir d'une définition (cases, dés, règles).
 * Chaque tour : le joueur lance les dés, avance son pion, applique l'effet de la case
 * d'arrivée, puis le tour passe au joueur suivant. Le premier arrivé gagne.
 */

export type { BoardState } from './rules.js';

export interface BoardSettings {
  turnSeconds: number;
}

export const boardSettingsSchema = z.object({
  turnSeconds: z.number().int().min(0).max(60),
});

const TURN = 'turn';

const actionSchemas = {
  roll: z.any().optional(),
};

/** Remet le minuteur du tour en place : un seul minuteur actif, uniquement pendant la partie. */
function reschedule(s: BoardState, ctx: GameContext): void {
  ctx.cancel(TURN);
  const ms = s.turnSeconds * 1000;
  if (s.phase === 'play' && ms > 0) {
    ctx.schedule(TURN, ms);
    s.turnEndsAt = ctx.now() + ms;
  } else {
    s.turnEndsAt = null;
  }
}

/** Crée un jeu de plateau jouable à partir d'une définition validée. */
export function createBoardGame(
  def: BoardGameDefinition,
  options: { id: string },
): GameModule<BoardState, BoardSettings> {
  const { rules } = def;
  const manifest: GameManifest = {
    id: options.id,
    category: 'plateau',
    name: def.name,
    description: def.description,
    icon: def.icon,
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: rules.minPlayers,
    maxPlayers: rules.maxPlayers,
    durationMin: Math.max(5, Math.round(def.cells.length / 2)),
    notice: def.notice,
  };
  const defaultSettings: BoardSettings = { turnSeconds: rules.turnSeconds };

  function initialize(settings: BoardSettings, players: PlayerRef[]): BoardState {
    const ids = players.map((p) => p.id);
    return {
      def,
      turnSeconds: settings.turnSeconds,
      names: directory(players),
      order: ids,
      positions: Object.fromEntries(ids.map((id) => [id, 0])),
      scores: Object.fromEntries(ids.map((id) => [id, 0])),
      skip: Object.fromEntries(ids.map((id) => [id, false])),
      finished: [],
      phase: 'lobby',
      turn: 0,
      turnNumber: 0,
      lastRoll: null,
      turnEndsAt: null,
      log: [],
    };
  }

  function onPlayerJoin(state: BoardState, player: PlayerRef): BoardState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (s.phase === 'lobby' && !s.order.includes(player.id)) {
      s.order.push(player.id);
      s.positions[player.id] = 0;
      s.scores[player.id] = 0;
      s.skip[player.id] = false;
    }
    return s;
  }

  function onPlayerLeave(state: BoardState, player: PlayerRef): BoardState {
    if (state.phase !== 'lobby') return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.positions[player.id];
    delete s.scores[player.id];
    delete s.skip[player.id];
    return s;
  }

  function start(state: BoardState, ctx: GameContext): GameResult<BoardState> {
    if (state.phase === 'final') return fail('La partie est terminée.');
    if (state.phase !== 'lobby') return fail('La partie est déjà lancée.');
    if (state.order.length < rules.minPlayers) {
      return fail(`Il faut au moins ${rules.minPlayers} joueurs.`);
    }
    const s = structuredClone(state);
    s.phase = 'play';
    s.turn = 0;
    s.turnNumber = 1;
    logLine(s, `${s.names[s.order[0]!] ?? '?'} joue en premier.`);
    reschedule(s, ctx);
    return ok(s);
  }

  function handleAction(
    state: BoardState,
    player: PlayerRef,
    type: string,
    _payload: unknown,
    ctx: GameContext,
  ): GameResult<BoardState> {
    if (type !== 'roll') return fail('Action inconnue.');
    if (state.phase === 'lobby') return fail('La partie n’a pas encore commencé.');
    if (state.phase === 'final') return fail('La partie est terminée.');
    if (currentPlayer(state) !== player.id) return fail("Ce n'est pas votre tour.");

    const s = structuredClone(state);
    playTurn(s, player.id, rollDice(s.def.rules.dice, ctx.random));
    reschedule(s, ctx);
    return ok(s);
  }

  /** Temps écoulé : le jeu lance les dés à la place du joueur. */
  function onTimer(state: BoardState, key: string, ctx: GameContext): BoardState {
    if (key !== TURN || state.phase !== 'play') return state;
    const s = structuredClone(state);
    const current = currentPlayer(s);
    if (!current) return state;
    logLine(s, `Temps écoulé : ${s.names[current] ?? '?'} lance les dés à sa place.`);
    playTurn(s, current, rollDice(s.def.rules.dice, ctx.random));
    reschedule(s, ctx);
    return s;
  }

  function end(state: BoardState, ctx: GameContext): BoardState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    ctx.cancel(TURN);
    s.turnEndsAt = null;
    s.phase = 'final';
    logLine(s, 'Partie interrompue.');
    return s;
  }

  function calculateScores(state: BoardState): ScoreEntry[] {
    return ranking(state);
  }

  function getPublicState(state: BoardState) {
    return {
      phase: state.phase,
      started: state.phase !== 'lobby',
      name: state.def.name,
      icon: state.def.icon,
      theme: state.def.theme,
      description: state.def.description,
      cells: state.def.cells,
      rules: state.def.rules,
      turnSeconds: state.turnSeconds,
      order: state.order,
      names: state.names,
      positions: state.positions,
      scores: state.scores,
      skip: state.skip,
      finished: state.finished,
      current: state.phase === 'play' ? currentPlayer(state) : null,
      turnNumber: state.turnNumber,
      lastRoll: state.lastRoll,
      turnEndsAt: state.turnEndsAt,
      log: state.log,
      ranking: state.phase === 'final' ? ranking(state) : null,
    };
  }

  function getPlayerState(state: BoardState, playerId: string) {
    const myTurn = state.phase === 'play' && currentPlayer(state) === playerId;
    return {
      isMyTurn: myTurn,
      canRoll: myTurn,
      spectator: !state.order.includes(playerId),
      position: state.positions[playerId] ?? 0,
      skipped: !!state.skip[playerId],
      arrived: state.finished.includes(playerId),
    };
  }

  function suggest(state: BoardState, playerId: string) {
    if (state.phase === 'play' && currentPlayer(state) === playerId) {
      return { type: 'roll', key: `roll:${state.turnNumber}` };
    }
    return null;
  }

  return {
    manifest,
    settingsSchema: boardSettingsSchema,
    defaultSettings,
    actions: actionSchemas,
    initialize,
    onPlayerJoin,
    onPlayerLeave,
    start,
    handleAction,
    onTimer,
    nextRound: (state) => state,
    calculateScores,
    end,
    getPublicState,
    getPlayerState,
    getHostState: getPublicState,
    isFinished: (state) => state.phase === 'final',
    suggest,
  };
}
