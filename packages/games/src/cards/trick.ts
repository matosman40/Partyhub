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
 * Mécanique « pli » : chaque joueur reçoit sa main. Le joueur qui ouvre le pli pose une carte, puis les autres
 * jouent dans l'ordre. Il faut fournir la couleur demandée si on l'a. Le pli va à la plus forte carte de la
 * couleur demandée, ou à la plus forte carte d'atout si un atout a été joué. Le gagnant prend les points du pli
 * et ouvre le suivant.
 *
 * - La force d'une carte est son `rank` (ou son symbole s'il est numérique, sinon 0).
 * - Un joueur absent ou qui laisse passer le temps joue automatiquement sa carte la plus faible légale.
 * - La manche finit quand toutes les mains sont vides. Son gagnant est celui qui a remporté le plus de plis.
 * - La partie finit à la fin d'une manche où un joueur a atteint l'objectif de points.
 *
 * Les mains ne sont jamais dans la vue publique : seule la table (cartes jouées) est partagée.
 */

export interface TrickCard {
  uid: string;
  entry: string;
}

export interface TrickPlay {
  pid: string;
  card: TrickCard;
}

export type TrickPhase = 'play' | 'trick-over' | 'round-over' | 'final';

export interface TrickState {
  def: CardGameDefinition;
  settings: CardSettings;
  started: boolean;
  order: string[];
  names: Record<string, string>;
  hands: Record<string, TrickCard[]>;
  scores: Record<string, number>;
  /** Plis remportés pendant la manche en cours. */
  tricksWon: Record<string, number>;
  round: number;
  /** Index dans `order` du joueur dont c'est le tour (ou qui ouvrira le prochain pli). */
  turn: number;
  /** Cartes posées dans le pli en cours, dans l'ordre de jeu. */
  table: TrickPlay[];
  /** Couleur demandée par le pli en cours (celle de sa première carte). */
  ledFamily: string | null;
  phase: TrickPhase;
  lastTrick: { winner: string; points: number; cards: TrickPlay[] } | null;
  roundWinner: string | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

const TURN = 'turn';
const NEXT_TRICK = 'next-trick';
const NEXT_ROUND = 'next-round';
/** Pause pour voir le pli terminé avant qu'il ne soit ramassé. */
export const TRICK_PAUSE_MS = 2000;
const NEXT_ROUND_MS = 6000;
/** Garde-fou : une partie ne dépasse pas ce nombre de manches. */
const MAX_ROUNDS = 60;

const actionSchemas = {
  play: z.object({ cardId: z.string().min(1).max(40) }),
};

/** Force d'une carte dans un pli : son `rank`, sinon sa valeur numérique, sinon 0. */
export function trickRank(entry: CardEntry): number {
  if (entry.rank !== undefined) return entry.rank;
  const symbol = entry.symbol.trim();
  return /^\d+$/.test(symbol) ? Number(symbol) : 0;
}

/**
 * Index, dans le pli, de la carte gagnante. Un atout l'emporte sur la couleur demandée ; à force égale, la
 * carte jouée la première gagne. La première carte est toujours de la couleur demandée, donc la liste de
 * candidats n'est jamais vide.
 */
export function trickWinnerIndex(plays: { entry: CardEntry }[], ledFamily: string, trump: string | undefined): number {
  const indexed = plays.map((p, index) => ({ p, index }));
  let pool = trump ? indexed.filter((x) => x.p.entry.family === trump) : [];
  if (pool.length === 0) pool = indexed.filter((x) => x.p.entry.family === ledFamily);
  let best = pool[0]!;
  for (const candidate of pool.slice(1)) {
    if (trickRank(candidate.p.entry) > trickRank(best.p.entry)) best = candidate;
  }
  return best.index;
}

function entryMap(def: CardGameDefinition): Map<string, CardEntry> {
  return new Map(def.cards.map((c) => [c.id, c]));
}

function cardName(entry: CardEntry): string {
  return entry.label || entry.text?.slice(0, 24) || entry.symbol;
}

export function createTrickGame(
  def: CardGameDefinition,
  options: { id: string },
): GameModule<TrickState, CardSettings> {
  const { rules } = def;
  const settingsSchema = cardSettingsSchema({ targetScore: rules.targetScore, turnSeconds: rules.turnSeconds });
  const defaultSettings: CardSettings = { targetScore: rules.targetScore, turnSeconds: rules.turnSeconds };
  const map = entryMap(def);

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
    durationMin: Math.max(5, Math.round(rules.targetScore / 15)),
    notice: def.notice,
  };

  function who(s: TrickState, id: string): string {
    return s.names[id] ?? '?';
  }

