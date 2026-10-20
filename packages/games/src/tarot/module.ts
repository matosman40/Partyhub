import { z } from 'zod';
import type { BotSuggestion, GameContext, GameManifest, GameModule, GameResult, PlayerRef } from '@partyhub/shared';
import { directory, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { botBid, botEcart, botPlay, type PlayedCard } from './bot.js';
import {
  CHIEN_SIZE,
  CONTRACTS,
  CONTRACT_LABEL,
  EXCUSE,
  HAND_SIZE,
  PETIT,
  PLAYERS,
  TAROT_DECK,
  TAROT_NOTICE,
  TRICKS_PER_DEAL,
  autoEcart,
  byLowValue,
  cardPhrase,
  chienIsRevealed,
  chienSide,
  contractsAbove,
  dealDeltas,
  ecartError,
  formatHalf,
  hasPetitSec,
  isTrump,
  legalCards,
  playError,
  rankOf,
  scoreDeal,
  sortHand,
  trickWinner,
  type Contract,
  type DealScore,
  type Side,
} from './rules.js';

/**
 * Tarot à quatre. Chaque donne : distribution (18 cartes chacun, 6 au chien), un seul
 * tour d’enchères, écart du preneur (Petite et Garde), puis 18 plis. Le preneur joue
 * seul contre les trois autres ; la marque est à somme nulle (le preneur marque trois
 * fois ce que perd chaque défenseur). La partie s’arrête après le nombre de donnes
 * prévu ; une donne annulée (Petit sec, tout le monde passe) ne compte pas.
 */

export type { PlayedCard } from './bot.js';

export type TarotPhase = 'bidding' | 'ecart' | 'play' | 'round-over' | 'final';

export interface TarotBid {
  playerId: string;
  /** Contrat annoncé, ou null pour une passe. */
  contract: Contract | null;
}

export interface TarotTrick {
  /** Cartes dans l’ordre de jeu. */
  cards: PlayedCard[];
  winner: string;
}

/** Bilan d’une donne, affiché à tous à la fin de la donne. */
export interface TarotSummary extends DealScore {
  round: number;
  taker: string;
  contract: Contract;
  petitAuBout: Side | null;
  /** Échange de l’Excuse, en demi-points ajoutés au preneur. */
  excuseTransfer: number;
  tricks: Record<Side, number>;
  deltas: Record<string, number>;
  /** Le chien d’origine, montré à tous à la fin de la donne. */
  chien: string[];
}

export interface TarotState {
  started: boolean;
  settings: TarotSettings;
  /** Les quatre joueurs, dans l’ordre de jeu. */
  order: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  phase: TarotPhase;
  /** Numéro de la donne en cours (les donnes annulées ne comptent pas). */
  round: number;
  /** Nombre de distributions, annulées comprises (identifie la décision en cours des robots). */
  dealCount: number;
  dealer: string | null;
  hands: Record<string, string[]>;
  /** Chien d’origine (il reste ici même après avoir été pris ou mis de côté). */
  chien: string[];
  bids: TarotBid[];
  /** Joueur qui doit agir (enchère, écart ou carte). */
  turn: string | null;
  taker: string | null;
  contract: Contract | null;
  /** Écart du preneur (privé : seuls ses atouts sont montrés). */
  ecart: string[];
  /** Atouts mis à l’écart : ils sont montrés à tous. */
  ecartAtouts: string[];
  /** Cartes des plis terminés, dans l’ordre (information publique, utile aux robots). */
  played: string[];
  trick: PlayedCard[];
  /** Joueur qui a entamé le pli en cours. */
  leader: string | null;
  lastTrick: TarotTrick | null;
  trickCount: number;
  tricks: Record<Side, number>;
  /** Cartes comptées pour chaque camp : plis, écart ou chien, Excuse gardée. */
  piles: Record<Side, string[]>;
  excuseTransfer: number;
  petitAuBout: Side | null;
  summary: TarotSummary | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

export const tarotSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(12).default(4),
  turnSeconds: z.number().int().min(0).max(90).default(30),
});

