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
import { directory, fail, ok, shuffle } from '../common/engine.js';
import { planDiscard, planLayoff, planMeld, planOpening } from './bot.js';
import {
  HAND_SIZE,
  RAMI_NOTICE,
  cardLabel,
  checkLayoff,
  checkMeld,
  checkOpening,
  checkSwap,
  fullDeck,
  handPenalty,
  isJoker,
  meldTitle,
  penaltyValue,
  type Meld,
  type MeldCard,
  type RamiCard,
} from './rules.js';

/**
 * Rami 51 (deux jeux de 52 cartes et 4 jokers, 2 à 5 joueurs). À son tour, on pioche
 * (pioche ou dessus de la défausse), on pose éventuellement, puis on défausse. Pour
 * ouvrir, on pose d’un coup au moins `openingPoints` points dont une tierce franche.
 * La manche s’arrête quand un joueur défausse sa dernière carte ; les autres marquent
 * leurs cartes en main (doublées en cas de rami sec). Le plus petit total gagne quand
 * un total atteint `targetScore`.
 *
 * Deux photos du tour sont gardées : au début du tour et juste après la pioche.
 * « Annuler » revient à la seconde (ou à la première si la carte venait de la défausse
 * et que rien n’a été posé) ; le temps écoulé s’en sert aussi.
 */

const TURN = 'turn';
const NEXT_ROUND = 'next-round';
const NEXT_ROUND_MS = 10_000;

export type RamiPhase = 'play' | 'round-over' | 'final';
export type DrawSource = 'deck' | 'discard';

/** Ce qui peut changer pendant un tour : de quoi revenir en arrière. */
interface TurnSnapshot {
  hand: RamiCard[];
  melds: Meld[];
  draw: RamiCard[];
  discard: RamiCard[];
  opened: boolean;
  drawn: DrawSource | null;
  mustUse: string[];
  openedThisTurn: boolean;
  tableActions: number;
}

export interface RamiRoundResult {
  /** Joueur qui a défaussé sa dernière carte, ou null (pioche épuisée). */
  winner: string | null;
  ramiSec: boolean;
  /** Mains restantes, révélées en fin de manche. */
  hands: Record<string, RamiCard[]>;
  /** Pénalités de la manche (déjà doublées en cas de rami sec). */
  penalties: Record<string, number>;
}

export interface RamiState {
  started: boolean;
  settings: RamiSettings;
  order: string[];
  names: Record<string, string>;
  hands: Record<string, RamiCard[]>;
  /** Pioche : la dernière carte est la prochaine piochée. */
  draw: RamiCard[];
  /** Défausse : la dernière carte est celle du dessus. */
  discard: RamiCard[];
  melds: Meld[];
  nextMeld: number;
  opened: Record<string, boolean>;
  round: number;
  /** Donneur de la manche (index dans `order`). */
  dealer: number;
  /** Joueur dont c’est le tour (index dans `order`). */
  turn: number;
  /** Pioche faite ce tour, et d’où. */
  drawn: DrawSource | null;
  /** Cartes à poser sur la table avant de défausser (prise de la défausse, joker récupéré). */
  mustUse: string[];
  /** Le joueur a ouvert pendant ce tour (rami sec s’il finit). */
  openedThisTurn: boolean;
  /** Poses faites depuis la pioche. */
  tableActions: number;
  startSnap: TurnSnapshot | null;
  drawSnap: TurnSnapshot | null;
  phase: RamiPhase;
  scores: Record<string, number>;
  roundWinner: string | null;
  ramiSec: boolean;
  result: RamiRoundResult | null;
  lastEvent: string;
  turnEndsAt: number | null;
  /** Compteur d’actions : change à chaque coup (clé des décisions des robots). */
  seq: number;
}

export const ramiSettingsSchema = z.object({
  targetScore: z.number().int().min(50).max(2000).default(500),
  openingPoints: z.number().int().min(0).max(120).default(51),
  turnSeconds: z.number().int().min(0).max(180).default(90),
});

export type RamiSettings = z.infer<typeof ramiSettingsSchema>;

