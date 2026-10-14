import { z } from 'zod';
import type { BotSuggestion, GameContext, GameManifest, GameModule, GameResult, PlayerRef } from '@partyhub/shared';
import { directory, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { POKER_DEFINITION, buildPots, evaluateBest, resolvePots, type HandValue } from './rules.js';

/**
 * Texas hold'em. Chaque main : blindes, deux cartes privées par joueur, puis
 * trois tours de mises (flop, turn, river). Les mises se font dans l'ordre des
 * places ; une relance rouvre les mises à ceux qui doivent encore répondre.
 * Les joueurs tapis ne peuvent gagner que les pots auxquels ils ont contribué.
 * Un joueur sans jetons est éliminé ; la partie s'arrête quand il n'en reste qu'un
 * ou quand le nombre de mains prévu est atteint (le plus de jetons gagne).
 *
 * Simplification : une relance incomplète (tapis insuffisant) rouvre les mises
 * comme une relance complète. Les points de classement sont les jetons.
 */

const TURN = 'turn';
const NEXT_HAND = 'next-hand';
const NEXT_HAND_MS = 6000;

export type PokerPhase = 'play' | 'hand-over' | 'final';
export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface PokerWinner {
  id: string;
  name: string;
  amount: number;
  /** Nom de la main gagnante (« Couleur »…), ou null si la main n'a pas été abattue. */
  hand: string | null;
}

export interface PokerState {
  started: boolean;
  settings: PokerSettings;
  order: string[];
  names: Record<string, string>;
  stacks: Record<string, number>;
  dealer: string | null;
  handNumber: number;
  phase: PokerPhase;
  street: PokerStreet;
  /** Joueurs ayant reçu des cartes pour cette main. */
  inHand: string[];
  /** Cartes privées de chaque joueur (identifiants de carte). */
  holes: Record<string, string[]>;
  deck: string[];
  board: string[];
  /** Mises du tour d'enchères en cours. */
  bets: Record<string, number>;
  /** Mises cumulées de la main (base des pots). */
  totals: Record<string, number>;
  folded: string[];
  allIn: string[];
  currentBet: number;
  lastRaise: number;
  /** Joueurs qui doivent encore agir pendant ce tour d'enchères. */
  pending: string[];
  turn: string | null;
  winners: PokerWinner[];
  /** Joueurs dont les cartes sont abattues au showdown. */
  revealed: string[];
  lastEvent: string;
  turnEndsAt: number | null;
}

export const pokerSettingsSchema = z.object({
  startingChips: z.number().int().min(100).max(100000).default(1000),
  smallBlind: z.number().int().min(1).max(10000).default(10),
  bigBlind: z.number().int().min(2).max(20000).default(20),
  turnSeconds: z.number().int().min(0).max(120).default(25),
  /** Nombre de mains avant la fin (0 = jusqu'à ce qu'il ne reste qu'un joueur). */
  hands: z.number().int().min(0).max(200).default(0),
});

export type PokerSettings = z.infer<typeof pokerSettingsSchema>;

const actionSchemas = {
  fold: z.any().optional(),
  check: z.any().optional(),
  call: z.any().optional(),
  allin: z.any().optional(),
  raise: z.object({ to: z.number().int().min(1).max(100_000_000) }),
};

/** Premier joueur après `from` (dans l'ordre circulaire) qui satisfait `pred`. */
function nextAfter(order: string[], from: string | null, pred: (id: string) => boolean): string | null {
  const n = order.length;
  if (n === 0) return null;
  const start = from === null ? -1 : order.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const id = order[(start + k + n) % n]!;
    if (pred(id)) return id;
  }
  return null;
}

/** Joueurs ayant encore une chance de gagner la main (non couchés). */
function live(s: PokerState): string[] {
  return s.inHand.filter((id) => !s.folded.includes(id));
}

/** Joueurs non couchés et non tapis : ceux qui peuvent encore miser. */
function active(s: PokerState): string[] {
  return live(s).filter((id) => !s.allIn.includes(id));
}

/** Joueurs ayant encore des jetons (pour une nouvelle main). */
function alive(s: PokerState): string[] {
  return s.order.filter((id) => (s.stacks[id] ?? 0) > 0);
}