export type TarotSettings = z.infer<typeof tarotSettingsSchema>;

const TURN = 'turn';
const NEXT_ROUND = 'next-round';
const NEXT_ROUND_MS = 12000;
/** L’écart (6 cartes parmi 24) dispose d’un temps double. */
const ECART_FACTOR = 2;

const cardId = z.string().min(1).max(12);

const actionSchemas = {
  bid: z.object({ contract: z.enum(CONTRACTS) }),
  pass: z.any().optional(),
  ecart: z.object({ cardIds: z.array(cardId).length(CHIEN_SIZE) }),
  play: z.object({ cardId }),
};

function who(s: TarotState, id: string | null): string {
  return id ? (s.names[id] ?? '?') : '?';
}

function nextPlayer(s: TarotState, id: string): string {
  const i = s.order.indexOf(id);
  return s.order[(i + 1) % s.order.length]!;
}

function sideOf(s: TarotState, id: string): Side {
  return id === s.taker ? 'attack' : 'defence';
}

function highestBid(s: TarotState): TarotBid | null {
  let best: TarotBid | null = null;
  for (const bid of s.bids) {
    if (!bid.contract) continue;
    if (!best || CONTRACTS.indexOf(bid.contract) > CONTRACTS.indexOf(best.contract!)) best = bid;
  }
  return best;
}

function setTurn(s: TarotState, id: string, ctx: GameContext, factor = 1): void {
  s.turn = id;
  ctx.cancel(TURN);
  const ms = s.settings.turnSeconds * 1000 * factor;
  if (ms > 0) {
    ctx.schedule(TURN, ms);
    s.turnEndsAt = ctx.now() + ms;
  } else {
    s.turnEndsAt = null;
  }
}

function stopTurn(s: TarotState, ctx: GameContext): void {
  ctx.cancel(TURN);
  s.turn = null;
  s.turnEndsAt = null;
}

/** Mélange et distribue. Renvoie le joueur qui a le Petit sec, s’il y en a un. */
function distribute(s: TarotState, ctx: GameContext): string | null {
  const deck = shuffle(TAROT_DECK, ctx.random);
  s.hands = {};
  s.order.forEach((id, i) => {
    s.hands[id] = deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE);
  });
  s.chien = deck.slice(PLAYERS * HAND_SIZE);
  s.dealCount += 1;
  return s.order.find((id) => hasPetitSec(s.hands[id]!)) ?? null;
}

/** Nouvelle distribution par `dealer`. `reason` explique l’annulation de la donne précédente. */
function startDeal(s: TarotState, ctx: GameContext, dealer: string, reason = ''): void {
  ctx.cancel(NEXT_ROUND);
  s.dealer = dealer;
  s.bids = [];
  s.taker = null;
  s.contract = null;
  s.ecart = [];
  s.ecartAtouts = [];
  s.played = [];
  s.trick = [];
  s.leader = null;
  s.lastTrick = null;
  s.trickCount = 0;
  s.tricks = { attack: 0, defence: 0 };
  s.piles = { attack: [], defence: [] };
  s.excuseTransfer = 0;
  s.petitAuBout = null;
  s.summary = null;
  s.phase = 'bidding';

  const notes: string[] = reason ? [reason] : [];
  // Petit sec : la donne est annulée et refaite par le même donneur (borné par prudence).
  for (let attempt = 0; attempt < 50; attempt++) {
    const holder = distribute(s, ctx);
    if (!holder) break;
    notes.push(`Petit sec chez ${who(s, holder)} : la donne est annulée et refaite.`);
  }
  const first = nextPlayer(s, dealer);
  notes.push(`Donne ${s.round} : ${who(s, dealer)} distribue, ${who(s, first)} parle en premier.`);
  s.lastEvent = notes.join(' ');
  setTurn(s, first, ctx);
}

function beginPlay(s: TarotState, ctx: GameContext): void {
  s.phase = 'play';
  s.trick = [];
  const first = nextPlayer(s, s.dealer!);
  s.leader = first;
  setTurn(s, first, ctx);
}

