import { z } from 'zod';
import type { CardEntry, GameContext, GameManifest, GameModule, GameResult, PlayerRef } from '@partyhub/shared';
import { directory, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { PRESIDENT_DEFINITION, rankOf, validatePlay } from './rules.js';

/**
 * Le Président : chaque joueur reçoit une part du paquet. À tour de rôle, on pose
 * une ou plusieurs cartes de même rang, plus fortes que le pli en cours. Un 10 ou
 * un carré brûle le pli. Le premier à vider sa main devient Président ; le dernier
 * est le Trou du cul. Entre deux manches, le Trou du cul donne ses deux meilleures
 * cartes au Président, qui lui rend ses deux plus faibles (même principe pour les
 * deux rangs suivants, avec une seule carte).
 */

export interface PCard {
  uid: string;
  entry: string;
}

export type PresidentPhase = 'play' | 'round-over' | 'final';

export interface PresidentState {
  started: boolean;
  settings: PresidentSettings;
  order: string[];
  names: Record<string, string>;
  hands: Record<string, PCard[]>;
  /** Cartes du pli en cours (ordre de pose). */
  pile: PCard[];
  pileRank: number;
  pileCount: number;
  /** Joueur dont c’est le tour (index dans `order`). */
  turn: number;
  /** Dernier joueur à avoir posé dans le pli. */
  leader: string | null;
  /** Joueurs ayant passé depuis la dernière pose. */
  passed: string[];
  /** Joueurs sortis de la manche, dans l’ordre d’arrivée. */
  finished: string[];
  round: number;
  phase: PresidentPhase;
  scores: Record<string, number>;
  /** Rôles de la dernière manche (président, vice-président…), pour l’affichage. */
  roles: Record<string, string>;
  lastEvent: string;
  turnEndsAt: number | null;
}

export const presidentSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(3),
  turnSeconds: z.number().int().min(0).max(60).default(25),
});

export type PresidentSettings = z.infer<typeof presidentSettingsSchema>;

const TURN = 'turn';
const NEXT_ROUND = 'next-round';
const NEXT_ROUND_MS = 6000;

const actionSchemas = {
  play: z.object({ cardIds: z.array(z.string().min(1).max(20)).min(1).max(4) }),
  pass: z.any().optional(),
};

const ENTRY_BY_ID: Map<string, CardEntry> = new Map(PRESIDENT_DEFINITION.cards.map((c) => [c.id, c]));

function labelOf(card: PCard): CardEntry {
  return ENTRY_BY_ID.get(card.entry)!;
}

function rankOfCard(card: PCard): number {
  return rankOf(labelOf(card));
}

/** Paquet de 52 cartes mélangé avec le générateur injecté. */
function fullDeck(random: () => number): PCard[] {
  const cards = PRESIDENT_DEFINITION.cards.map((c) => ({ uid: c.id, entry: c.id }));
  return shuffle(cards, random);
}

function who(s: PresidentState, id: string): string {
  return s.names[id] ?? '?';
}

/** Joueurs encore en jeu, dans l’ordre des tours. */
function active(s: PresidentState): string[] {
  return s.order.filter((id) => !s.finished.includes(id));
}

/** Joueur actif suivant `from` (dans l’ordre circulaire, sans les joueurs sortis). */
function nextActive(s: PresidentState, from: string): string {
  const players = s.order;
  const start = players.indexOf(from);
  for (let k = 1; k <= players.length; k++) {
    const id = players[(start + k) % players.length]!;
    if (!s.finished.includes(id)) return id;
  }
  return from;
}

function setTurn(s: PresidentState, id: string, ctx: GameContext): void {
  s.turn = s.order.indexOf(id);
  ctx.cancel(TURN);
  const ms = s.settings.turnSeconds * 1000;
  if (ms > 0) {
    ctx.schedule(TURN, ms);
    s.turnEndsAt = ctx.now() + ms;
  } else {
    s.turnEndsAt = null;
  }
}

function currentId(s: PresidentState): string {
  return s.order[s.turn]!;
}

/**
 * Échange automatique entre rangs, appliqué après la nouvelle donne.
 * `previous` est le classement de la manche précédente (Président en premier).
 */