const cardId = z.string().min(1).max(20);
const cardList = z.array(cardId).min(1).max(14);

const actionSchemas = {
  draw: z.object({ from: z.enum(['deck', 'discard']) }),
  open: z.object({ melds: z.array(cardList).min(1).max(8) }),
  meld: z.object({ cardIds: cardList }),
  layoff: z.object({ meldId: z.string().min(1).max(20), cardIds: cardList }),
  swap: z.object({ meldId: z.string().min(1).max(20), cardId }),
  discard: z.object({ cardId }),
  undo: z.any().optional(),
};

function who(s: RamiState, id: string | null): string {
  return id ? (s.names[id] ?? '?') : '?';
}

function currentId(s: RamiState): string {
  return s.order[s.turn]!;
}

/** « le 7♥ », « le joker ». */
function the(card: { entry: string }): string {
  return isJoker(card) ? 'le joker' : `le ${cardLabel(card.entry)}`;
}

function takeSnapshot(s: RamiState): TurnSnapshot {
  const id = currentId(s);
  return structuredClone({
    hand: s.hands[id] ?? [],
    melds: s.melds,
    draw: s.draw,
    discard: s.discard,
    opened: !!s.opened[id],
    drawn: s.drawn,
    mustUse: s.mustUse,
    openedThisTurn: s.openedThisTurn,
    tableActions: s.tableActions,
  });
}

function restoreSnapshot(s: RamiState, snap: TurnSnapshot): void {
  const id = currentId(s);
  const copy = structuredClone(snap);
  s.hands[id] = copy.hand;
  s.melds = copy.melds;
  s.draw = copy.draw;
  s.discard = copy.discard;
  s.opened[id] = copy.opened;
  s.drawn = copy.drawn;
  s.mustUse = copy.mustUse;
  s.openedThisTurn = copy.openedThisTurn;
  s.tableActions = copy.tableActions;
}

function armTimer(s: RamiState, ctx: GameContext): void {
  ctx.cancel(TURN);
  const ms = s.settings.turnSeconds * 1000;
  if (ms > 0) {
    ctx.schedule(TURN, ms);
    s.turnEndsAt = ctx.now() + ms;
  } else {
    s.turnEndsAt = null;
  }
}

function beginTurn(s: RamiState, index: number, ctx: GameContext): void {
  s.turn = index;
  s.drawn = null;
  s.mustUse = [];
  s.openedThisTurn = false;
  s.tableActions = 0;
  s.drawSnap = null;
  s.startSnap = takeSnapshot(s);
  armTimer(s, ctx);
}

/** Pioche vide : la défausse, sauf sa carte du dessus, est mélangée. Faux si c’est impossible. */
function refillDraw(s: RamiState, ctx: GameContext): boolean {
  if (s.draw.length > 0) return true;
  if (s.discard.length < 2) return false;
  const top = s.discard.pop()!;
  s.draw = shuffle(s.discard, ctx.random);
  s.discard = [top];
  return true;
}

/** Donne une manche : 13 cartes chacun, une carte retournée (jamais un joker), le joueur après le donneur commence. */
function dealRound(s: RamiState, ctx: GameContext): void {
  s.round += 1;
  const n = s.order.length;
  s.dealer = (s.round - 1) % n;
  const deck = shuffle(fullDeck(), ctx.random);
  s.hands = Object.fromEntries(s.order.map((id) => [id, [] as RamiCard[]]));
  for (let k = 0; k < HAND_SIZE; k++) {
    for (let i = 1; i <= n; i++) s.hands[s.order[(s.dealer + i) % n]!]!.push(deck.pop()!);
  }
  // Un joker retourné repart dans la pioche, glissé sous la carte du dessus, et on en retourne une autre.
  let top = deck.pop()!;
  while (isJoker(top)) {
    const at = Math.min(deck.length - 1, Math.floor(ctx.random() * deck.length));
    deck.splice(Math.max(0, at), 0, top);
    top = deck.pop()!;
  }
  s.discard = [top];
  s.draw = deck;
  s.melds = [];
  s.opened = Object.fromEntries(s.order.map((id) => [id, false]));
  s.result = null;
  s.roundWinner = null;
  s.ramiSec = false;
  s.phase = 'play';
  const first = (s.dealer + 1) % n;
  s.lastEvent = `Manche ${s.round} : ${who(s, s.order[s.dealer]!)} distribue, ${who(s, s.order[first]!)} commence.`;
  beginTurn(s, first, ctx);
}

