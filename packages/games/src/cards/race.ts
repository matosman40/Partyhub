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
 * Mécanique « ressemblance » (course) : une carte est posée au centre, et chaque joueur a sa main, cachée
 * aux autres. La première touche juste (une carte qui ressemble au centre, selon `matchOn`) prend la carte
 * centrale : ses points vont à ce joueur, et sa carte devient le nouveau centre.
 *
 * - Une touche fausse bloque son auteur une seconde et demie.
 * - Si personne ne peut répondre, la carte centrale est écartée et une nouvelle est piochée.
 * - Si `turnSeconds` est positif, la carte centrale change aussi quand ce délai passe sans réponse.
 * - La manche finit quand une main est vide (son propriétaire la termine) ou quand plus aucune réponse
 *   n'est possible. La partie finit quand un joueur atteint l'objectif de points.
 *
 * Les mains ne sont jamais dans la vue publique : seuls la carte centrale, les nombres de cartes et les
 * verrous sont partagés.
 */

export interface RaceCard {
  uid: string;
  entry: string;
}

export type RacePhase = 'play' | 'round-over' | 'final';

export interface RaceState {
  def: CardGameDefinition;
  settings: CardSettings;
  started: boolean;
  order: string[];
  names: Record<string, string>;
  hands: Record<string, RaceCard[]>;
  /** Cartes non distribuées, piochées quand la carte centrale ne trouve pas de réponse. */
  pile: RaceCard[];
  center: RaceCard | null;
  scores: Record<string, number>;
  /** Joueur → instant (ms, horloge serveur) jusqu'auquel ses touches sont bloquées. */
  locked: Record<string, number>;
  phase: RacePhase;
  round: number;
  roundWinner: string | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

/** Durée du blocage après une touche fausse. */
export const RACE_LOCK_MS = 1500;
const TURN = 'turn';
const NEXT_ROUND = 'next-round';
const NEXT_ROUND_MS = 5000;
const UNLOCK_PREFIX = 'unlock:';
/** Garde-fou : une partie ne dépasse pas ce nombre de manches, même sans gagnant. */
const MAX_ROUNDS = 60;
/** Part des coups où un robot ne voit pas la réponse (il reste humain, il rate parfois). */
const BOT_MISS_RATE = 0.35;

const actionSchemas = {
  tap: z.object({ cardId: z.string().min(1).max(40) }),
};

/** Vrai si deux cartes se ressemblent selon le mode choisi pour le jeu. */
export function resembles(mode: CardGameDefinition['rules']['matchOn'], a: CardEntry, b: CardEntry): boolean {
  const sameFamily = a.family === b.family;
  const sameSymbol = a.symbol === b.symbol;
  if (mode === 'family') return sameFamily;
  if (mode === 'symbol') return sameSymbol;
  return sameFamily || sameSymbol;
}

function cardName(entry: CardEntry): string {
  return entry.label || entry.text?.slice(0, 24) || entry.symbol;
}

function entryMap(def: CardGameDefinition): Map<string, CardEntry> {
  return new Map(def.cards.map((c) => [c.id, c]));
}

export function createRaceGame(def: CardGameDefinition, options: { id: string }): GameModule<RaceState, CardSettings> {
  const { rules } = def;
  const settingsSchema = cardSettingsSchema({ targetScore: rules.targetScore, turnSeconds: rules.turnSeconds });
  const defaultSettings: CardSettings = { targetScore: rules.targetScore, turnSeconds: rules.turnSeconds };

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
    durationMin: Math.max(5, Math.round(rules.targetScore / 20)),
    notice: def.notice,
  };

  function who(s: RaceState, id: string): string {
    return s.names[id] ?? '?';
  }

  /** Vrai si un joueur connecté (ou n'importe qui, si personne n'est connecté) a une carte qui répond au centre. */
  function canAnswer(s: RaceState, ctx: GameContext): boolean {
    if (!s.center) return false;
    const entries = entryMap(s.def);
    const centerEntry = entries.get(s.center.entry);
    if (!centerEntry) return false;
    const connected = new Set(ctx.connectedPlayerIds());
    return s.order.some((pid) => {
      if (connected.size > 0 && !connected.has(pid)) return false;
      return (s.hands[pid] ?? []).some((c) => {
        const e = entries.get(c.entry);
        return e !== undefined && resembles(s.def.rules.matchOn, e, centerEntry);
      });
    });
  }

  function stopTimers(s: RaceState, ctx: GameContext): void {
    ctx.cancel(TURN);
    ctx.cancel(NEXT_ROUND);
    for (const pid of s.order) ctx.cancel(UNLOCK_PREFIX + pid);
    s.turnEndsAt = null;
  }