function trade(s: PresidentState, previous: string[]): string | null {
  const n = s.order.length;
  if (previous.length < n || n < 3) return null;
  const president = previous[0]!;
  const trou = previous[n - 1]!;
  const messages: string[] = [];

  const best = (id: string, count: number) =>
    [...s.hands[id]!].sort((a, b) => rankOfCard(b) - rankOfCard(a)).slice(0, count);
  const worst = (id: string, count: number) =>
    [...s.hands[id]!].sort((a, b) => rankOfCard(a) - rankOfCard(b)).slice(0, count);
  const move = (from: string, to: string, cards: PCard[]) => {
    s.hands[from] = s.hands[from]!.filter((c) => !cards.includes(c));
    s.hands[to]!.push(...cards);
  };

  // Le Trou du cul donne ses deux meilleures cartes ; le Président rend ses deux plus faibles.
  move(trou, president, best(trou, 2));
  move(president, trou, worst(president, 2));
  messages.push(`${who(s, trou)} donne ses meilleures cartes à ${who(s, president)}`);

  // Avec au moins quatre joueurs, le Vice-trou donne une carte au Vice-président.
  if (n >= 4) {
    const vice = previous[1]!;
    const viceTrou = previous[n - 2]!;
    move(viceTrou, vice, best(viceTrou, 1));
    move(vice, viceTrou, worst(vice, 1));
    messages.push(`${who(s, viceTrou)} donne une carte à ${who(s, vice)}`);
  }
  return `Échange : ${messages.join(' · ')}.`;
}

function assignRoles(s: PresidentState): Record<string, string> {
  const n = s.order.length;
  const roles: Record<string, string> = {};
  const names = ['Président', 'Vice-président', 'Vice-trou', 'Trou du cul'];
  s.finished.forEach((id, i) => {
    if (i === 0) roles[id] = 'Président';
    else if (i === n - 1) roles[id] = 'Trou du cul';
    else if (i === 1 && n >= 4) roles[id] = 'Vice-président';
    else if (i === n - 2 && n >= 4) roles[id] = 'Vice-trou';
    else roles[id] = names[Math.min(i, names.length - 1)] ?? `${i + 1}ᵉ`;
  });
  return roles;
}

/** Donne une manche. `startId` joue le premier pli. */
function dealRound(s: PresidentState, ctx: GameContext, startId: string | null): PresidentState {
  const deck = fullDeck(ctx.random);
  s.hands = {};
  for (const id of s.order) s.hands[id] = [];
  deck.forEach((card, i) => s.hands[s.order[i % s.order.length]!]!.push(card));

  s.pile = [];
  s.pileRank = 0;
  s.pileCount = 0;
  s.passed = [];
  s.leader = null;
  s.finished = [];
  s.round += 1;
  s.phase = 'play';

  // Premier pli : celui qui a le 3 de trèfle commence ; ensuite, le Président.
  const holder = s.order.find((id) => s.hands[id]!.some((c) => c.uid === '3c')) ?? s.order[0]!;
  const first = startId ?? holder;
  s.lastEvent = `Manche ${s.round} : ${who(s, first)} commence.`;
  setTurn(s, first, ctx);
  return s;
}

/** Fin d’une manche : rangs, points et préparation de la suivante. */
function endRound(s: PresidentState, ctx: GameContext): void {
  const n = s.order.length;
  s.finished.forEach((id, i) => {
    s.scores[id] = (s.scores[id] ?? 0) + (n - 1 - i);
  });
  s.roles = assignRoles(s);
  ctx.cancel(TURN);
  s.turnEndsAt = null;
  if (s.round >= s.settings.rounds) {
    s.phase = 'final';
    const best = s.order.reduce((a, b) => ((s.scores[b] ?? 0) > (s.scores[a] ?? 0) ? b : a));
    s.lastEvent = `Fin de la partie : ${who(s, best)} est le meilleur Président.`;
  } else {
    s.phase = 'round-over';
    s.lastEvent = `${who(s, s.finished[0]!)} est Président de cette manche.`;
    ctx.schedule(NEXT_ROUND, NEXT_ROUND_MS);
  }
}

/** Vide le pli et redonne la main au dernier joueur qui a posé (ou au suivant s’il est sorti). */
function endTrick(s: PresidentState, ctx: GameContext): void {
  s.pile = [];
  s.pileRank = 0;
  s.pileCount = 0;
  s.passed = [];
  const leader = s.leader && !s.finished.includes(s.leader) ? s.leader : nextActive(s, s.leader ?? currentId(s));
  s.leader = null;
  s.lastEvent = `${who(s, leader)} reprend la main.`;
  setTurn(s, leader, ctx);
}

/** Passe au joueur suivant, ou termine le pli si tous les autres ont passé. */
function advance(s: PresidentState, ctx: GameContext): void {
  const others = active(s).filter((id) => id !== s.leader);
  if (s.leader !== null && others.every((id) => s.passed.includes(id))) {
    endTrick(s, ctx);
    return;
  }
  setTurn(s, nextActive(s, currentId(s)), ctx);
}

