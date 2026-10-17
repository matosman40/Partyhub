import { z } from 'zod';
import {
  cardSettingsSchema,
  type CardEntry,
  type CardGameDefinition,
  type CardSettings,
  type GameContext,
  type GameManifest,
  type GameModule,
  type GameResult,
  type PlayerRef,
} from '@partyhub/shared';
import { directory, fail, ok, rankEntries, shuffle } from '../common/engine.js';

/**
 * Mécanique « mémo » : toutes les cartes sont face cachée. À son tour, on retourne deux cartes.
 * Une paire trouvée rapporte ses points et le joueur rejoue ; sinon les cartes se retournent après un court
 * délai et c'est au joueur suivant. La partie se termine quand toutes les paires sont trouvées.
 *
 * Les cartes cachées n'ont pas d'identité dans l'état public : seules les cartes retournées ou trouvées
 * sont envoyées avec leur contenu. Les identifiants de plateau ne disent rien de la carte.
 */

export interface MemoryCard {
  uid: string;
  entry: string;
  /** Joueur qui a trouvé la paire, ou null tant qu'elle n'est pas trouvée. */
  owner: string | null;
}

export type MemoryPhase = 'play' | 'peek' | 'final';

export interface MemoryState {
  def: CardGameDefinition;
  settings: CardSettings;
  started: boolean;
  order: string[];
  names: Record<string, string>;
  /** Plateau, dans un ordre mélangé. */
  board: MemoryCard[];
  /** Uids retournés pendant le tour (0 à 2). */
  open: string[];
  /** Index dans `order` du joueur dont c'est le tour. */
  turn: number;
  phase: MemoryPhase;
  pairs: number;
  matches: number;
  scores: Record<string, number>;
  lastEvent: string;
  turnEndsAt: number | null;
}

const TURN = 'turn';
const HIDE = 'hide';
/** Délai pendant lequel deux cartes différentes restent visibles. */
export const MEMORY_HIDE_MS = 1500;

const actionSchemas = {
  flip: z.object({ cardId: z.string().min(1).max(40) }),
};

/**
 * Clé de paire : l'étiquette « pair » si elle existe, sinon l'identifiant de la carte. Les deux espaces
 * sont séparés par un préfixe, pour qu'une étiquette ne puisse pas entrer en collision avec un identifiant.
 */
export function pairKey(entry: Pick<CardEntry, 'id' | 'pair'>): string {
  return entry.pair !== undefined ? `pair:${entry.pair}` : `id:${entry.id}`;
}

function cardName(entry: CardEntry): string {
  return entry.label || entry.text?.slice(0, 24) || entry.symbol;
}

function buildBoard(def: CardGameDefinition, random: () => number): MemoryCard[] {
  const copies: string[] = [];
  for (const entry of def.cards) {
    for (let i = 0; i < entry.count; i++) copies.push(entry.id);
  }
  // Les identifiants de plateau sont numérotés après le mélange : ils ne révèlent pas la carte.
  return shuffle(copies, random).map((entryId, i) => ({ uid: `c${i + 1}`, entry: entryId, owner: null }));
}

function entryMap(def: CardGameDefinition): Map<string, CardEntry> {
  return new Map(def.cards.map((c) => [c.id, c]));
}