function toCall(s: PokerState, id: string): number {
  return Math.max(0, s.currentBet - (s.bets[id] ?? 0));
}

/** Engage des jetons pour un joueur ; renvoie le montant réellement payé. */
function commit(s: PokerState, id: string, amount: number): number {
  const pay = Math.min(amount, s.stacks[id] ?? 0);
  s.stacks[id] = (s.stacks[id] ?? 0) - pay;
  s.bets[id] = (s.bets[id] ?? 0) + pay;
  s.totals[id] = (s.totals[id] ?? 0) + pay;
  if (s.stacks[id] === 0 && !s.allIn.includes(id)) s.allIn.push(id);
  return pay;
}

function setTurn(s: PokerState, ctx: GameContext, id: string | null): void {
  s.turn = id;
  ctx.cancel(TURN);
  const ms = s.settings.turnSeconds * 1000;
  if (id && ms > 0) {
    ctx.schedule(TURN, ms);
    s.turnEndsAt = ctx.now() + ms;
  } else {
    s.turnEndsAt = null;
  }
}

/** Joueurs de la main, dans l'ordre de jeu en commençant après le croupier. */
function seatsAfterDealer(s: PokerState): string[] {
  const start = s.dealer ? s.order.indexOf(s.dealer) : -1;
  const rotated = [...s.order.slice(start + 1), ...s.order.slice(0, start + 1)];
  return rotated.filter((id) => s.inHand.includes(id));
}

function beginHand(s: PokerState, ctx: GameContext): void {
  ctx.cancel(NEXT_HAND);
  const seated = alive(s);
  s.dealer = s.dealer === null ? seated[0]! : nextAfter(s.order, s.dealer, (id) => seated.includes(id))!;
  s.handNumber += 1;
  s.phase = 'play';
  s.street = 'preflop';
  s.inHand = seated;
  s.holes = {};
  s.board = [];
  s.bets = {};
  s.totals = {};
  s.folded = [];
  s.allIn = [];
  s.winners = [];
  s.revealed = [];
  for (const id of seated) {
    s.bets[id] = 0;
    s.totals[id] = 0;
  }

  // Heads-up : le croupier pose la petite blinde et joue en premier avant le flop.
  const heads = seated.length === 2;
  const sb = heads ? s.dealer! : nextAfter(s.order, s.dealer, (id) => seated.includes(id))!;
  const bb = nextAfter(s.order, sb, (id) => seated.includes(id))!;

  s.deck = shuffle(
    POKER_DEFINITION.cards.map((c) => c.id),
    ctx.random,
  );
  for (const id of seated) s.holes[id] = [];
  for (let round = 0; round < 2; round++) {
    for (const id of seated) s.holes[id]!.push(s.deck.pop()!);
  }

  s.lastRaise = s.settings.bigBlind;
  const paidSb = commit(s, sb, s.settings.smallBlind);
  const paidBb = commit(s, bb, s.settings.bigBlind);
  s.currentBet = Math.max(s.bets[sb] ?? 0, s.bets[bb] ?? 0);
  s.pending = active(s);
  s.lastEvent = `Main n°${s.handNumber} : ${s.names[s.dealer!]} est croupier. Blindes ${paidSb} et ${paidBb}.`;
  advance(s, ctx, bb);
}

function nextStreet(s: PokerState): void {
  if (s.street === 'preflop') {
    s.board.push(s.deck.pop()!, s.deck.pop()!, s.deck.pop()!);
    s.street = 'flop';
  } else if (s.street === 'flop') {
    s.board.push(s.deck.pop()!);
    s.street = 'turn';
  } else if (s.street === 'turn') {
    s.board.push(s.deck.pop()!);
    s.street = 'river';
  }
  for (const id of Object.keys(s.bets)) s.bets[id] = 0;
  s.currentBet = 0;
  s.lastRaise = s.settings.bigBlind;
  s.pending = active(s);
}

/**
 * Enchaîne après chaque action : tour suivant, tour d'enchères suivant, abattage
 * ou fin de main. `from` est le dernier joueur à avoir agi (ou le croupier).
 */