/** Fin des enchères : redistribution si tout le monde passe, sinon chien et écart selon le contrat. */
function closeBidding(s: TarotState, ctx: GameContext): void {
  const best = highestBid(s);
  if (!best || !best.contract) {
    const next = nextPlayer(s, s.dealer!);
    startDeal(s, ctx, next, `${s.lastEvent} Tout le monde passe : nouvelle donne.`);
    return;
  }
  const taker = best.playerId;
  const contract = best.contract;
  s.taker = taker;
  s.contract = contract;
  const label = CONTRACT_LABEL[contract];
  if (chienIsRevealed(contract)) {
    s.hands[taker] = [...s.hands[taker]!, ...s.chien];
    s.phase = 'ecart';
    s.lastEvent = `${s.lastEvent} ${who(s, taker)} prend avec une ${label} : le chien est retourné, ${who(s, taker)} fait son écart.`;
    setTurn(s, taker, ctx, ECART_FACTOR);
    return;
  }
  const side = chienSide(contract);
  s.piles[side].push(...s.chien);
  s.lastEvent = `${s.lastEvent} ${who(s, taker)} prend avec une ${label} : le chien reste caché et compte pour ${
    side === 'attack' ? 'le preneur' : 'la défense'
  }.`;
  beginPlay(s, ctx);
}

function applyBid(s: TarotState, pid: string, contract: Contract | null, ctx: GameContext, prefix = ''): void {
  s.bids.push({ playerId: pid, contract });
  s.lastEvent = contract
    ? `${prefix}${who(s, pid)} annonce une ${CONTRACT_LABEL[contract]}.`
    : `${prefix}${who(s, pid)} passe.`;
  while (s.bids.length < PLAYERS) {
    const next = nextPlayer(s, s.bids[s.bids.length - 1]!.playerId);
    // Après une Garde contre, plus personne ne peut monter : les joueurs restants passent d’office.
    if (contractsAbove(highestBid(s)?.contract ?? null).length === 0) {
      s.bids.push({ playerId: next, contract: null });
      continue;
    }
    setTurn(s, next, ctx);
    return;
  }
  closeBidding(s, ctx);
}

function applyEcart(s: TarotState, pid: string, ecart: string[], ctx: GameContext, prefix = ''): void {
  s.hands[pid] = s.hands[pid]!.filter((id) => !ecart.includes(id));
  s.piles.attack.push(...ecart);
  s.ecart = [...ecart];
  s.ecartAtouts = ecart.filter(isTrump).sort((a, b) => rankOf(a) - rankOf(b));
  const atouts = s.ecartAtouts.length > 0 ? ` Atouts à l’écart : ${s.ecartAtouts.map(rankOf).join(', ')}.` : '';
  beginPlay(s, ctx);
  s.lastEvent = `${prefix}${who(s, pid)} a fait son écart.${atouts} ${who(s, s.leader)} entame.`;
}

function applyPlay(s: TarotState, pid: string, card: string, ctx: GameContext, prefix = ''): void {
  s.hands[pid] = s.hands[pid]!.filter((id) => id !== card);
  s.trick.push({ playerId: pid, cardId: card });
  const played = `${prefix}${who(s, pid)} joue ${cardPhrase(card)}.`;
  if (s.trick.length < PLAYERS) {
    s.lastEvent = played;
    setTurn(s, nextPlayer(s, pid), ctx);
    return;
  }
  resolveTrick(s, ctx, played);
}