/** Joueur au plus petit total (premier dans l’ordre en cas d’égalité). */
function leader(s: RamiState): string {
  return s.order.reduce((best, id) => ((s.scores[id] ?? 0) < (s.scores[best] ?? 0) ? id : best), s.order[0]!);
}

/** Fin de manche : pénalités (doublées en cas de rami sec), puis manche suivante ou fin de partie. */
function endRound(s: RamiState, ctx: GameContext, winner: string | null): void {
  ctx.cancel(TURN);
  s.turnEndsAt = null;
  const ramiSec = winner !== null && s.openedThisTurn;
  const penalties: Record<string, number> = {};
  for (const id of s.order) {
    const base = id === winner ? 0 : handPenalty(s.hands[id] ?? []);
    penalties[id] = ramiSec ? base * 2 : base;
    s.scores[id] = (s.scores[id] ?? 0) + penalties[id]!;
  }
  s.result = { winner, ramiSec, hands: structuredClone(s.hands), penalties };
  s.roundWinner = winner;
  s.ramiSec = ramiSec;
  s.startSnap = null;
  s.drawSnap = null;
  s.mustUse = [];

  const headline =
    winner === null
      ? 'Pioche épuisée : manche terminée sans gagnant.'
      : ramiSec
        ? `Rami sec ! ${who(s, winner)} ouvre et termine dans le même tour : pénalités doublées.`
        : `${who(s, winner)} termine la manche !`;
  const reached = s.order.some((id) => (s.scores[id] ?? 0) >= s.settings.targetScore);
  if (reached) {
    s.phase = 'final';
    const best = leader(s);
    s.lastEvent = `${headline} Fin de la partie : ${who(s, best)} gagne avec ${s.scores[best] ?? 0} points.`;
  } else {
    s.phase = 'round-over';
    s.lastEvent = headline;
    ctx.schedule(NEXT_ROUND, NEXT_ROUND_MS);
  }
}

/** Après une défausse : fin de manche si la main est vide, sinon tour suivant (pioche refaite au besoin). */
function finishTurn(s: RamiState, ctx: GameContext): void {
  const id = currentId(s);
  if ((s.hands[id] ?? []).length === 0) {
    endRound(s, ctx, id);
    return;
  }
  if (s.draw.length === 0) {
    if (!refillDraw(s, ctx)) {
      endRound(s, ctx, null);
      return;
    }
    s.lastEvent += ' La pioche est vide : la défausse est mélangée pour la remplacer.';
  }
  beginTurn(s, (s.turn + 1) % s.order.length, ctx);
}

/** Cartes de la main désignées par leurs identifiants, ou un message d’erreur. */
function pickFromHand(hand: RamiCard[], ids: readonly string[]): RamiCard[] | string {
  if (new Set(ids).size !== ids.length) return 'Une carte est choisie deux fois.';
  const cards: RamiCard[] = [];
  for (const id of ids) {
    const card = hand.find((c) => c.uid === id);
    if (!card) return 'Carte absente de votre main.';
    cards.push(card);
  }
  return cards;
}

function removeFromHand(s: RamiState, pid: string, uids: readonly string[]): void {
  const gone = new Set(uids);
  s.hands[pid] = (s.hands[pid] ?? []).filter((c) => !gone.has(c.uid));
  s.mustUse = s.mustUse.filter((u) => !gone.has(u));
}

/** On ne pose jamais sa dernière carte : elle sert à la défausse. */
const KEEP_ONE = 'Gardez au moins une carte en main pour la défausse.';