function advance(s: PokerState, ctx: GameContext, from: string | null): void {
  const inPlay = live(s);
  if (inPlay.length === 1) {
    uncontested(s, ctx, inPlay[0]!);
    return;
  }
  if (s.pending.length > 0) {
    setTurn(
      s,
      ctx,
      nextAfter(s.order, from, (id) => s.pending.includes(id)),
    );
    return;
  }
  if (s.street !== 'river' && active(s).length >= 2) {
    nextStreet(s);
    advance(s, ctx, s.dealer);
    return;
  }
  // Plus personne ne peut miser : on complète le tableau puis on abat les cartes.
  while (s.board.length < 5) s.board.push(s.deck.pop()!);
  showdown(s, ctx);
}

/** Tous les autres se sont couchés : le dernier gagne sans abattre ses cartes. */
function uncontested(s: PokerState, ctx: GameContext, winner: string): void {
  const pot = Object.values(s.totals).reduce((sum, v) => sum + v, 0);
  s.stacks[winner] = (s.stacks[winner] ?? 0) + pot;
  s.winners = [{ id: winner, name: s.names[winner] ?? '?', amount: pot, hand: null }];
  s.lastEvent = `${s.names[winner]} remporte ${pot} jetons : les autres se sont couchés.`;
  endHand(s, ctx);
}

function showdown(s: PokerState, ctx: GameContext): void {
  s.street = 'showdown';
  const contenders = live(s);
  const values: Record<string, HandValue> = {};
  for (const id of contenders) values[id] = evaluateBest([...s.holes[id]!, ...s.board]);

  const pots = buildPots(s.totals, s.folded);
  const { awards, hands } = resolvePots(pots, values, seatsAfterDealer(s));
  const winners: PokerWinner[] = [];
  for (const [id, amount] of Object.entries(awards)) {
    s.stacks[id] = (s.stacks[id] ?? 0) + amount;
    if (amount > 0) winners.push({ id, name: s.names[id] ?? '?', amount, hand: hands[id] ?? null });
  }
  s.winners = winners;
  s.revealed = contenders;
  const parts = winners.map((w) => `${w.name} +${w.amount}${w.hand ? ` (${w.hand})` : ''}`);
  s.lastEvent = `Abattage : ${parts.join(' · ')}.`;
  endHand(s, ctx);
}

function endHand(s: PokerState, ctx: GameContext): void {
  ctx.cancel(TURN);
  s.turn = null;
  s.turnEndsAt = null;
  s.pending = [];
  s.bets = {};
  s.totals = {};
  s.currentBet = 0;

  const seated = alive(s);
  const limitReached = s.settings.hands > 0 && s.handNumber >= s.settings.hands;
  if (seated.length <= 1 || limitReached) {
    s.phase = 'final';
    const leader = s.order.reduce((best, id) => ((s.stacks[id] ?? 0) > (s.stacks[best] ?? 0) ? id : best), s.order[0]!);
    s.lastEvent =
      seated.length <= 1
        ? `${s.names[seated[0] ?? leader]} remporte la partie.`
        : `Fin après ${s.handNumber} mains : ${s.names[leader]} a le plus de jetons.`;
  } else {
    s.phase = 'hand-over';
    ctx.schedule(NEXT_HAND, NEXT_HAND_MS);
  }
}

