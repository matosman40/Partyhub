import { z } from 'zod';
import type {
  BotSuggestion,
  GameContext,
  GameManifest,
  GameModule,
  GameResult,
  PlayerRef,
  ScoreEntry,
} from '@partyhub/shared';
import { directory, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { handStrength } from './bot.js';
import { buildPots, cardLabel, fullDeck, settlePots, type PokerCard } from './rules.js';

/**
 * Poker Texas hold'em, à 2 à 8 joueurs, avec jetons. Chaque donne : blindes, deux cartes privées, puis
 * quatre tours de mise (avant le flop, flop, turn, river). Relance minimale = la dernière relance (au moins
 * la grosse blinde). Un tapis peut mettre un joueur à l’abri d’une relance : les pots latéraux distribuent
 * alors chaque palier aux seuls joueurs qui y ont contribué.
 *
 * La partie dure `hands` donnes, ou jusqu’à ce qu’un seul joueur ait encore des jetons. Le classement se fait
 * sur les jetons. Les cartes privées ne sortent jamais de la vue du joueur, sauf au showdown.
 */

const TURN = 'turn';
const ABSENT = 'absent';
const NEXT_HAND = 'next-hand';
const NEXT_HAND_MS = 7000;
/** Délai avant de jouer à la place d’un joueur absent (laisse le temps à la vue de se mettre à jour). */
const ABSENT_MS = 400;

export const pokerSettingsSchema = z.object({
  startingChips: z.number().int().min(100).max(10000).default(1000),
  bigBlind: z.number().int().min(2).max(1000).default(20),
  hands: z.number().int().min(1).max(50).default(10),
  turnSeconds: z.number().int().min(0).max(60).default(30),
});

export type PokerSettings = z.infer<typeof pokerSettingsSchema>;

export type PokerPhase = 'waiting' | 'betting' | 'hand-over' | 'final';
export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface PokerResult {
  winners: { pid: string; amount: number; hand: string | null }[];
  /** Cartes des joueurs restés en jeu, révélées au showdown seulement. */
  reveals: Record<string, PokerCard[]>;
  board: PokerCard[];
  byFold: boolean;
}

export interface PokerState {
  settings: PokerSettings;
  started: boolean;
  order: string[];
  names: Record<string, string>;
  /** Jetons hors du pot, par joueur. */
  chips: Record<string, number>;
  phase: PokerPhase;
  street: PokerStreet;
  /** Numéro de la donne en cours (0 avant la première). */
  hand: number;
  /** Index dans `order` du bouton (-1 avant la première donne). */
  dealer: number;
  deck: PokerCard[];
  holes: Record<string, PokerCard[]>;
  board: PokerCard[];
  /** Participe à la donne en cours (a reçu des cartes). */
  inHand: Record<string, boolean>;
  folded: Record<string, boolean>;
  allIn: Record<string, boolean>;
  /** Total mis dans le pot pendant la donne. */
  committed: Record<string, number>;
  /** Mise de la rue en cours. */
  streetBet: Record<string, number>;
  /** A déjà agi pendant la rue, depuis la dernière relance complète. */
  acted: Record<string, boolean>;
  /** Plus haute mise de la rue. */
  currentBet: number;
  /** Taille minimale d’une relance. */
  minRaise: number;
  /** Faux après une relance incomplète (tapis court) : ceux qui ont déjà agi ne peuvent plus relancer. */
  reopen: boolean;
  /** Index dans `order` du joueur qui doit agir, ou -1. */
  toAct: number;
  result: PokerResult | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

const actionSchemas = {
  fold: z.any().optional(),
  check: z.any().optional(),
  call: z.any().optional(),
  allin: z.any().optional(),
  bet: z.object({ amount: z.number().int().min(1).max(10_000_000) }),
};

const mod = (n: number, m: number) => ((n % m) + m) % m;
const who = (s: PokerState, pid: string) => s.names[pid] ?? '?';
const sum = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);

/** Joueurs encore dans la donne (ni couchés, ni sortis). */
function inPlay(s: PokerState): string[] {
  return s.order.filter((p) => s.inHand[p] && !s.folded[p]);
}

/** Peut agir maintenant : en jeu, pas à tapis, et il reste à suivre ou à répondre à une relance. */
function canAct(s: PokerState, pid: string): boolean {
  return (
    !!s.inHand[pid] && !s.folded[pid] && !s.allIn[pid] && (!s.acted[pid] || (s.streetBet[pid] ?? 0) < s.currentBet)
  );
}

/** Joueur suivant, dans l’ordre des tours, qui peut agir. -1 s’il n’y en a pas. */
function nextActor(s: PokerState, from: number): number {
  const n = s.order.length;
  for (let k = 1; k <= n; k++) {
    const i = mod(from + k, n);
    if (canAct(s, s.order[i]!)) return i;
  }
  return -1;
}

/** La rue est finie quand plus personne ne doit agir, ou quand il ne reste qu’un joueur sans personne à qui répondre. */
function streetComplete(s: PokerState): boolean {
  const actors = s.order.filter((p) => canAct(s, p));
  if (actors.length === 0) return true;
  if (actors.length === 1) {
    const only = actors[0]!;
    const others = inPlay(s).filter((p) => p !== only);
    if (others.every((p) => s.allIn[p]) && (s.streetBet[only] ?? 0) >= s.currentBet) return true;
  }
  return false;
}

/** Met des jetons dans le pot de la rue. Le joueur passe à tapis s’il ne lui reste rien. */
function post(s: PokerState, pid: string, amount: number): number {
  const pay = Math.min(amount, s.chips[pid] ?? 0);
  s.chips[pid] = (s.chips[pid] ?? 0) - pay;
  s.committed[pid] = (s.committed[pid] ?? 0) + pay;
  s.streetBet[pid] = (s.streetBet[pid] ?? 0) + pay;
  if (s.chips[pid] === 0) s.allIn[pid] = true;
  return pay;
}

function clearTurn(s: PokerState, ctx: GameContext): void {
  ctx.cancel(TURN);
  ctx.cancel(ABSENT);
  s.turnEndsAt = null;
}

/** Démarre le minuteur du tour. Un joueur absent est joué tout de suite à sa place. */
function setTurn(s: PokerState, ctx: GameContext): void {
  clearTurn(s, ctx);
  if (s.toAct < 0) return;
  const pid = s.order[s.toAct]!;
  const connected = new Set(ctx.connectedPlayerIds());
  if (connected.size > 0 && !connected.has(pid)) {
    ctx.schedule(ABSENT, ABSENT_MS);
    return;
  }
  const ms = s.settings.turnSeconds * 1000;
  if (ms > 0) {
    ctx.schedule(TURN, ms);
    s.turnEndsAt = ctx.now() + ms;
  }
}

function finish(s: PokerState, ctx: GameContext): void {
  clearTurn(s, ctx);
  ctx.cancel(NEXT_HAND);
  s.phase = 'final';
  s.toAct = -1;
  const best = Math.max(0, ...s.order.map((p) => s.chips[p] ?? 0));
  const leaders = s.order.filter((p) => (s.chips[p] ?? 0) === best).map((p) => who(s, p));
  s.lastEvent =
    leaders.length === 1
      ? `${leaders[0]} gagne la partie avec ${best} jetons !`
      : `Égalité entre ${leaders.join(' et ')} avec ${best} jetons.`;
}

function startHand(s: PokerState, ctx: GameContext): void {
  const n = s.order.length;
  const seated = s.order.filter((p) => (s.chips[p] ?? 0) > 0);
  if (seated.length < 2) {
    finish(s, ctx);
    return;
  }
  s.hand += 1;
  // Le bouton passe au siège suivant encore en jeu.
  for (let k = 1; k <= n; k++) {
    const i = mod(s.dealer + k, n);
    if (seated.includes(s.order[i]!)) {
      s.dealer = i;
      break;
    }
  }
  // Les participants, à partir de la gauche du bouton ; le bouton est le dernier.
  const after = Array.from({ length: n }, (_, k) => s.order[mod(s.dealer + k + 1, n)]!).filter((p) =>
    seated.includes(p),
  );
  const sbPid = seated.length === 2 ? s.order[s.dealer]! : after[0]!;
  const bbPid = seated.length === 2 ? after[0]! : after[1]!;

  s.deck = shuffle(fullDeck(), ctx.random);
  s.board = [];
  s.result = null;
  s.street = 'preflop';
  s.phase = 'betting';
  s.holes = {};
  s.inHand = {};
  s.folded = {};
  s.allIn = {};
  s.committed = {};
  s.streetBet = {};
  s.acted = {};
  for (const p of s.order) {
    s.holes[p] = [];
    s.inHand[p] = seated.includes(p);
    s.folded[p] = false;
    s.allIn[p] = false;
    s.committed[p] = 0;
    s.streetBet[p] = 0;
    s.acted[p] = false;
  }
  for (let round = 0; round < 2; round++) {
    for (const p of after) s.holes[p]!.push(s.deck.pop()!);
  }

  const small = post(s, sbPid, Math.floor(s.settings.bigBlind / 2));
  const big = post(s, bbPid, s.settings.bigBlind);
  s.currentBet = Math.max(s.streetBet[sbPid] ?? 0, s.streetBet[bbPid] ?? 0);
  s.minRaise = s.settings.bigBlind;
  s.reopen = true;
  s.lastEvent = `Donne ${s.hand} : ${who(s, sbPid)} pose ${small} (petite blinde), ${who(s, bbPid)} pose ${big} (grosse blinde).`;

  s.toAct = nextActor(s, s.order.indexOf(bbPid));
  if (streetComplete(s) || s.toAct < 0) {
    advance(s, ctx);
  } else {
    setTurn(s, ctx);
  }
}

/** Passe à la rue suivante : remise à zéro des mises, puis cartes communes. */
function dealStreet(s: PokerState): void {
  s.streetBet = Object.fromEntries(s.order.map((p) => [p, 0]));
  s.acted = Object.fromEntries(s.order.map((p) => [p, false]));
  s.currentBet = 0;
  s.minRaise = s.settings.bigBlind;
  s.reopen = true;
  if (s.street === 'preflop') {
    s.street = 'flop';
    s.board.push(s.deck.pop()!, s.deck.pop()!, s.deck.pop()!);
  } else if (s.street === 'flop') {
    s.street = 'turn';
    s.board.push(s.deck.pop()!);
  } else if (s.street === 'turn') {
    s.street = 'river';
    s.board.push(s.deck.pop()!);
  }
  if (s.street === 'flop' || s.street === 'turn' || s.street === 'river') {
    const label = s.street === 'flop' ? 'Flop' : s.street === 'turn' ? 'Turn' : 'River';
    s.lastEvent = `${label} : ${s.board.map(cardLabel).join(' ')}.`;
  }
}

/** Quand la rue est finie : on ouvre la suivante, on abat les cartes, ou on sert le showdown. */
function advance(s: PokerState, ctx: GameContext): void {
  clearTurn(s, ctx);
  s.toAct = -1;
  for (;;) {
    if (s.street === 'river') {
      showdown(s, ctx);
      return;
    }
    dealStreet(s);
    if (!streetComplete(s)) {
      s.toAct = nextActor(s, s.dealer);
      if (s.toAct < 0) continue;
      setTurn(s, ctx);
      return;
    }
  }
}

function showdown(s: PokerState, ctx: GameContext): void {
  clearTurn(s, ctx);
  s.toAct = -1;
  s.street = 'showdown';
  const live = inPlay(s);
  const pots = buildPots(s.committed, live);
  const { payouts, awards } = settlePots(pots, s.holes, s.board, s.order, s.dealer);
  for (const [pid, amount] of Object.entries(payouts)) s.chips[pid] = (s.chips[pid] ?? 0) + amount;
  s.result = {
    winners: awards.map((a) => ({ pid: a.pid, amount: a.amount, hand: a.hand })),
    reveals: Object.fromEntries(live.map((p) => [p, s.holes[p] ?? []])),
    board: [...s.board],
    byFold: false,
  };
  s.phase = 'hand-over';
  s.lastEvent = awards
    .map((a) => `${who(s, a.pid)} gagne ${a.amount}${a.hand ? ` avec ${a.hand.toLowerCase()}` : ''}`)
    .join(' · ')
    .concat('.');
  ctx.schedule(NEXT_HAND, NEXT_HAND_MS);
}

/** Tous les autres se sont couchés : le dernier joueur prend le pot sans montrer ses cartes. */
function endUncontested(s: PokerState, ctx: GameContext): void {
  clearTurn(s, ctx);
  s.toAct = -1;
  const [winner] = inPlay(s);
  const pot = sum(s.committed);
  if (winner) s.chips[winner] = (s.chips[winner] ?? 0) + pot;
  s.result = {
    winners: winner ? [{ pid: winner, amount: pot, hand: null }] : [],
    reveals: {},
    board: [...s.board],
    byFold: true,
  };
  s.phase = 'hand-over';
  s.lastEvent = winner ? `${who(s, winner)} remporte ${pot} jetons sans abattre ses cartes.` : 'Donne terminée.';
  ctx.schedule(NEXT_HAND, NEXT_HAND_MS);
}

/**
 * Relance à `total` (mise totale de la rue). Renvoie un message d’erreur, ou null si la mise est acceptée.
 * La relance est complète si elle égale au moins la relance minimale ; une relance plus petite ne vaut que
 * pour un tapis, et ferme la relance aux joueurs qui ont déjà agi.
 */
function raiseTo(s: PokerState, pid: string, total: number): string | null {
  const streetBet = s.streetBet[pid] ?? 0;
  const maxTotal = streetBet + (s.chips[pid] ?? 0);
  if (total > maxTotal) return 'Vous n’avez pas assez de jetons.';
  if (total <= s.currentBet) return `La mise doit dépasser ${s.currentBet} jetons.`;
  const isAllIn = total === maxTotal;
  const raise = total - s.currentBet;
  if (!isAllIn && raise < s.minRaise) return `La relance minimum est de ${s.currentBet + s.minRaise} jetons.`;
  if (!s.reopen && s.acted[pid]) return 'La relance est fermée : vous pouvez seulement suivre ou vous coucher.';

  post(s, pid, total - streetBet);
  s.currentBet = total;
  if (raise >= s.minRaise) {
    s.minRaise = raise;
    s.reopen = true;
    for (const p of s.order) if (p !== pid) s.acted[p] = false;
  } else {
    s.reopen = false;
  }
  return null;
}

/** Applique une action de mise. Renvoie un message d’erreur, ou null. */
function act(s: PokerState, pid: string, type: string, payload: unknown): string | null {
  const name = who(s, pid);
  const streetBet = s.streetBet[pid] ?? 0;
  const toCall = s.currentBet - streetBet;
  switch (type) {
    case 'fold':
      s.folded[pid] = true;
      s.lastEvent = `${name} se couche.`;
      return null;
    case 'check':
      if (toCall > 0) return `Il faut suivre ${toCall} jetons ou se coucher.`;
      s.lastEvent = `${name} passe la parole.`;
      return null;
    case 'call': {
      if (toCall === 0) return 'Rien à suivre : passez la parole.';
      const pay = post(s, pid, toCall);
      s.lastEvent = `${name} suit ${pay}${s.allIn[pid] ? ' (tapis)' : ''}.`;
      return null;
    }
    case 'bet': {
      const { amount } = payload as { amount: number };
      const before = s.currentBet;
      const err = raiseTo(s, pid, amount);
      if (err) return err;
      s.lastEvent = before > 0 ? `${name} relance à ${amount}.` : `${name} mise ${amount}.`;
      return null;
    }
    case 'allin': {
      const total = streetBet + (s.chips[pid] ?? 0);
      if (total <= s.currentBet) {
        const pay = post(s, pid, s.chips[pid] ?? 0);
        s.lastEvent = `${name} suit au tapis avec ${pay}.`;
        return null;
      }
      const before = s.currentBet;
      const err = raiseTo(s, pid, total);
      if (err) return err;
      s.lastEvent = `${name} ${before > 0 ? 'relance' : 'mise'} tapis, ${total} jetons.`;
      return null;
    }
    default:
      return 'Action inconnue.';
  }
}

/** Après une action (ou un temps écoulé) : fin de donne, fin de rue, ou tour du joueur suivant. */
function afterAction(s: PokerState, ctx: GameContext, pid: string): void {
  s.acted[pid] = true;
  if (inPlay(s).length === 1) {
    endUncontested(s, ctx);
    return;
  }
  if (streetComplete(s)) {
    advance(s, ctx);
    return;
  }
  const next = nextActor(s, s.toAct);
  if (next < 0) {
    advance(s, ctx);
    return;
  }
  s.toAct = next;
  setTurn(s, ctx);
}

/** Action par défaut quand le temps passe : parole si on peut, sinon se coucher. */
function timeoutAction(s: PokerState, ctx: GameContext, reason: string): void {
  const pid = s.order[s.toAct]!;
  const toCall = s.currentBet - (s.streetBet[pid] ?? 0);
  if (toCall === 0) {
    s.lastEvent = `${reason} ${who(s, pid)} passe la parole.`;
  } else {
    s.folded[pid] = true;
    s.lastEvent = `${reason} ${who(s, pid)} se couche.`;
  }
  afterAction(s, ctx, pid);
}

export const pokerTexas: GameModule<PokerState, PokerSettings> = {
  manifest: {
    id: 'poker-texas',
    category: 'cartes',
    name: 'Poker Texas',
    description: 'Le poker Texas hold’em avec des jetons : blindes, mises, tapis et showdown.',
    icon: '♠️',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 8,
    durationMin: 20,
    notice: {
      goal: 'Être le joueur qui a le plus de jetons à la fin des donnes.',
      steps: [
        'Chacun reçoit deux cartes cachées. Les blindes sont posées par les deux joueurs à gauche du bouton.',
        'Mise à tour de rôle : se coucher, passer la parole, suivre, relancer ou aller tapis.',
        'Trois cartes communes (flop), puis une (turn), puis une (river), avec une mise à chaque fois.',
        'Au showdown, la meilleure main de cinq cartes parmi les sept emporte le pot.',
      ],
      tips: [
        'Une relance doit être au moins égale à la précédente.',
        'Quand un joueur part tapis, les pots latéraux ne peuvent être gagnés que par ceux qui ont mis autant.',
      ],
    },
  } satisfies GameManifest,

  settingsSchema: pokerSettingsSchema,
  defaultSettings: pokerSettingsSchema.parse({}),
  actions: actionSchemas,

  initialize(settings: PokerSettings, players: PlayerRef[]): PokerState {
    const s = pokerSettingsSchema.parse(settings);
    return {
      settings: s,
      started: false,
      order: players.map((p) => p.id),
      names: directory(players),
      chips: Object.fromEntries(players.map((p) => [p.id, s.startingChips])),
      phase: 'waiting',
      street: 'preflop',
      hand: 0,
      dealer: -1,
      deck: [],
      holes: {},
      board: [],
      inHand: {},
      folded: {},
      allIn: {},
      committed: {},
      streetBet: {},
      acted: {},
      currentBet: 0,
      minRaise: s.bigBlind,
      reopen: true,
      toAct: -1,
      result: null,
      lastEvent: '',
      turnEndsAt: null,
    };
  },

  onPlayerJoin(state: PokerState, player: PlayerRef): PokerState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id)) {
      s.order.push(player.id);
      s.chips[player.id] = s.settings.startingChips;
    }
    return s;
  },

  onPlayerLeave(state: PokerState, player: PlayerRef): PokerState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.chips[player.id];
    return s;
  },

  start(state: PokerState, ctx: GameContext): GameResult<PokerState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length < 2) return fail('Il faut au moins 2 joueurs.');
    const s = structuredClone(state);
    s.started = true;
    startHand(s, ctx);
    return ok(s);
  },

  handleAction(
    state: PokerState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<PokerState> {
    if (!state.started || !state.order.includes(player.id)) return fail('Vous ne participez pas à cette partie.');
    if (state.phase === 'final') return fail('La partie est terminée.');
    if (state.phase !== 'betting') return fail('Aucune mise en cours.');
    if (state.order[state.toAct] !== player.id) return fail('Ce n’est pas votre tour.');
    if (!['fold', 'check', 'call', 'bet', 'allin'].includes(type)) return fail('Action inconnue.');
    const s = structuredClone(state);
    const err = act(s, player.id, type, payload);
    if (err) return fail(err);
    afterAction(s, ctx, player.id);
    return ok(s);
  },

  onTimer(state: PokerState, key: string, ctx: GameContext): PokerState {
    if (!state.started || state.phase === 'final') return state;
    const s = structuredClone(state);
    if (key === NEXT_HAND && s.phase === 'hand-over') {
      ctx.cancel(NEXT_HAND);
      if (s.hand >= s.settings.hands) finish(s, ctx);
      else startHand(s, ctx);
      return s;
    }
    if ((key === TURN || key === ABSENT) && s.phase === 'betting' && s.toAct >= 0) {
      timeoutAction(s, ctx, key === TURN ? 'Temps écoulé :' : 'Joueur absent :');
      return s;
    }
    return s;
  },

  nextRound(state: PokerState, ctx: GameContext): PokerState {
    if (!state.started || state.phase !== 'hand-over') return state;
    const s = structuredClone(state);
    ctx.cancel(NEXT_HAND);
    if (s.hand >= s.settings.hands) finish(s, ctx);
    else startHand(s, ctx);
    return s;
  },

  calculateScores(state: PokerState): ScoreEntry[] {
    const names = Object.fromEntries(state.order.map((id) => [id, state.names[id] ?? '?']));
    return rankEntries(names, state.chips);
  },

  end(state: PokerState, ctx: GameContext): PokerState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    clearTurn(s, ctx);
    ctx.cancel(NEXT_HAND);
    s.phase = 'final';
    s.toAct = -1;
    s.lastEvent = 'Partie interrompue.';
    return s;
  },

  getPublicState: publicView,

  getPlayerState(state: PokerState, playerId: string) {
    const member = state.order.includes(playerId);
    const myTurn = state.phase === 'betting' && state.toAct >= 0 && state.order[state.toAct] === playerId;
    const bet = state.streetBet[playerId] ?? 0;
    const stack = state.chips[playerId] ?? 0;
    const toCall = Math.max(0, state.currentBet - bet);
    const maxTo = bet + stack;
    const minTo = Math.min(maxTo, state.currentBet + state.minRaise);
    return {
      spectator: !member,
      holes: member ? (state.holes[playerId] ?? []) : [],
      chips: stack,
      bet,
      folded: !!state.folded[playerId],
      isMyTurn: myTurn,
      toCall,
      callAmount: Math.min(toCall, stack),
      canCheck: myTurn && toCall === 0,
      canCall: myTurn && toCall > 0 && stack > 0,
      canRaise: myTurn && (state.reopen || !state.acted[playerId]) && maxTo > state.currentBet,
      minRaiseTo: minTo,
      maxRaiseTo: maxTo,
    };
  },

  getHostState: publicView,

  isFinished(state: PokerState): boolean {
    return state.phase === 'final';
  },

  /** Robot : parole, suivi, relance ou couché, selon la force de sa main et le coût pour rester. */
  suggest(state: PokerState, playerId: string, random: () => number): BotSuggestion | null {
    if (state.phase !== 'betting' || state.toAct < 0 || state.order[state.toAct] !== playerId) return null;
    const holes = state.holes[playerId] ?? [];
    const strength = handStrength(holes, state.board);
    const bet = state.streetBet[playerId] ?? 0;
    const toCall = state.currentBet - bet;
    const maxTo = bet + (state.chips[playerId] ?? 0);
    const minTo = state.currentBet + state.minRaise;
    const canRaise = (state.reopen || !state.acted[playerId]) && maxTo > state.currentBet;
    const pot = sum(state.committed);
    const key = `${state.hand}:${state.street}:${state.currentBet}:${bet}`;

    const raiseTo = (want: number): BotSuggestion => {
      if (want <= maxTo && want >= minTo) return { type: 'bet', payload: { amount: want }, key: `bet:${key}` };
      return { type: 'allin', key: `allin:${key}` };
    };

    if (toCall === 0) {
      if (strength > 0.62 && canRaise && random() < 0.75) {
        return raiseTo(Math.max(minTo, Math.round(pot * 0.6)));
      }
      return { type: 'check', key: `check:${key}` };
    }
    if (strength < 0.3 && toCall > state.settings.bigBlind && random() < 0.8) {
      return { type: 'fold', key: `fold:${key}` };
    }
    if (strength > 0.8 && canRaise && random() < 0.6) {
      return raiseTo(Math.max(minTo, Math.round(pot * 0.7)));
    }
    return { type: 'call', key: `call:${key}` };
  },
};

/** Vue visible par tous (écran principal et téléphones) : jamais les cartes privées, sauf au showdown. */
function publicView(state: PokerState) {
  const dealerId = state.dealer >= 0 ? (state.order[state.dealer] ?? null) : null;
  return {
    kind: 'poker' as const,
    phase: state.phase,
    street: state.street,
    started: state.started,
    settings: state.settings,
    order: state.order,
    names: state.names,
    /** Jetons de chacun : sert aussi au classement final. */
    scores: { ...state.chips },
    chips: { ...state.chips },
    hand: state.hand,
    handsLeft: Math.max(0, state.settings.hands - state.hand),
    dealerId,
    seats: state.order.map((pid) => ({
      id: pid,
      inHand: !!state.inHand[pid] && !state.folded[pid],
      folded: !!state.folded[pid],
      allIn: !!state.allIn[pid],
      bet: state.streetBet[pid] ?? 0,
      committed: state.committed[pid] ?? 0,
    })),
    pot: sum(state.committed),
    board: [...state.board],
    current: state.phase === 'betting' && state.toAct >= 0 ? (state.order[state.toAct] ?? null) : null,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    result: state.result,
    lastEvent: state.lastEvent,
    turnEndsAt: state.turnEndsAt,
  };
}