export function createMemoryGame(
  def: CardGameDefinition,
  options: { id: string },
): GameModule<MemoryState, CardSettings> {
  const { rules } = def;
  const settingsSchema = cardSettingsSchema({ targetScore: rules.targetScore, turnSeconds: rules.turnSeconds });
  const defaultSettings: CardSettings = { targetScore: rules.targetScore, turnSeconds: rules.turnSeconds };
  const pairs = def.cards.reduce((sum, c) => sum + c.count, 0) / 2;

  const manifest: GameManifest = {
    id: options.id,
    category: 'cartes',
    name: def.name,
    description: def.description,
    icon: def.icon,
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: rules.minPlayers,
    maxPlayers: rules.maxPlayers,
    durationMin: Math.max(3, Math.round(pairs / 2)),
    notice: def.notice,
  };

  function beginTurn(s: MemoryState, ctx: GameContext): void {
    ctx.cancel(TURN);
    const ms = s.settings.turnSeconds * 1000;
    if (ms > 0) {
      ctx.schedule(TURN, ms);
      s.turnEndsAt = ctx.now() + ms;
    } else {
      s.turnEndsAt = null;
    }
  }

  /** Joueur suivant, en sautant les déconnectés s'il en reste de connectés. */
  function nextTurn(s: MemoryState, ctx: GameContext): number {
    const connected = new Set(ctx.connectedPlayerIds());
    let idx = (s.turn + 1) % s.order.length;
    for (let guard = 0; guard < s.order.length; guard++) {
      if (connected.size === 0 || connected.has(s.order[idx]!)) break;
      idx = (idx + 1) % s.order.length;
    }
    return idx;
  }

  function finish(s: MemoryState, ctx: GameContext): void {
    ctx.cancel(TURN);
    ctx.cancel(HIDE);
    s.turnEndsAt = null;
    s.phase = 'final';
    const best = Math.max(...s.order.map((id) => s.scores[id] ?? 0));
    const leaders = s.order.filter((id) => (s.scores[id] ?? 0) === best).map((id) => s.names[id] ?? '?');
    s.lastEvent =
      leaders.length === 1
        ? `${leaders[0]} gagne la partie avec ${best} points !`
        : `Égalité entre ${leaders.join(' et ')} avec ${best} points.`;
  }

  function initialize(settings: CardSettings, players: PlayerRef[]): MemoryState {
    return {
      def,
      settings,
      started: false,
      order: players.map((p) => p.id),
      names: directory(players),
      board: [],
      open: [],
      turn: 0,
      phase: 'play',
      pairs,
      matches: 0,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      lastEvent: '',
      turnEndsAt: null,
    };
  }

  function onPlayerJoin(state: MemoryState, player: PlayerRef): MemoryState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id)) {
      s.order.push(player.id);
      s.scores[player.id] = 0;
    }
    return s;
  }

  function onPlayerLeave(state: MemoryState, player: PlayerRef): MemoryState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.scores[player.id];
    return s;
  }

  function start(state: MemoryState, ctx: GameContext): GameResult<MemoryState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length < rules.minPlayers) return fail(`Il faut au moins ${rules.minPlayers} joueurs.`);
    const s = structuredClone(state);
    s.started = true;
    s.board = buildBoard(def, ctx.random);
    s.turn = 0;
    s.phase = 'play';
    s.lastEvent = `${s.names[s.order[0]!] ?? '?'} commence.`;
    beginTurn(s, ctx);
    return ok(s);
  }

  function flip(s: MemoryState, pid: string, cardId: string, ctx: GameContext): GameResult<MemoryState> {
    if (s.phase === 'peek') return fail('Patientez, les cartes se retournent.');
    if (s.order[s.turn] !== pid) return fail("Ce n'est pas votre tour.");
    const card = s.board.find((c) => c.uid === cardId);
    if (!card) return fail('Cette carte n’est pas sur le plateau.');
    if (card.owner) return fail('Cette paire est déjà trouvée.');
    if (s.open.includes(cardId)) return fail('Cette carte est déjà retournée.');

    const entries = entryMap(s.def);
    const name = s.names[pid] ?? '?';
    s.open.push(cardId);
    if (s.open.length === 1) {
      s.lastEvent = `${name} retourne une carte.`;
      return ok(s);
    }

    const [firstUid, secondUid] = s.open as [string, string];
    const first = entries.get(s.board.find((c) => c.uid === firstUid)!.entry)!;
    const second = entries.get(s.board.find((c) => c.uid === secondUid)!.entry)!;
    if (pairKey(first) === pairKey(second)) {
      for (const c of s.board) if (c.uid === firstUid || c.uid === secondUid) c.owner = pid;
      s.scores[pid] = (s.scores[pid] ?? 0) + first.points;
      s.matches += 1;
      s.open = [];
      s.lastEvent = `${name} trouve la paire « ${cardName(first)} » (+${first.points}).`;
      // Fin quand toutes les paires sont trouvées, ou dès qu'un joueur atteint l'objectif de points.
      if (s.matches >= s.pairs || (s.scores[pid] ?? 0) >= s.settings.targetScore) finish(s, ctx);
      else beginTurn(s, ctx);
      return ok(s);
    }

    // Pas une paire : les deux cartes restent visibles un instant, puis se retournent.
    s.phase = 'peek';
    s.lastEvent = `« ${cardName(first)} » et « ${cardName(second)} » ne vont pas ensemble.`;
    ctx.cancel(TURN);
    s.turnEndsAt = null;
    ctx.schedule(HIDE, MEMORY_HIDE_MS);
    return ok(s);
  }

  function handleAction(
    state: MemoryState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<MemoryState> {
    if (!state.started || !state.order.includes(player.id)) return fail('Vous ne participez pas à cette partie.');
    if (state.phase === 'final') return fail('La partie est terminée.');
    const s = structuredClone(state);
    switch (type) {
      case 'flip': {
        const { cardId } = payload as { cardId: string };
        return flip(s, player.id, cardId, ctx);
      }
      default:
        return fail('Action inconnue.');
    }
  }

  function onTimer(state: MemoryState, key: string, ctx: GameContext): MemoryState {
    if (!state.started || state.phase === 'final') return state;
    const s = structuredClone(state);
    if (key === HIDE && s.phase === 'peek') {
      s.open = [];
      s.phase = 'play';
      s.turn = nextTurn(s, ctx);
      s.lastEvent = `Au tour de ${s.names[s.order[s.turn]!] ?? '?'}.`;
      beginTurn(s, ctx);
      return s;
    }
    if (key === TURN && s.phase === 'play') {
      const current = s.order[s.turn]!;
      // Une carte restée seule se retourne avec le tour.
      s.open = [];
      s.turn = nextTurn(s, ctx);
      s.lastEvent = `Temps écoulé pour ${s.names[current] ?? '?'}.`;
      beginTurn(s, ctx);
    }
    return s;
  }

  function nextRound(state: MemoryState): MemoryState {
    return state;
  }

  function calculateScores(state: MemoryState) {
    const names = Object.fromEntries(state.order.map((id) => [id, state.names[id] ?? '?']));
    return rankEntries(names, state.scores);
  }

  function end(state: MemoryState, ctx: GameContext): MemoryState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    ctx.cancel(TURN);
    ctx.cancel(HIDE);
    s.turnEndsAt = null;
    s.phase = 'final';
    s.lastEvent = 'Partie interrompue.';
    return s;
  }

  function getPublicState(state: MemoryState) {
    const current = state.started && state.phase !== 'final' ? (state.order[state.turn] ?? null) : null;
    const entries = entryMap(state.def);
    return {
      kind: 'memory' as const,
      phase: state.phase,
      started: state.started,
      def: state.def,
      settings: state.settings,
      order: state.order,
      names: state.names,
      scores: state.scores,
      current,
      pairs: state.pairs,
      matches: state.matches,
      /** Cartes du plateau : le contenu n'est donné que pour les cartes visibles ou trouvées. */
      board: state.board.map((c) => {
        const visible = c.owner !== null || state.open.includes(c.uid) || state.phase === 'final';
        return { uid: c.uid, entry: visible ? (entries.get(c.entry)?.id ?? null) : null, owner: c.owner };
      }),
      open: state.open,
      lastEvent: state.lastEvent,
      turnEndsAt: state.turnEndsAt,
    };
  }

  function getPlayerState(state: MemoryState, playerId: string) {
    const myTurn = state.started && state.phase === 'play' && state.order[state.turn] === playerId;
    return {
      spectator: !state.order.includes(playerId),
      isMyTurn: myTurn,
      canFlip: myTurn && state.phase === 'play' && state.open.length < 2,
    };
  }

  function isFinished(state: MemoryState): boolean {
    return state.phase === 'final';
  }

  /** Robot : retourne la première carte cachée (il ne mémorise pas le plateau). */
  function suggest(state: MemoryState, playerId: string) {
    if (!state.started || state.phase !== 'play' || state.order[state.turn] !== playerId) return null;
    const hidden = state.board.find((c) => c.owner === null && !state.open.includes(c.uid));
    if (!hidden) return null;
    return { type: 'flip', payload: { cardId: hidden.uid }, key: `flip:${hidden.uid}:${state.open.length}` };
  }

  return {
    manifest,
    settingsSchema,
    defaultSettings,
    actions: actionSchemas,
    initialize,
    onPlayerJoin,
    onPlayerLeave,
    start,
    handleAction,
    onTimer,
    nextRound,
    calculateScores,
    end,
    getPublicState,
    getPlayerState,
    getHostState: getPublicState,
    isFinished,
    suggest,
  };
}