function addMeld(s: RamiState, pid: string, kind: Meld['kind'], cards: MeldCard[]): Meld {
  const meld: Meld = { id: `m${s.nextMeld}`, owner: pid, kind, cards };
  s.nextMeld += 1;
  s.melds.push(meld);
  return meld;
}

/** Message d’obligation non remplie avant la défausse, ou null. */
function pendingObligation(s: RamiState, pid: string): string | null {
  if (s.mustUse.length === 0) return null;
  const hand = s.hands[pid] ?? [];
  const first = hand.find((c) => s.mustUse.includes(c.uid));
  if (!first) return null;
  if (isJoker(first)) return 'Reposez d’abord le joker récupéré sur la table.';
  return `Posez d’abord ${the(first)} pris dans la défausse.`;
}

/** Applique une action du joueur dont c’est le tour. Renvoie un message d’erreur ou null. */
function apply(s: RamiState, pid: string, type: string, payload: unknown, ctx: GameContext): string | null {
  const name = who(s, pid);
  const hand = s.hands[pid] ?? [];

  if (type === 'draw') {
    if (s.drawn) return 'Vous avez déjà pioché ce tour-ci.';
    const { from } = payload as { from: DrawSource };
    if (from === 'discard') {
      const card = s.discard.pop();
      if (!card) return 'La défausse est vide.';
      hand.push(card);
      s.drawn = 'discard';
      s.mustUse = [card.uid];
      s.lastEvent = `${name} prend ${the(card)} de la défausse.`;
    } else {
      if (!refillDraw(s, ctx)) return 'La pioche est vide.';
      const card = s.draw.pop()!;
      hand.push(card);
      s.drawn = 'deck';
      s.lastEvent = `${name} pioche une carte.`;
    }
    s.hands[pid] = hand;
    s.drawSnap = takeSnapshot(s);
    return null;
  }

  if (type === 'undo') {
    if (!s.drawn) return 'Rien à annuler : vous n’avez pas encore pioché.';
    if (s.tableActions > 0 && s.drawSnap) {
      restoreSnapshot(s, s.drawSnap);
      s.lastEvent = `${name} reprend les cartes posées ce tour.`;
      return null;
    }
    if (s.drawn === 'discard' && s.startSnap) {
      const card = hand.find((c) => s.mustUse.includes(c.uid));
      restoreSnapshot(s, s.startSnap);
      s.drawSnap = null;
      s.lastEvent = card ? `${name} repose ${the(card)} sur la défausse.` : `${name} annule sa pioche.`;
      return null;
    }
    return 'Rien à annuler.';
  }

  if (!s.drawn) return 'Piochez d’abord une carte.';

  if (type === 'discard') {
    const { cardId } = payload as { cardId: string };
    const card = hand.find((c) => c.uid === cardId);
    if (!card) return 'Carte absente de votre main.';
    const pending = pendingObligation(s, pid);
    if (pending) return pending;
    removeFromHand(s, pid, [card.uid]);
    s.discard.push(card);
    s.lastEvent = `${name} défausse ${the(card)}.`;
    finishTurn(s, ctx);
    return null;
  }

  const opened = !!s.opened[pid];

  if (type === 'open') {
    if (opened) return 'Vous avez déjà ouvert : posez ou complétez directement.';
    const { melds } = payload as { melds: string[][] };
    const groups: RamiCard[][] = [];
    for (const ids of melds) {
      const cards = pickFromHand(hand, ids);
      if (typeof cards === 'string') return cards;
      groups.push(cards);
    }
    const check = checkOpening(groups, s.settings.openingPoints);
    if (!check.ok) return check.error ?? 'Ouverture refusée.';
    const laid = groups.flat();
    if (laid.length >= hand.length) return KEEP_ONE;
    for (const m of check.melds) if (m.ok) addMeld(s, pid, m.kind, m.cards);
    removeFromHand(
      s,
      pid,
      laid.map((c) => c.uid),
    );
    s.opened[pid] = true;
    s.openedThisTurn = true;
    s.tableActions += 1;
    const count = groups.length;
    s.lastEvent = `${name} ouvre avec ${check.points} points (${count} combinaison${count > 1 ? 's' : ''}).`;
    return null;
  }

  if (type === 'meld' || type === 'layoff' || type === 'swap') {
    if (!opened) {
      const what =
        type === 'meld'
          ? 'poser une combinaison'
          : type === 'layoff'
            ? 'compléter une combinaison'
            : 'échanger un joker';
      return `Ouvrez d’abord (${s.settings.openingPoints} points avec une tierce franche) pour ${what}.`;
    }
  }

  if (type === 'meld') {
    const { cardIds } = payload as { cardIds: string[] };
    const cards = pickFromHand(hand, cardIds);
    if (typeof cards === 'string') return cards;
    const check = checkMeld(cards);
    if (!check.ok) return check.error;
    if (cards.length >= hand.length) return KEEP_ONE;
    addMeld(s, pid, check.kind, check.cards);
    removeFromHand(s, pid, cardIds);
    s.tableActions += 1;
    s.lastEvent = `${name} pose : ${meldTitle(check.kind, check.cards)}.`;
    return null;
  }

  if (type === 'layoff') {
    const { meldId, cardIds } = payload as { meldId: string; cardIds: string[] };
    const meld = s.melds.find((m) => m.id === meldId);
    if (!meld) return 'Cette combinaison n’est plus sur la table.';
    const cards = pickFromHand(hand, cardIds);
    if (typeof cards === 'string') return cards;
    const check = checkLayoff(meld, cards);
    if (!check.ok) return check.error;
    if (cards.length >= hand.length) return KEEP_ONE;
    meld.cards = check.cards;
    removeFromHand(s, pid, cardIds);
    s.tableActions += 1;
    const owner = meld.owner === pid ? 'sa combinaison' : `la combinaison de ${who(s, meld.owner)}`;
    s.lastEvent = `${name} complète ${owner} avec ${cards.map((c) => cardLabel(c.entry)).join(' ')}.`;
    return null;
  }

  if (type === 'swap') {
    const { meldId, cardId } = payload as { meldId: string; cardId: string };
    const meld = s.melds.find((m) => m.id === meldId);
    if (!meld) return 'Cette combinaison n’est plus sur la table.';
    const card = hand.find((c) => c.uid === cardId);
    if (!card) return 'Carte absente de votre main.';
    const check = checkSwap(meld, card);
    if (!check.ok) return check.error;
    meld.cards = check.cards;
    removeFromHand(s, pid, [card.uid]);
    s.hands[pid]!.push(check.joker);
    s.mustUse = [...s.mustUse, check.joker.uid];
    s.tableActions += 1;
    s.lastEvent = `${name} récupère un joker en posant ${the(card)}.`;
    return null;
  }

  return 'Action inconnue.';
}