/** Applique une action de mise. Renvoie un message d'erreur, ou null si l'action est acceptée. */
function applyAction(s: PokerState, id: string, type: string, payload: unknown): string | null {
  const name = s.names[id] ?? '?';
  const need = toCall(s, id);

  if (type === 'fold') {
    s.folded.push(id);
    s.pending = s.pending.filter((p) => p !== id);
    s.lastEvent = `${name} se couche.`;
    return null;
  }

  if (type === 'check') {
    if (need > 0) return 'Vous ne pouvez pas checker : il faut suivre ou se coucher.';
    s.pending = s.pending.filter((p) => p !== id);
    s.lastEvent = `${name} checke.`;
    return null;
  }

  if (type === 'call') {
    if (need === 0) return 'Rien à suivre : vous pouvez checker.';
    const paid = commit(s, id, need);
    s.pending = s.pending.filter((p) => p !== id);
    s.lastEvent = (s.stacks[id] ?? 0) === 0 ? `${name} suit ${paid} et se retrouve tapis.` : `${name} suit ${paid}.`;
    return null;
  }

  if (type === 'allin' || type === 'raise') {
    const stack = s.stacks[id] ?? 0;
    const already = s.bets[id] ?? 0;
    const maxTo = already + stack;
    const target = type === 'allin' ? maxTo : (payload as { to: number }).to;
    if (stack === 0) return 'Vous n’avez plus de jetons.';
    if (target > maxTo) return 'Ce montant dépasse votre pile.';
    if (target <= s.currentBet) {
      // Tapis qui ne dépasse pas la mise : c'est un simple suivi.
      if (type === 'raise') return `Relance : il faut miser plus que ${s.currentBet}.`;
      commit(s, id, stack);
      s.pending = s.pending.filter((p) => p !== id);
      s.lastEvent = `${name} se retrouve tapis avec ${stack}.`;
      return null;
    }
    const isAllIn = target === maxTo;
    const minTo = s.currentBet + s.lastRaise;
    if (!isAllIn && target < minTo) return `Relance minimum : ${minTo} jetons.`;

    const increment = target - s.currentBet;
    commit(s, id, target - already);
    if (increment >= s.lastRaise) s.lastRaise = increment;
    s.currentBet = target;
    // Une relance rouvre les mises : les autres joueurs actifs doivent répondre à nouveau.
    s.pending = active(s).filter((p) => p !== id);
    s.lastEvent = isAllIn ? `${name} tapit à ${target}.` : `${name} relance à ${target}.`;
    return null;
  }

  return 'Action inconnue.';
}