  function finish(s: RaceState, ctx: GameContext): void {
    stopTimers(s, ctx);
    s.phase = 'final';
    const best = Math.max(0, ...s.order.map((id) => s.scores[id] ?? 0));
    const leaders = s.order.filter((id) => (s.scores[id] ?? 0) === best).map((id) => who(s, id));
    s.lastEvent =
      leaders.length === 1
        ? `${leaders[0]} gagne la partie avec ${best} points !`
        : `Égalité entre ${leaders.join(' et ')} avec ${best} points.`;
  }

  function endRound(s: RaceState, ctx: GameContext, winner: string | null): void {
    ctx.cancel(TURN);
    s.turnEndsAt = null;
    s.roundWinner = winner;
    s.lastEvent = winner
      ? `${who(s, winner)} vide sa main et termine la manche.`
      : 'Plus aucune carte ne va avec le centre : manche sans gagnant.';
    if (s.round >= MAX_ROUNDS) {
      finish(s, ctx);
      return;
    }
    s.phase = 'round-over';
    ctx.schedule(NEXT_ROUND, NEXT_ROUND_MS);
  }

  /** Lance le délai avant changement de la carte centrale (ou aucun délai si `turnSeconds` vaut 0). */
  function beginCenter(s: RaceState, ctx: GameContext): void {
    ctx.cancel(TURN);
    const ms = s.settings.turnSeconds * 1000;
    if (ms > 0 && s.center) {
      ctx.schedule(TURN, ms);
      s.turnEndsAt = ctx.now() + ms;
    } else {
      s.turnEndsAt = null;
    }
  }

  /** Après chaque changement : tant que personne ne répond, on pioche une nouvelle carte centrale. */
  function settleCenter(s: RaceState, ctx: GameContext): void {
    while (s.center && !canAnswer(s, ctx) && s.pile.length > 0) {
      s.center = s.pile.shift()!;
      s.lastEvent = 'Personne ne peut répondre : une nouvelle carte est posée au centre.';
    }
    if (!s.center || !canAnswer(s, ctx)) {
      endRound(s, ctx, null);
      return;
    }
    beginCenter(s, ctx);
  }

  function dealRound(s: RaceState, ctx: GameContext): void {
    s.round += 1;
    s.phase = 'play';
    s.roundWinner = null;
    s.locked = {};
    ctx.cancel(NEXT_ROUND);
    for (const pid of s.order) ctx.cancel(UNLOCK_PREFIX + pid);

    const copies: string[] = [];
    for (const c of s.def.cards) for (let i = 0; i < c.count; i++) copies.push(c.id);
    const deck = shuffle(copies, ctx.random).map((entry, i) => ({ uid: `r${s.round}-${i + 1}`, entry }));
    s.hands = {};
    for (const pid of s.order) s.hands[pid] = [];
    for (let i = 0; i < s.def.rules.handSize; i++) {
      for (const pid of s.order) {
        const card = deck.pop();
        if (card) s.hands[pid]!.push(card);
      }
    }
    s.pile = deck;
    s.center = s.pile.shift() ?? null;
    s.lastEvent = `Manche ${s.round} : touchez la carte de votre main qui ressemble à la carte du centre.`;
    settleCenter(s, ctx);
  }

  function initialize(settings: CardSettings, players: PlayerRef[]): RaceState {
    return {
      def,
      settings,
      started: false,
      order: players.map((p) => p.id),
      names: directory(players),
      hands: {},
      pile: [],
      center: null,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      locked: {},
      phase: 'play',
      round: 0,
      roundWinner: null,
      lastEvent: '',
      turnEndsAt: null,
    };
  }