  function familyLabel(id: string): string {
    return def.families.find((f) => f.id === id)?.label ?? id;
  }

  /** Cartes qu'on peut jouer maintenant : toutes à l'ouverture, sinon la couleur demandée si on la possède. */
  function legalCards(s: TrickState, pid: string): TrickCard[] {
    const hand = s.hands[pid] ?? [];
    if (s.table.length === 0 || s.ledFamily === null) return hand;
    const follow = hand.filter((c) => map.get(c.entry)!.family === s.ledFamily);
    return follow.length > 0 ? follow : hand;
  }

  /** La carte légale la plus faible, pour les absents et le temps écoulé. */
  function lowestLegal(s: TrickState, pid: string): TrickCard | undefined {
    const legal = legalCards(s, pid);
    let best: TrickCard | undefined;
    for (const card of legal) {
      const entry = map.get(card.entry)!;
      if (!best) {
        best = card;
        continue;
      }
      const current = map.get(best.entry)!;
      if (
        trickRank(entry) < trickRank(current) ||
        (trickRank(entry) === trickRank(current) && entry.points < current.points)
      ) {
        best = card;
      }
    }
    return best;
  }

  function beginTurn(s: TrickState, ctx: GameContext): void {
    ctx.cancel(TURN);
    const ms = s.settings.turnSeconds * 1000;
    if (ms > 0) {
      ctx.schedule(TURN, ms);
      s.turnEndsAt = ctx.now() + ms;
    } else {
      s.turnEndsAt = null;
    }
  }

  function stopTimers(s: TrickState, ctx: GameContext): void {
    ctx.cancel(TURN);
    ctx.cancel(NEXT_TRICK);
    ctx.cancel(NEXT_ROUND);
    s.turnEndsAt = null;
  }

  function finish(s: TrickState, ctx: GameContext): void {
    stopTimers(s, ctx);
    s.phase = 'final';
    const best = Math.max(0, ...s.order.map((id) => s.scores[id] ?? 0));
    const leaders = s.order.filter((id) => (s.scores[id] ?? 0) === best).map((id) => who(s, id));
    s.lastEvent =
      leaders.length === 1
        ? `${leaders[0]} gagne la partie avec ${best} points !`
        : `Égalité entre ${leaders.join(' et ')} avec ${best} points.`;
  }

  function endRound(s: TrickState, ctx: GameContext): void {
    stopTimers(s, ctx);
    const best = Math.max(0, ...s.order.map((id) => s.tricksWon[id] ?? 0));
    const leaders = s.order.filter((id) => (s.tricksWon[id] ?? 0) === best);
    s.roundWinner = leaders.length === 1 ? leaders[0]! : null;
    s.lastEvent =
      s.roundWinner !== null
        ? `${who(s, s.roundWinner)} remporte la manche ${s.round} avec ${best} plis.`
        : `Manche ${s.round} : égalité au nombre de plis.`;
    if (s.round >= MAX_ROUNDS || s.order.some((id) => (s.scores[id] ?? 0) >= s.settings.targetScore)) {
      finish(s, ctx);
      return;
    }
    s.phase = 'round-over';
    ctx.schedule(NEXT_ROUND, NEXT_ROUND_MS);
  }

  /** Pose une carte dans le pli. Ne fait pas avancer le tour : c'est le rôle de `settleTurns`. */
  function playCard(s: TrickState, pid: string, uid: string, ctx: GameContext, prefix = ''): void {
    const hand = s.hands[pid]!;
    const index = hand.findIndex((c) => c.uid === uid);
    const [card] = hand.splice(index, 1);
    const entry = map.get(card!.entry)!;
    if (s.table.length === 0) s.ledFamily = entry.family;
    s.table.push({ pid, card: card! });
    s.lastEvent = `${prefix}${who(s, pid)} joue ${cardName(entry)}.`;

    if (s.table.length < s.order.length) {
      s.turn = (s.turn + 1) % s.order.length;
      return;
    }
    resolveTrick(s, ctx);
  }

  function resolveTrick(s: TrickState, ctx: GameContext): void {
    ctx.cancel(TURN);
    s.turnEndsAt = null;
    const plays = s.table.map((t) => ({ pid: t.pid, card: t.card, entry: map.get(t.card.entry)! }));
    const winnerAt = trickWinnerIndex(plays, s.ledFamily!, rules.trump);
    const winner = plays[winnerAt]!.pid;
    const points = plays.reduce((sum, p) => sum + p.entry.points, 0);
    s.scores[winner] = (s.scores[winner] ?? 0) + points;
    s.tricksWon[winner] = (s.tricksWon[winner] ?? 0) + 1;
    s.lastTrick = { winner, points, cards: [...s.table] };
    s.turn = s.order.indexOf(winner);
    s.phase = 'trick-over';
    // Le message de la dernière carte reste (ex. « absent ») : on ajoute le résultat du pli à la suite.
    s.lastEvent = `${s.lastEvent} ${who(s, winner)} remporte le pli (+${points}).`.trim();

    if (s.order.every((id) => (s.hands[id] ?? []).length === 0)) {
      endRound(s, ctx);
      return;
    }
    ctx.schedule(NEXT_TRICK, TRICK_PAUSE_MS);
  }