/** Carte la plus chère de la main, hors joker (le joker seulement s’il ne reste que lui). */
function highestCard(hand: readonly RamiCard[]): RamiCard | undefined {
  let best: RamiCard | undefined;
  for (const card of hand) {
    if (isJoker(card)) continue;
    if (!best || penaltyValue(card.entry) > penaltyValue(best.entry)) best = card;
  }
  return best ?? hand[0];
}

/**
 * Temps écoulé. Obligation non remplie ou carte prise dans la défausse : retour au début
 * du tour. Pas encore pioché : pioche. Puis défausse de la carte la plus chère (hors joker).
 */
function timeout(s: RamiState, ctx: GameContext): void {
  const id = currentId(s);
  const name = who(s, id);
  if (s.drawn && (s.mustUse.length > 0 || s.drawn === 'discard') && s.startSnap) {
    restoreSnapshot(s, s.startSnap);
    s.drawSnap = null;
  }
  let drew = false;
  if (!s.drawn) {
    if (!refillDraw(s, ctx)) {
      s.lastEvent = `Temps écoulé pour ${name}.`;
      endRound(s, ctx, null);
      return;
    }
    s.hands[id] = [...(s.hands[id] ?? []), s.draw.pop()!];
    s.drawn = 'deck';
    drew = true;
  }
  const card = highestCard(s.hands[id] ?? []);
  if (!card) {
    endRound(s, ctx, id);
    return;
  }
  removeFromHand(s, id, [card.uid]);
  s.mustUse = [];
  s.discard.push(card);
  s.lastEvent = `Temps écoulé : ${name} ${drew ? 'pioche et ' : ''}défausse ${the(card)}.`;
  finishTurn(s, ctx);
}