/** Pli complet : le gagnant ramasse (sauf l’Excuse, qui reste à son camp avant le dernier pli). */
function resolveTrick(s: TarotState, ctx: GameContext, played: string): void {
  const cards = s.trick.map((p) => p.cardId);
  const winner = s.trick[trickWinner(cards)]!.playerId;
  const side = sideOf(s, winner);
  s.trickCount += 1;
  const last = s.trickCount === TRICKS_PER_DEAL;
  for (const p of s.trick) {
    if (p.cardId === EXCUSE && !last) {
      const owner = sideOf(s, p.playerId);
      s.piles[owner].push(EXCUSE);
      // Le camp de l’Excuse cède un demi-point au camp qui a gagné le pli.
      if (owner !== side) s.excuseTransfer += owner === 'attack' ? -1 : 1;
    } else {
      s.piles[side].push(p.cardId);
    }
  }
  s.tricks[side] += 1;
  s.played.push(...cards);
  const notes = [played, `${who(s, winner)} remporte le pli.`];
  if (last && cards.includes(PETIT)) {
    s.petitAuBout = side;
    notes.push(side === 'attack' ? 'Petit au bout pour le preneur !' : 'Petit au bout pour la défense !');
  }
  s.lastTrick = { cards: s.trick, winner };
  s.trick = [];
  s.leader = winner;
  s.lastEvent = notes.join(' ');
  if (last) endDeal(s, ctx);
  else setTurn(s, winner, ctx);
}

function endDeal(s: TarotState, ctx: GameContext): void {
  stopTurn(s, ctx);
  const taker = s.taker!;
  const contract = s.contract!;
  const score = scoreDeal({
    contract,
    attackCards: s.piles.attack,
    excuseTransfer: s.excuseTransfer,
    petitAuBout: s.petitAuBout,
    tricks: s.tricks,
  });
  const deltas = dealDeltas(s.order, taker, score.total);
  for (const id of s.order) s.scores[id] = (s.scores[id] ?? 0) + (deltas[id] ?? 0);
  s.summary = {
    ...score,
    round: s.round,
    taker,
    contract,
    petitAuBout: s.petitAuBout,
    excuseTransfer: s.excuseTransfer,
    tricks: { ...s.tricks },
    deltas,
    chien: [...s.chien],
  };
  const verdict = `${who(s, taker)} ${score.made ? 'réussit' : 'chute'} sa ${CONTRACT_LABEL[contract]} : ${formatHalf(
    score.attackHalf,
  )} points pour ${score.needed} à faire.`;
  if (s.round >= s.settings.rounds) {
    s.phase = 'final';
    const top = Math.max(...s.order.map((id) => s.scores[id] ?? 0));
    const leaders = s.order.filter((id) => (s.scores[id] ?? 0) === top).map((id) => who(s, id));
    s.lastEvent = `${verdict} Fin de la partie : ${leaders.join(' et ')} ${leaders.length > 1 ? 'terminent' : 'termine'} en tête.`;
  } else {
    s.phase = 'round-over';
    s.lastEvent = verdict;
    ctx.schedule(NEXT_ROUND, NEXT_ROUND_MS);
  }
}

/** Carte jouée d’office (temps écoulé) : la plus petite carte permise. */
function lowestLegal(s: TarotState, id: string): string {
  return [
    ...legalCards(
      s.hands[id] ?? [],
      s.trick.map((p) => p.cardId),
    ),
  ].sort(byLowValue)[0]!;
}

/** Action automatique du joueur dont c’est le tour : passe, écart des plus faibles cartes ou plus petite carte permise. */
function autoMove(state: TarotState, ctx: GameContext, prefix: string): TarotState {
  if (!state.started || !state.turn) return state;
  const s = structuredClone(state);
  const id = s.turn!;
  if (s.phase === 'bidding') applyBid(s, id, null, ctx, prefix);
  else if (s.phase === 'ecart') applyEcart(s, id, autoEcart(s.hands[id]!), ctx, prefix);
  else if (s.phase === 'play') applyPlay(s, id, lowestLegal(s, id), ctx, prefix);
  else return state;
  return s;
}