  /**
   * Fait jouer les joueurs absents (déconnectés) à leur place, puis lance le minuteur du tour en cours.
   * Sans joueur connecté, la partie attend, comme les autres mécaniques.
   */
  function settleTurns(s: TrickState, ctx: GameContext): void {
    const connected = new Set(ctx.connectedPlayerIds());
    let guard = 0;
    while (s.phase === 'play' && connected.size > 0 && !connected.has(s.order[s.turn]!) && guard < 500) {
      guard += 1;
      const pid = s.order[s.turn]!;
      const card = lowestLegal(s, pid);
      if (!card) break;
      playCard(s, pid, card.uid, ctx, `${who(s, pid)} est absent. `);
    }
    if (s.phase === 'play') beginTurn(s, ctx);
  }

  function startTrick(s: TrickState, ctx: GameContext): void {
    s.table = [];
    s.ledFamily = null;
    s.phase = 'play';
    s.lastEvent = `${who(s, s.order[s.turn]!)} ouvre le pli.`;
    settleTurns(s, ctx);
  }

  function dealRound(s: TrickState, ctx: GameContext): void {
    s.round += 1;
    s.phase = 'play';
    s.roundWinner = null;
    s.table = [];
    s.ledFamily = null;
    s.lastTrick = null;
    s.tricksWon = Object.fromEntries(s.order.map((id) => [id, 0]));
    ctx.cancel(NEXT_ROUND);
    ctx.cancel(NEXT_TRICK);

    const copies: string[] = [];
    for (const c of def.cards) for (let i = 0; i < c.count; i++) copies.push(c.id);
    const deck = shuffle(copies, ctx.random).map((entry, i) => ({ uid: `t${s.round}-${i + 1}`, entry }));
    s.hands = {};
    for (const pid of s.order) s.hands[pid] = [];
    for (let i = 0; i < rules.handSize; i++) {
      for (const pid of s.order) {
        const card = deck.pop();
        if (card) s.hands[pid]!.push(card);
      }
    }
    // Le premier joueur qui ouvre change à chaque manche.
    s.turn = (s.round - 1) % s.order.length;
    s.lastEvent = `Manche ${s.round} : ${who(s, s.order[s.turn]!)} ouvre le premier pli.`;
    settleTurns(s, ctx);
  }

  function initialize(settings: CardSettings, players: PlayerRef[]): TrickState {
    return {
      def,
      settings,
      started: false,
      order: players.map((p) => p.id),
      names: directory(players),
      hands: {},
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      tricksWon: {},
      round: 0,
      turn: 0,
      table: [],
      ledFamily: null,
      phase: 'play',
      lastTrick: null,
      roundWinner: null,
      lastEvent: '',
      turnEndsAt: null,
    };
  }