export function createRamiGame(): GameModule<RamiState, RamiSettings> {
  const manifest: GameManifest = {
    id: 'rami-51',
    category: 'cartes',
    name: 'Rami 51',
    description:
      'Le rami à la française : ouvrez à 51 avec une tierce franche, posez tout, et gardez le plus petit total.',
    icon: '♦️',
    version: '1.0.1',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 5,
    durationMin: 40,
    notice: RAMI_NOTICE,
  };

  function initialize(settings: RamiSettings, players: PlayerRef[]): RamiState {
    const parsed = ramiSettingsSchema.parse(settings ?? {});
    const order = players.map((p) => p.id).slice(0, manifest.maxPlayers);
    return {
      started: false,
      settings: parsed,
      order,
      names: directory(players),
      hands: {},
      draw: [],
      discard: [],
      melds: [],
      nextMeld: 1,
      opened: {},
      round: 0,
      dealer: 0,
      turn: 0,
      drawn: null,
      mustUse: [],
      openedThisTurn: false,
      tableActions: 0,
      startSnap: null,
      drawSnap: null,
      phase: 'play',
      scores: Object.fromEntries(order.map((id) => [id, 0])),
      roundWinner: null,
      ramiSec: false,
      result: null,
      lastEvent: '',
      turnEndsAt: null,
      seq: 0,
    };
  }

  function onPlayerJoin(state: RamiState, player: PlayerRef): RamiState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id) && s.order.length < manifest.maxPlayers) {
      s.order.push(player.id);
      s.scores[player.id] = 0;
    }
    return s;
  }

  function onPlayerLeave(state: RamiState, player: PlayerRef): RamiState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.scores[player.id];
    return s;
  }

  function start(state: RamiState, ctx: GameContext): GameResult<RamiState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length < manifest.minPlayers) return fail(`Il faut au moins ${manifest.minPlayers} joueurs.`);
    const s = structuredClone(state);
    s.started = true;
    s.round = 0;
    dealRound(s, ctx);
    s.seq += 1;
    return ok(s);
  }

  function handleAction(
    state: RamiState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<RamiState> {
    const pid = player.id;
    if (!state.started || !state.hands[pid]) return fail('Vous ne participez pas à cette manche.');
    if (state.phase !== 'play') return fail('La manche est terminée.');
    if (currentId(state) !== pid) return fail('Ce n’est pas votre tour.');
    if (!Object.hasOwn(actionSchemas, type)) return fail('Action inconnue.');
    const s = structuredClone(state);
    const error = apply(s, pid, type, payload, ctx);
    if (error) return fail(error);
    s.seq += 1;
    return ok(s);
  }

  function nextRound(state: RamiState, ctx: GameContext): RamiState {
    if (state.phase !== 'round-over') return state;
    const s = structuredClone(state);
    ctx.cancel(NEXT_ROUND);
    dealRound(s, ctx);
    s.seq += 1;
    return s;
  }

  function onTimer(state: RamiState, key: string, ctx: GameContext): RamiState {
    if (key === NEXT_ROUND) return nextRound(state, ctx);
    if (key !== TURN || !state.started || state.phase !== 'play') return state;
    const s = structuredClone(state);
    timeout(s, ctx);
    s.seq += 1;
    return s;
  }

  /** Classement croissant : le plus petit total est premier (ex æquo au même rang). */
  function calculateScores(state: RamiState): ScoreEntry[] {
    const rows = state.order.map((id) => ({
      playerId: id,
      name: state.names[id] ?? '?',
      points: state.scores[id] ?? 0,
    }));
    rows.sort((a, b) => a.points - b.points || a.name.localeCompare(b.name, 'fr'));
    return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.points < r.points).length }));
  }

  function end(state: RamiState, ctx: GameContext): RamiState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    ctx.cancel(TURN);
    ctx.cancel(NEXT_ROUND);
    s.turnEndsAt = null;
    s.phase = 'final';
    s.lastEvent = 'Partie interrompue.';
    s.seq += 1;
    return s;
  }

  function getPublicState(state: RamiState) {
    const playing = state.started && state.phase === 'play';
    const top = state.discard[state.discard.length - 1] ?? null;
    return {
      phase: state.phase,
      started: state.started,
      settings: state.settings,
      round: state.round,
      order: state.order,
      names: state.names,
      scores: state.scores,
      dealer: state.started ? (state.order[state.dealer] ?? null) : null,
      current: playing ? currentId(state) : null,
      /** Le joueur dont c’est le tour a pioché (et d’où) : visible de tous à la table. */
      drawn: playing ? state.drawn : null,
      counts: Object.fromEntries(state.order.map((id) => [id, state.hands[id]?.length ?? 0])),
      opened: Object.fromEntries(state.order.map((id) => [id, !!state.opened[id]])),
      melds: state.melds,
      discardTop: top ? { uid: top.uid, entry: top.entry } : null,
      discardCount: state.discard.length,
      drawCount: state.draw.length,
      roundWinner: state.roundWinner,
      ramiSec: state.ramiSec,
      // Les mains ne sont révélées qu’en fin de manche.
      result: state.phase !== 'play' ? state.result : null,
      lastEvent: state.lastEvent,
      turnEndsAt: state.turnEndsAt,
    };
  }

  function getPlayerState(state: RamiState, playerId: string) {
    const hand = state.hands[playerId] ?? [];
    const myTurn = state.started && state.phase === 'play' && currentId(state) === playerId;
    return {
      hand,
      spectator: state.started ? !state.order.includes(playerId) : false,
      isMyTurn: myTurn,
      hasDrawn: myTurn && state.drawn !== null,
      drewFrom: myTurn ? state.drawn : null,
      canTakeDiscard: myTurn && state.drawn === null && state.discard.length > 0,
      canUndo: myTurn && state.drawn !== null && (state.tableActions > 0 || state.drawn === 'discard'),
      opened: !!state.opened[playerId],
      mustUse: myTurn ? state.mustUse : [],
      openingPoints: state.settings.openingPoints,
    };
  }

  function isFinished(state: RamiState): boolean {
    return state.phase === 'final';
  }

  /**
   * Robot : pioche dans la pioche ; sans ouverture, cherche des combinaisons disjointes
   * qui atteignent le seuil avec une tierce franche ; ouvert, pose ses combinaisons puis
   * complète la table ; enfin défausse sa carte la plus chère hors ébauche de combinaison.
   */
  function suggest(state: RamiState, playerId: string): BotSuggestion | null {
    if (!state.started || state.phase !== 'play' || currentId(state) !== playerId) return null;
    const key = `${state.round}:${state.seq}`;
    if (!state.drawn) return { type: 'draw', payload: { from: 'deck' }, key };
    if (state.mustUse.length > 0) return { type: 'undo', key };
    const hand = state.hands[playerId] ?? [];
    if (!state.opened[playerId]) {
      const plan = planOpening(hand, state.settings.openingPoints);
      if (plan) return { type: 'open', payload: { melds: plan.map((m) => m.map((c) => c.uid)) }, key };
    } else {
      const meld = planMeld(hand);
      if (meld) return { type: 'meld', payload: { cardIds: meld.map((c) => c.uid) }, key };
      const layoff = planLayoff(hand, state.melds);
      if (layoff) return { type: 'layoff', payload: layoff, key };
    }
    return { type: 'discard', payload: { cardId: planDiscard(hand).uid }, key };
  }

  return {
    manifest,
    settingsSchema: ramiSettingsSchema,
    defaultSettings: ramiSettingsSchema.parse({}),
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

export const rami51 = createRamiGame();