export function createTarotGame(): GameModule<TarotState, TarotSettings> {
  const manifest: GameManifest = {
    id: 'tarot',
    category: 'cartes',
    name: 'Tarot',
    description: 'Le tarot à quatre : enchères, chien, écart et plis, un preneur contre trois défenseurs.',
    icon: '🎴',
    version: '1.0.1',
    apiVersion: 1,
    minPlayers: PLAYERS,
    maxPlayers: PLAYERS,
    durationMin: 30,
    notice: TAROT_NOTICE,
  };

  function initialize(settings: TarotSettings, players: PlayerRef[]): TarotState {
    const seated = players.slice(0, PLAYERS);
    return {
      started: false,
      settings: tarotSettingsSchema.parse(settings ?? {}),
      order: seated.map((p) => p.id),
      names: directory(players),
      scores: Object.fromEntries(seated.map((p) => [p.id, 0])),
      phase: 'bidding',
      round: 0,
      dealCount: 0,
      dealer: null,
      hands: {},
      chien: [],
      bids: [],
      turn: null,
      taker: null,
      contract: null,
      ecart: [],
      ecartAtouts: [],
      played: [],
      trick: [],
      leader: null,
      lastTrick: null,
      trickCount: 0,
      tricks: { attack: 0, defence: 0 },
      piles: { attack: [], defence: [] },
      excuseTransfer: 0,
      petitAuBout: null,
      summary: null,
      lastEvent: '',
      turnEndsAt: null,
    };
  }

  function onPlayerJoin(state: TarotState, player: PlayerRef): TarotState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id) && s.order.length < PLAYERS) {
      s.order.push(player.id);
      s.scores[player.id] = 0;
    }
    return s;
  }

  function onPlayerLeave(state: TarotState, player: PlayerRef): TarotState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.scores[player.id];
    return s;
  }

  function start(state: TarotState, ctx: GameContext): GameResult<TarotState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length !== PLAYERS) return fail('Le tarot se joue à exactement 4 joueurs.');
    const s = structuredClone(state);
    s.started = true;
    s.round = 1;
    startDeal(s, ctx, s.order[0]!);
    return ok(s);
  }

  function handleAction(
    state: TarotState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<TarotState> {
    const pid = player.id;
    if (!state.started || !state.order.includes(pid)) return fail('Vous ne participez pas à cette partie.');
    if (state.phase === 'round-over' || state.phase === 'final') return fail('La donne est terminée.');
    if (state.turn !== pid) return fail('Ce n’est pas votre tour.');
    const s = structuredClone(state);

    if (type === 'bid' || type === 'pass') {
      if (s.phase !== 'bidding') return fail('Les enchères sont terminées.');
      if (type === 'pass') {
        applyBid(s, pid, null, ctx);
        return ok(s);
      }
      const { contract } = payload as { contract: Contract };
      const highest = highestBid(s)?.contract ?? null;
      if (!contractsAbove(highest).includes(contract)) {
        return fail(`Il faut annoncer plus haut qu’une ${CONTRACT_LABEL[highest ?? 'petite']}.`);
      }
      applyBid(s, pid, contract, ctx);
      return ok(s);
    }

    if (type === 'ecart') {
      if (s.phase !== 'ecart') return fail('Ce n’est pas le moment de faire l’écart.');
      const { cardIds } = payload as { cardIds: string[] };
      const error = ecartError(s.hands[pid] ?? [], cardIds);
      if (error) return fail(error);
      applyEcart(s, pid, cardIds, ctx);
      return ok(s);
    }

    if (type === 'play') {
      if (s.phase !== 'play') return fail('Attendez la fin des enchères et de l’écart.');
      const { cardId: card } = payload as { cardId: string };
      const error = playError(
        s.hands[pid] ?? [],
        s.trick.map((p) => p.cardId),
        card,
      );
      if (error) return fail(error);
      applyPlay(s, pid, card, ctx);
      return ok(s);
    }

    return fail('Action inconnue.');
  }

  function startNextRound(state: TarotState, ctx: GameContext): TarotState {
    if (state.phase !== 'round-over') return state;
    const s = structuredClone(state);
    s.round += 1;
    startDeal(s, ctx, nextPlayer(s, s.dealer!));
    return s;
  }

  function onTimer(state: TarotState, key: string, ctx: GameContext): TarotState {
    if (key === NEXT_ROUND) return startNextRound(state, ctx);
    if (key !== TURN) return state;
    return autoMove(state, ctx, 'Temps écoulé : ');
  }

  /** Étape suivante (hôte) : lance la donne suivante après un bilan. Ne joue jamais à la place de quelqu’un. */
  function nextRound(state: TarotState, ctx: GameContext): TarotState {
    return startNextRound(state, ctx);
  }

  function calculateScores(state: TarotState) {
    const names = Object.fromEntries(state.order.map((id) => [id, state.names[id] ?? '?']));
    return rankEntries(names, state.scores);
  }

  function end(state: TarotState, ctx: GameContext): TarotState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    ctx.cancel(TURN);
    ctx.cancel(NEXT_ROUND);
    s.turn = null;
    s.turnEndsAt = null;
    s.phase = 'final';
    s.lastEvent = 'Partie interrompue.';
    return s;
  }

  function getPublicState(state: TarotState) {
    const active = state.phase === 'bidding' || state.phase === 'ecart' || state.phase === 'play';
    // Le chien n’est montré que pendant l’écart (Petite et Garde) et à la fin de la donne.
    const dealDone = state.summary !== null && state.summary.round === state.round;
    return {
      phase: state.phase,
      started: state.started,
      settings: state.settings,
      round: state.round,
      rounds: state.settings.rounds,
      order: state.order,
      names: state.names,
      scores: state.scores,
      dealer: state.dealer,
      dealCount: state.dealCount,
      bids: state.bids,
      highest: highestBid(state)?.contract ?? null,
      current: state.started && active ? state.turn : null,
      taker: state.taker,
      contract: state.contract,
      chien: state.phase === 'ecart' || dealDone ? state.chien : null,
      ecartAtouts: state.ecartAtouts,
      trick: state.trick,
      leader: state.leader,
      lastTrick: state.lastTrick,
      trickCount: state.trickCount,
      tricks: state.tricks,
      counts: Object.fromEntries(state.order.map((id) => [id, state.hands[id]?.length ?? 0])),
      summary: state.summary,
      lastEvent: state.lastEvent,
      turnEndsAt: state.turnEndsAt,
    };
  }

  function getPlayerState(state: TarotState, playerId: string) {
    const seated = state.order.includes(playerId);
    const hand = sortHand(state.hands[playerId] ?? []);
    const active = state.phase === 'bidding' || state.phase === 'ecart' || state.phase === 'play';
    const myTurn = state.started && active && state.turn === playerId;
    return {
      hand: hand.map((id) => ({ uid: id, entry: id })),
      playable:
        myTurn && state.phase === 'play'
          ? legalCards(
              hand,
              state.trick.map((p) => p.cardId),
            )
          : [],
      isMyTurn: myTurn,
      bidOptions: myTurn && state.phase === 'bidding' ? contractsAbove(highestBid(state)?.contract ?? null) : [],
      canPass: myTurn && state.phase === 'bidding',
      mustEcart: myTurn && state.phase === 'ecart',
      side: state.taker && seated ? sideOf(state, playerId) : null,
      spectator: !seated,
    };
  }

  function isFinished(state: TarotState): boolean {
    return state.phase === 'final';
  }

  function suggest(state: TarotState, playerId: string): BotSuggestion | null {
    if (!state.started || state.turn !== playerId) return null;
    const hand = state.hands[playerId] ?? [];
    const key = `${state.phase}:${state.dealCount}:${state.bids.length}:${state.trickCount}:${state.trick.length}`;
    if (state.phase === 'bidding') {
      const contract = botBid(hand, highestBid(state)?.contract ?? null);
      return contract ? { type: 'bid', payload: { contract }, key } : { type: 'pass', key };
    }
    if (state.phase === 'ecart') return { type: 'ecart', payload: { cardIds: botEcart(hand) }, key };
    if (state.phase === 'play') {
      // Le robot ne voit que ce qu’un joueur voit : plis joués, son écart s’il est preneur, sinon les atouts écartés.
      const seen = [...state.played, ...(playerId === state.taker ? state.ecart : state.ecartAtouts)];
      const cardId = botPlay({ hand, trick: state.trick, me: playerId, taker: state.taker, order: state.order, seen });
      return { type: 'play', payload: { cardId }, key };
    }
    return null;
  }

  return {
    manifest,
    settingsSchema: tarotSettingsSchema,
    defaultSettings: tarotSettingsSchema.parse({}),
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

export const tarot = createTarotGame();