/** Coup de meilleure valeur pour un robot : le plus petit groupe qui bat le pli. */
function bestPlay(s: PresidentState, id: string): PCard[] | null {
  const hand = s.hands[id] ?? [];
  const byRank = new Map<number, PCard[]>();
  for (const c of hand) {
    const r = rankOfCard(c);
    byRank.set(r, [...(byRank.get(r) ?? []), c]);
  }
  const groups = [...byRank.entries()].sort((a, b) => a[0] - b[0]).map(([, cs]) => cs);
  for (const group of groups) {
    if (s.pileCount === 0) return [group[0]!];
    const size = s.pileCount;
    if (group.length < size) continue;
    const pick = group.slice(0, size);
    if (
      validatePlay(
        s.pileRank,
        s.pileCount,
        pick.map((c) => labelOf(c)),
      ).ok
    )
      return pick;
  }
  return null;
}

export function createPresidentGame(): GameModule<PresidentState, PresidentSettings> {
  const manifest: GameManifest = {
    id: 'president',
    category: 'cartes',
    name: 'Président',
    description: 'Le classique des soirées : montez en grade, de Trou du cul à Président.',
    icon: '👑',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 3,
    maxPlayers: 6,
    durationMin: 20,
    notice: PRESIDENT_DEFINITION.notice,
  };

  function initialize(settings: PresidentSettings, players: PlayerRef[]): PresidentState {
    return {
      started: false,
      settings,
      order: players.map((p) => p.id),
      names: directory(players),
      hands: {},
      pile: [],
      pileRank: 0,
      pileCount: 0,
      turn: 0,
      leader: null,
      passed: [],
      finished: [],
      round: 0,
      phase: 'play',
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      roles: {},
      lastEvent: '',
      turnEndsAt: null,
    };
  }

  function onPlayerJoin(state: PresidentState, player: PlayerRef): PresidentState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id) && s.order.length < manifest.maxPlayers) {
      s.order.push(player.id);
      s.scores[player.id] = 0;
    }
    return s;
  }

  function onPlayerLeave(state: PresidentState, player: PlayerRef): PresidentState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.scores[player.id];
    return s;
  }

  function start(state: PresidentState, ctx: GameContext): GameResult<PresidentState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length < manifest.minPlayers) {
      return fail(`Il faut au moins ${manifest.minPlayers} joueurs.`);
    }
    const s = structuredClone(state);
    s.started = true;
    s.round = 0;
    return ok(dealRound(s, ctx, null));
  }

  function handleAction(
    state: PresidentState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<PresidentState> {
    const s = structuredClone(state);
    const pid = player.id;
    if (!s.started || !s.hands[pid]) return fail('Vous ne participez pas à cette manche.');
    if (s.phase !== 'play') return fail('La manche est terminée.');
    if (currentId(s) !== pid || s.finished.includes(pid)) return fail('Ce n’est pas votre tour.');

    if (type === 'pass') {
      if (s.pileCount === 0) return fail('Table vide : vous devez poser une carte.');
      s.passed.push(pid);
      s.lastEvent = `${who(s, pid)} passe.`;
      advance(s, ctx);
      return ok(s);
    }

    if (type === 'play') {
      const { cardIds } = payload as { cardIds: string[] };
      if (new Set(cardIds).size !== cardIds.length) return fail('Carte choisie deux fois.');
      const cards = cardIds.map((uid) => s.hands[pid]!.find((c) => c.uid === uid));
      if (cards.some((c) => !c)) return fail('Carte absente de votre main.');
      const chosen = cards as PCard[];
      const check = validatePlay(
        s.pileRank,
        s.pileCount,
        chosen.map((c) => labelOf(c)),
      );
      if (!check.ok) return fail(check.error);

      s.hands[pid] = s.hands[pid]!.filter((c) => !chosen.includes(c));
      const label = labelOf(chosen[0]!).label;
      const count = chosen.length;

      if (check.burns) {
        s.pile = [];
        s.pileRank = 0;
        s.pileCount = 0;
        s.passed = [];
        s.leader = null;
        s.lastEvent = `${who(s, pid)} brûle le pli avec ${count > 1 ? `${count} × ${label}` : label} !`;
      } else {
        s.pile = chosen;
        s.pileRank = rankOfCard(chosen[0]!);
        s.pileCount = count;
        s.passed = [];
        s.leader = pid;
        s.lastEvent = `${who(s, pid)} pose ${count > 1 ? `${count} × ${label}` : label}.`;
      }

      if (s.hands[pid]!.length === 0) {
        s.finished.push(pid);
        s.lastEvent += ` ${who(s, pid)} sort de la manche.`;
        if (active(s).length <= 1) {
          const last = active(s)[0];
          if (last) s.finished.push(last);
          endRound(s, ctx);
          return ok(s);
        }
      }

      // Après un brûlage, le joueur rejoue tout de suite (si la main n’est pas vide).
      const again = check.burns && !s.finished.includes(pid);
      setTurn(s, again ? pid : nextActive(s, pid), ctx);
      return ok(s);
    }

    return fail('Action inconnue.');
  }

  function startNextRound(state: PresidentState, ctx: GameContext): PresidentState {
    if (state.phase !== 'round-over') return state;
    const s = structuredClone(state);
    ctx.cancel(NEXT_ROUND);
    const previous = [...s.finished];
    const dealt = dealRound(s, ctx, previous[0]!);
    const tradeText = trade(dealt, previous);
    dealt.lastEvent = `Manche ${dealt.round} : ${who(dealt, previous[0]!)} commence. ${tradeText ?? ''}`.trim();
    return dealt;
  }

  function onTimer(state: PresidentState, key: string, ctx: GameContext): PresidentState {
    if (key === NEXT_ROUND) return startNextRound(state, ctx);
    if (key !== TURN || !state.started || state.phase !== 'play') return state;
    const s = structuredClone(state);
    const id = currentId(s);
    if (s.pileCount > 0) {
      s.passed.push(id);
      s.lastEvent = `Temps écoulé : ${who(s, id)} passe.`;
      advance(s, ctx);
    } else {
      const lowest = [...s.hands[id]!].sort((a, b) => rankOfCard(a) - rankOfCard(b))[0];
      if (lowest) {
        s.hands[id] = s.hands[id]!.filter((c) => c !== lowest);
        s.pile = [lowest];
        s.pileRank = rankOfCard(lowest);
        s.pileCount = 1;
        s.leader = id;
        s.passed = [];
        s.lastEvent = `Temps écoulé : ${who(s, id)} pose ${labelOf(lowest).label}.`;
        if (s.hands[id]!.length === 0) {
          s.finished.push(id);
          if (active(s).length <= 1) {
            const last = active(s)[0];
            if (last) s.finished.push(last);
            endRound(s, ctx);
            return s;
          }
        }
        setTurn(s, nextActive(s, id), ctx);
      }
    }
    return s;
  }

  function nextRound(state: PresidentState, ctx: GameContext): PresidentState {
    return startNextRound(state, ctx);
  }

  function calculateScores(state: PresidentState) {
    const names = Object.fromEntries(state.order.map((id) => [id, state.names[id] ?? '?']));
    return rankEntries(names, state.scores);
  }

  function end(state: PresidentState, ctx: GameContext): PresidentState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    ctx.cancel(TURN);
    ctx.cancel(NEXT_ROUND);
    s.turnEndsAt = null;
    s.phase = 'final';
    s.lastEvent = 'Partie interrompue.';
    return s;
  }

  function getPublicState(state: PresidentState) {
    const revealed = state.phase !== 'play';
    return {
      phase: state.phase,
      started: state.started,
      def: PRESIDENT_DEFINITION,
      settings: state.settings,
      round: state.round,
      rounds: state.settings.rounds,
      order: state.order,
      names: state.names,
      scores: state.scores,
      counts: Object.fromEntries(state.order.map((id) => [id, state.hands[id]?.length ?? 0])),
      current: state.started && state.phase === 'play' ? currentId(state) : null,
      pile: state.pile.map((c) => ({ uid: c.uid, entry: c.entry })),
      pileRank: state.pileRank,
      pileCount: state.pileCount,
      leader: state.leader,
      passed: state.passed,
      finished: state.finished,
      roles: state.roles,
      lastEvent: state.lastEvent,
      turnEndsAt: state.turnEndsAt,
      revealed: revealed ? state.hands : null,
    };
  }

  function getPlayerState(state: PresidentState, playerId: string) {
    const hand = state.hands[playerId] ?? [];
    const myTurn = state.phase === 'play' && state.started && currentId(state) === playerId;
    return {
      hand,
      isMyTurn: myTurn,
      canPass: myTurn && state.pileCount > 0,
      spectator: !state.hands[playerId],
      finished: state.finished.includes(playerId),
    };
  }

  function isFinished(state: PresidentState): boolean {
    return state.phase === 'final';
  }

  function suggest(state: PresidentState, playerId: string) {
    if (!state.started || state.phase !== 'play' || currentId(state) !== playerId) return null;
    const play = bestPlay(state, playerId);
    const len = state.hands[playerId]?.length ?? 0;
    if (play) {
      return {
        type: 'play',
        payload: { cardIds: play.map((c) => c.uid) },
        key: `play:${play.map((c) => c.uid).join(',')}`,
      };
    }
    return { type: 'pass', key: `pass:${state.round}:${state.turn}:${len}:${state.pileCount}` };
  }

  return {
    manifest,
    settingsSchema: presidentSettingsSchema,
    defaultSettings: { rounds: 3, turnSeconds: 25 },
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

export const president = createPresidentGame();