  function onPlayerJoin(state: RaceState, player: PlayerRef): RaceState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id)) {
      s.order.push(player.id);
      s.scores[player.id] = 0;
    }
    return s;
  }

  function onPlayerLeave(state: RaceState, player: PlayerRef): RaceState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.scores[player.id];
    return s;
  }

  function start(state: RaceState, ctx: GameContext): GameResult<RaceState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length < rules.minPlayers) return fail(`Il faut au moins ${rules.minPlayers} joueurs.`);
    const s = structuredClone(state);
    s.started = true;
    dealRound(s, ctx);
    return ok(s);
  }

  function tap(s: RaceState, pid: string, cardId: string, ctx: GameContext): GameResult<RaceState> {
    if (s.phase !== 'play') return fail('La manche est terminée.');
    const lockedUntil = s.locked[pid] ?? 0;
    if (lockedUntil > ctx.now()) return fail('Votre touche est bloquée un instant.');
    const hand = s.hands[pid] ?? [];
    const card = hand.find((c) => c.uid === cardId);
    if (!card) return fail('Cette carte n’est pas dans votre main.');
    if (!s.center) return fail('Pas de carte au centre.');

    const entries = entryMap(s.def);
    const played = entries.get(card.entry);
    const centerEntry = entries.get(s.center.entry);
    if (!played || !centerEntry) return fail('Carte inconnue.');
    const name = who(s, pid);

    if (!resembles(s.def.rules.matchOn, played, centerEntry)) {
      s.locked[pid] = ctx.now() + RACE_LOCK_MS;
      ctx.schedule(UNLOCK_PREFIX + pid, RACE_LOCK_MS);
      s.lastEvent = `${name} se trompe avec « ${cardName(played)} ».`;
      return ok(s);
    }

    // Juste : le joueur prend la carte centrale, et sa carte devient le nouveau centre.
    s.scores[pid] = (s.scores[pid] ?? 0) + centerEntry.points;
    s.hands[pid] = hand.filter((c) => c.uid !== cardId);
    s.center = card;
    s.lastEvent = `${name} prend « ${cardName(centerEntry)} » (+${centerEntry.points}).`;
    if ((s.scores[pid] ?? 0) >= s.settings.targetScore) {
      finish(s, ctx);
      return ok(s);
    }
    if (s.hands[pid]!.length === 0) {
      endRound(s, ctx, pid);
      return ok(s);
    }
    settleCenter(s, ctx);
    return ok(s);
  }

  function handleAction(
    state: RaceState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<RaceState> {
    if (!state.started || !state.order.includes(player.id)) return fail('Vous ne participez pas à cette partie.');
    if (state.phase === 'final') return fail('La partie est terminée.');
    const s = structuredClone(state);
    switch (type) {
      case 'tap': {
        const { cardId } = payload as { cardId: string };
        return tap(s, player.id, cardId, ctx);
      }
      default:
        return fail('Action inconnue.');
    }
  }

  function onTimer(state: RaceState, key: string, ctx: GameContext): RaceState {
    if (!state.started || state.phase === 'final') return state;
    const s = structuredClone(state);
    if (key === NEXT_ROUND && s.phase === 'round-over') {
      dealRound(s, ctx);
      return s;
    }
    if (key === TURN && s.phase === 'play') {
      if (s.pile.length > 0) {
        s.center = s.pile.shift()!;
        s.lastEvent = 'Temps écoulé : la carte centrale change.';
      } else {
        s.lastEvent = 'Temps écoulé : personne ne répond.';
      }
      settleCenter(s, ctx);
      return s;
    }
    if (key.startsWith(UNLOCK_PREFIX)) {
      const pid = key.slice(UNLOCK_PREFIX.length);
      if ((s.locked[pid] ?? 0) <= ctx.now()) delete s.locked[pid];
    }
    return s;
  }

  function nextRound(state: RaceState, ctx: GameContext): RaceState {
    if (!state.started || state.phase !== 'round-over') return state;
    const s = structuredClone(state);
    dealRound(s, ctx);
    return s;
  }

  function calculateScores(state: RaceState) {
    const names = Object.fromEntries(state.order.map((id) => [id, state.names[id] ?? '?']));
    return rankEntries(names, state.scores);
  }

  function end(state: RaceState, ctx: GameContext): RaceState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    stopTimers(s, ctx);
    s.phase = 'final';
    s.lastEvent = 'Partie interrompue.';
    return s;
  }

  function getPublicState(state: RaceState) {
    return {
      kind: 'race' as const,
      phase: state.phase,
      started: state.started,
      def: state.def,
      settings: state.settings,
      order: state.order,
      names: state.names,
      scores: state.scores,
      round: state.round,
      roundWinner: state.roundWinner,
      center: state.center ? { uid: state.center.uid, entry: state.center.entry } : null,
      counts: Object.fromEntries(state.order.map((id) => [id, (state.hands[id] ?? []).length])),
      pileCount: state.pile.length,
      locked: { ...state.locked },
      lastEvent: state.lastEvent,
      turnEndsAt: state.turnEndsAt,
    };
  }

  function getPlayerState(state: RaceState, playerId: string) {
    const member = state.order.includes(playerId);
    return {
      spectator: !member,
      hand: member ? (state.hands[playerId] ?? []) : [],
      lockedUntil: state.locked[playerId] ?? 0,
      canTap: state.started && state.phase === 'play' && member,
    };
  }

  function isFinished(state: RaceState): boolean {
    return state.phase === 'final';
  }

  /** Robot : touche une carte qui répond au centre, en laissant passer parfois l'occasion. */
  function suggest(state: RaceState, playerId: string, random: () => number) {
    if (!state.started || state.phase !== 'play' || !state.center) return null;
    if (!state.order.includes(playerId)) return null;
    if ((state.locked[playerId] ?? 0) > Date.now()) return null;
    if (random() < BOT_MISS_RATE) return null;
    const entries = entryMap(state.def);
    const centerEntry = entries.get(state.center.entry);
    if (!centerEntry) return null;
    const match = (state.hands[playerId] ?? []).find((c) => {
      const e = entries.get(c.entry);
      return e !== undefined && resembles(state.def.rules.matchOn, e, centerEntry);
    });
    if (!match) return null;
    return { type: 'tap', payload: { cardId: match.uid }, key: `tap:${match.uid}:${state.center.uid}` };
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