  function onPlayerJoin(state: TrickState, player: PlayerRef): TrickState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id)) {
      s.order.push(player.id);
      s.scores[player.id] = 0;
    }
    return s;
  }

  function onPlayerLeave(state: TrickState, player: PlayerRef): TrickState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.scores[player.id];
    return s;
  }

  function start(state: TrickState, ctx: GameContext): GameResult<TrickState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length < rules.minPlayers) return fail(`Il faut au moins ${rules.minPlayers} joueurs.`);
    const s = structuredClone(state);
    s.started = true;
    s.round = 0;
    dealRound(s, ctx);
    return ok(s);
  }

  function handleAction(
    state: TrickState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<TrickState> {
    if (!state.started || !state.order.includes(player.id)) return fail('Vous ne participez pas à cette partie.');
    if (state.phase === 'final') return fail('La partie est terminée.');
    const s = structuredClone(state);
    switch (type) {
      case 'play': {
        const { cardId } = payload as { cardId: string };
        if (s.phase === 'round-over') return fail('La manche est terminée.');
        if (s.phase !== 'play') return fail('Le pli se termine, patientez.');
        if (s.order[s.turn] !== player.id) return fail("Ce n'est pas votre tour.");
        const hand = s.hands[player.id] ?? [];
        const card = hand.find((c) => c.uid === cardId);
        if (!card) return fail('Cette carte n’est pas dans votre main.');
        if (!legalCards(s, player.id).some((c) => c.uid === cardId)) {
          return fail(`Il faut jouer une carte de la couleur demandée : ${familyLabel(s.ledFamily!)}.`);
        }
        playCard(s, player.id, cardId, ctx);
        settleTurns(s, ctx);
        return ok(s);
      }
      default:
        return fail('Action inconnue.');
    }
  }

  function onTimer(state: TrickState, key: string, ctx: GameContext): TrickState {
    if (!state.started || state.phase === 'final') return state;
    const s = structuredClone(state);
    if (key === TURN && s.phase === 'play') {
      const pid = s.order[s.turn]!;
      const card = lowestLegal(s, pid);
      if (card) playCard(s, pid, card.uid, ctx, 'Temps écoulé : ');
      settleTurns(s, ctx);
      return s;
    }
    if (key === NEXT_TRICK && s.phase === 'trick-over') {
      startTrick(s, ctx);
      return s;
    }
    if (key === NEXT_ROUND && s.phase === 'round-over') {
      dealRound(s, ctx);
      return s;
    }
    return s;
  }

  function nextRound(state: TrickState, ctx: GameContext): TrickState {
    if (!state.started || state.phase !== 'round-over') return state;
    const s = structuredClone(state);
    dealRound(s, ctx);
    return s;
  }

  function calculateScores(state: TrickState) {
    const names = Object.fromEntries(state.order.map((id) => [id, state.names[id] ?? '?']));
    return rankEntries(names, state.scores);
  }

  function end(state: TrickState, ctx: GameContext): TrickState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    stopTimers(s, ctx);
    s.phase = 'final';
    s.lastEvent = 'Partie interrompue.';
    return s;
  }

  function getPublicState(state: TrickState) {
    return {
      kind: 'trick' as const,
      phase: state.phase,
      started: state.started,
      def: state.def,
      settings: state.settings,
      order: state.order,
      names: state.names,
      scores: state.scores,
      round: state.round,
      tricksWon: state.tricksWon,
      current: state.phase === 'play' && state.started ? (state.order[state.turn] ?? null) : null,
      table: state.table.map((t) => ({ pid: t.pid, entry: t.card.entry })),
      ledFamily: state.ledFamily,
      trump: rules.trump ?? null,
      counts: Object.fromEntries(state.order.map((id) => [id, (state.hands[id] ?? []).length])),
      lastTrick: state.lastTrick
        ? {
            winner: state.lastTrick.winner,
            points: state.lastTrick.points,
            cards: state.lastTrick.cards.map((t) => ({ pid: t.pid, entry: t.card.entry })),
          }
        : null,
      roundWinner: state.roundWinner,
      lastEvent: state.lastEvent,
      turnEndsAt: state.turnEndsAt,
    };
  }

  function getPlayerState(state: TrickState, playerId: string) {
    const member = state.order.includes(playerId);
    const myTurn = member && state.phase === 'play' && state.order[state.turn] === playerId;
    return {
      spectator: !member,
      hand: member ? (state.hands[playerId] ?? []) : [],
      isMyTurn: myTurn,
      playable: myTurn ? legalCards(state, playerId).map((c) => c.uid) : [],
    };
  }

  function isFinished(state: TrickState): boolean {
    return state.phase === 'final';
  }

  /**
   * Robot : prend le pli avec la carte la plus faible qui gagne, sinon joue sa carte la plus faible. À
   * l'ouverture, il joue sa carte la plus forte.
   */
  function suggest(state: TrickState, playerId: string) {
    if (!state.started || state.phase !== 'play' || state.order[state.turn] !== playerId) return null;
    const legal = legalCards(state, playerId);
    if (legal.length === 0) return null;
    const byRank = (a: TrickCard, b: TrickCard) => trickRank(map.get(a.entry)!) - trickRank(map.get(b.entry)!);
    let pick: TrickCard;
    if (state.table.length === 0 || state.ledFamily === null) {
      pick = [...legal].sort((a, b) => byRank(b, a))[0]!;
    } else {
      const winning = legal
        .filter((card) => {
          const plays = [...state.table, { pid: playerId, card }].map((t) => ({ entry: map.get(t.card.entry)! }));
          return trickWinnerIndex(plays, state.ledFamily!, rules.trump) === plays.length - 1;
        })
        .sort(byRank)[0];
      pick = winning ?? [...legal].sort(byRank)[0]!;
    }
    return {
      type: 'play',
      payload: { cardId: pick.uid },
      key: `play:${state.round}:${state.table.length}:${pick.uid}`,
    };
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