export function createPokerGame(): GameModule<PokerState, PokerSettings> {
  const manifest: GameManifest = {
    id: 'poker',
    category: 'cartes',
    name: 'Poker',
    description: 'Texas hold’em : mises, bluff et meilleure main de cinq cartes.',
    icon: '♠️',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 8,
    durationMin: 30,
    notice: POKER_DEFINITION.notice,
  };

  function initialize(settings: PokerSettings, players: PlayerRef[]): PokerState {
    return {
      started: false,
      settings,
      order: players.map((p) => p.id),
      names: directory(players),
      stacks: Object.fromEntries(players.map((p) => [p.id, settings.startingChips])),
      dealer: null,
      handNumber: 0,
      phase: 'play',
      street: 'preflop',
      inHand: [],
      holes: {},
      deck: [],
      board: [],
      bets: {},
      totals: {},
      folded: [],
      allIn: [],
      currentBet: 0,
      lastRaise: settings.bigBlind,
      pending: [],
      turn: null,
      winners: [],
      revealed: [],
      lastEvent: '',
      turnEndsAt: null,
    };
  }

  function onPlayerJoin(state: PokerState, player: PlayerRef): PokerState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id) && s.order.length < manifest.maxPlayers) {
      s.order.push(player.id);
      s.stacks[player.id] = s.settings.startingChips;
    }
    return s;
  }

  function onPlayerLeave(state: PokerState, player: PlayerRef): PokerState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.stacks[player.id];
    return s;
  }

  function start(state: PokerState, ctx: GameContext): GameResult<PokerState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length < manifest.minPlayers) return fail(`Il faut au moins ${manifest.minPlayers} joueurs.`);
    const s = structuredClone(state);
    if (alive(s).length < 2) return fail('Il faut au moins deux joueurs avec des jetons.');
    s.started = true;
    beginHand(s, ctx);
    return ok(s);
  }

  function handleAction(
    state: PokerState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<PokerState> {
    const s = structuredClone(state);
    const pid = player.id;
    if (!s.started || !s.inHand.includes(pid)) return fail('Vous ne participez pas à cette main.');
    if (s.phase !== 'play') return fail('La main est terminée.');
    if (s.turn !== pid) return fail("Ce n'est pas votre tour.");
    if (s.folded.includes(pid)) return fail('Vous êtes couché.');
    const error = applyAction(s, pid, type, payload);
    if (error) return fail(error);
    advance(s, ctx, pid);
    return ok(s);
  }

  function nextHand(state: PokerState, ctx: GameContext): PokerState {
    if (state.phase !== 'hand-over') return state;
    const s = structuredClone(state);
    beginHand(s, ctx);
    return s;
  }

  function onTimer(state: PokerState, key: string, ctx: GameContext): PokerState {
    if (key === NEXT_HAND) return nextHand(state, ctx);
    if (key !== TURN || !state.started || state.phase !== 'play' || !state.turn) return state;
    const s = structuredClone(state);
    const id = s.turn!;
    // Temps écoulé : on checke si c'est gratuit, sinon on se couche.
    const error = applyAction(s, id, toCall(s, id) === 0 ? 'check' : 'fold', undefined);
    if (error) return state;
    s.lastEvent = `Temps écoulé : ${s.lastEvent}`;
    advance(s, ctx, id);
    return s;
  }

  function calculateScores(state: PokerState) {
    const names = Object.fromEntries(state.order.map((id) => [id, state.names[id] ?? '?']));
    return rankEntries(names, state.stacks);
  }

  function end(state: PokerState, ctx: GameContext): PokerState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    ctx.cancel(TURN);
    ctx.cancel(NEXT_HAND);
    s.turn = null;
    s.turnEndsAt = null;
    s.phase = 'final';
    s.lastEvent = 'Partie interrompue.';
    return s;
  }

  function getPublicState(state: PokerState) {
    const pot = Object.values(state.totals).reduce((sum, v) => sum + v, 0);
    const revealed = Object.fromEntries(state.revealed.map((id) => [id, state.holes[id] ?? []]));
    return {
      phase: state.phase,
      started: state.started,
      settings: state.settings,
      order: state.order,
      names: state.names,
      stacks: state.stacks,
      dealer: state.dealer,
      handNumber: state.handNumber,
      street: state.street,
      board: state.board,
      bets: state.bets,
      pot,
      folded: state.folded,
      allIn: state.allIn,
      inHand: state.inHand,
      current: state.phase === 'play' ? state.turn : null,
      currentBet: state.currentBet,
      minRaiseTo: state.currentBet + state.lastRaise,
      winners: state.winners,
      revealed,
      lastEvent: state.lastEvent,
      turnEndsAt: state.turnEndsAt,
    };
  }

  function getPlayerState(state: PokerState, playerId: string) {
    const inHand = state.inHand.includes(playerId);
    const folded = state.folded.includes(playerId);
    const hole = inHand && !folded ? (state.holes[playerId] ?? []) : [];
    const myTurn = state.phase === 'play' && state.turn === playerId;
    const need = myTurn ? toCall(state, playerId) : 0;
    const stack = state.stacks[playerId] ?? 0;
    const maxTo = (state.bets[playerId] ?? 0) + stack;
    return {
      hole: hole.map((id) => ({ uid: id, entry: id })),
      stack,
      bet: state.bets[playerId] ?? 0,
      folded,
      spectator: state.started && !inHand,
      isMyTurn: myTurn,
      canCheck: myTurn && need === 0,
      canCall: myTurn && need > 0,
      callAmount: Math.min(need, stack),
      canRaise: myTurn && maxTo > state.currentBet,
      minRaiseTo: Math.min(maxTo, state.currentBet + state.lastRaise),
      maxRaiseTo: maxTo,
      canAllIn: myTurn && stack > 0,
    };
  }

  function isFinished(state: PokerState): boolean {
    return state.phase === 'final';
  }

  /** Robot prudent : checke si c'est gratuit, suit les petites mises, sinon se couche. */
  function suggest(state: PokerState, playerId: string, random: () => number): BotSuggestion | null {
    if (state.phase !== 'play' || state.turn !== playerId) return null;
    const need = toCall(state, playerId);
    const stack = state.stacks[playerId] ?? 0;
    const key = `${state.handNumber}:${state.street}:${state.board.length}:${state.currentBet}:${playerId}`;
    if (need === 0) return { type: 'check', key };
    if (need <= stack * 0.25 || random() < 0.2) return { type: 'call', key };
    return { type: 'fold', key };
  }

  return {
    manifest,
    settingsSchema: pokerSettingsSchema,
    defaultSettings: pokerSettingsSchema.parse({}),
    actions: actionSchemas,
    initialize,
    onPlayerJoin,
    onPlayerLeave,
    start,
    handleAction,
    onTimer,
    nextRound: nextHand,
    calculateScores,
    end,
    getPublicState,
    getPlayerState,
    getHostState: getPublicState,
    isFinished,
    suggest,
  };
}

export const poker = createPokerGame();
