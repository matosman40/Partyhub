import { z } from 'zod';
import {
  WILD_FAMILY,
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
 * Moteur générique des jeux de cartes. Une définition (familles, cartes,
 * règles) suffit à produire un jeu complet : donne, pioche, défausse, effets,
 * manches et score. Les jeux intégrés et ceux créés dans l'administration
 * passent tous par ici.
 *
 * Règles communes :
 * - on joue une carte de même famille (ou même symbole selon `matchOn`) ;
 * - une carte joker se joue toujours et impose le choix de la famille ;
 * - on pioche une carte ; si elle se joue, on peut la jouer, sinon on passe ;
 * - la première à vider sa main gagne la manche et marque les points des cartes
 *   restées en main chez les autres ;
 * - la partie se termine quand un joueur atteint `targetScore`.
 */

export interface CardInstance {
  uid: string;
  entry: string;
}

export type CardPhase = 'play' | 'pick-family' | 'round-over' | 'final';

export interface CardGameState {
  def: CardGameDefinition;
  settings: CardSettings;
  started: boolean;
  /** Ordre des tours : joueurs de la partie, dans l'ordre d'arrivée. */
  order: string[];
  names: Record<string, string>;
  hands: Record<string, CardInstance[]>;
  /** Pioche : la dernière carte est la prochaine piochée. */
  draw: CardInstance[];
  /** Défausse : la dernière carte est celle du dessus. */
  discard: CardInstance[];
  /** Famille active (celle qu'il faut suivre). */
  family: string;
  direction: 1 | -1;
  /** Index dans `order` du joueur dont c'est le tour. */
  turn: number;
  /** Le joueur dont c'est le tour a déjà pioché. */
  drew: boolean;
  phase: CardPhase;
  /** Joueur qui doit choisir une famille (après un joker). */
  picker: string | null;
  /** Nombre de tours à avancer une fois la famille choisie (1 ou 2). */
  pendingSteps: number;
  scores: Record<string, number>;
  round: number;
  roundWinner: string | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

const TURN = 'turn';
const NEXT_ROUND = 'next-round';
const NEXT_ROUND_MS = 6000;

const actionSchemas = {
  play: z.object({ cardId: z.string().min(1).max(40) }),
  draw: z.any().optional(),
  pass: z.any().optional(),
  'choose-family': z.object({ family: z.string().min(1).max(16) }),
};

function entryMap(def: CardGameDefinition): Map<string, CardEntry> {
  return new Map(def.cards.map((c) => [c.id, c]));
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function cardLabel(entry: CardEntry): string {
  return entry.label || entry.symbol;
}

/** Une carte « simple » : ni effet, ni joker. Seules celles-ci peuvent ouvrir la défausse. */
function isPlainCard(entry: CardEntry): boolean {
  return entry.effect === 'none' && entry.family !== WILD_FAMILY;
}

function buildDeck(def: CardGameDefinition, random: () => number): CardInstance[] {
  const cards: CardInstance[] = [];
  for (const entry of def.cards) {
    for (let copy = 0; copy < entry.count; copy++) {
      cards.push({ uid: `${entry.id}#${copy}`, entry: entry.id });
    }
  }
  return shuffle(cards, random);
}

/** Vrai si la carte peut être posée sur la défausse dans l'état donné. */
export function canPlayCard(state: Pick<CardGameState, 'def' | 'family' | 'discard'>, entry: CardEntry): boolean {
  if (entry.family === WILD_FAMILY) return true;
  if (entry.family === state.family) return true;
  const mode = state.def.rules.matchOn;
  if (mode === 'family') return false;
  const top = state.discard[state.discard.length - 1];
  const topEntry = top ? entryMap(state.def).get(top.entry) : undefined;
  return topEntry !== undefined && entry.symbol === topEntry.symbol;
}

function who(s: CardGameState, id: string): string {
  return s.names[id] ?? '?';
}

/** Tour suivant sans tenir compte de la connexion : sert à calculer les victimes. */
function rawSeat(s: CardGameState, from: number, steps: number): number {
  return mod(from + s.direction * steps, s.order.length);
}

/** Tour suivant en sautant les joueurs déconnectés (s'il en reste de connectés). */
function seatAfter(s: CardGameState, from: number, steps: number, ctx: GameContext): number {
  const connected = new Set(ctx.connectedPlayerIds());
  let idx = rawSeat(s, from, steps);
  for (let guard = 0; guard < s.order.length; guard++) {
    if (connected.size === 0 || connected.has(s.order[idx]!)) break;
    idx = rawSeat(s, idx, 1);
  }
  return idx;
}

function takeCard(s: CardGameState, ctx: GameContext): CardInstance | undefined {
  if (s.draw.length === 0 && s.discard.length > 1) {
    const top = s.discard[s.discard.length - 1]!;
    s.draw = shuffle(s.discard.slice(0, -1), ctx.random);
    s.discard = [top];
  }
  return s.draw.pop();
}

function drawInto(s: CardGameState, ctx: GameContext, id: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const card = takeCard(s, ctx);
    if (!card) break;
    s.hands[id]!.push(card);
  }
}

function beginTurn(s: CardGameState, ctx: GameContext): void {
  ctx.cancel(TURN);
  s.drew = false;
  const ms = s.settings.turnSeconds * 1000;
  if (ms > 0) {
    ctx.schedule(TURN, ms);
    s.turnEndsAt = ctx.now() + ms;
  } else {
    s.turnEndsAt = null;
  }
}

function endTurn(s: CardGameState, steps: number, ctx: GameContext): void {
  s.turn = seatAfter(s, s.turn, steps, ctx);
  s.phase = 'play';
  s.picker = null;
  s.pendingSteps = 0;
  beginTurn(s, ctx);
}

/** Donne une nouvelle manche. `s.turn` désigne le joueur qui commence. */
function dealRound(s: CardGameState, ctx: GameContext): CardGameState {
  const map = entryMap(s.def);
  const deck = buildDeck(s.def, ctx.random);
  s.hands = {};
  for (const id of s.order) s.hands[id] = [];
  for (let i = 0; i < s.def.rules.handSize; i++) {
    for (const id of s.order) {
      const card = deck.pop();
      if (card) s.hands[id]!.push(card);
    }
  }
  s.draw = deck;

  // La carte de départ doit être simple : sinon elle déclencherait un effet sans joueur.
  const startIdx = s.draw.findIndex((c) => isPlainCard(map.get(c.entry)!));
  const start = startIdx >= 0 ? s.draw.splice(startIdx, 1)[0]! : s.draw.pop()!;
  s.discard = [start];
  s.family = map.get(start.entry)!.family;
  s.direction = 1;
  s.round += 1;
  s.roundWinner = null;
  s.phase = 'play';
  s.picker = null;
  s.pendingSteps = 0;
  s.lastEvent = `Manche ${s.round} : ${who(s, s.order[s.turn]!)} commence.`;
  beginTurn(s, ctx);
  return s;
}

function endRound(s: CardGameState, winnerId: string, ctx: GameContext): void {
  const map = entryMap(s.def);
  let points = 0;
  for (const id of s.order) {
    if (id === winnerId) continue;
    for (const card of s.hands[id] ?? []) points += map.get(card.entry)!.points;
  }
  s.scores[winnerId] = (s.scores[winnerId] ?? 0) + points;
  s.roundWinner = winnerId;
  ctx.cancel(TURN);
  s.turnEndsAt = null;

  const leader = Math.max(...s.order.map((id) => s.scores[id] ?? 0));
  if (leader >= s.settings.targetScore) {
    s.phase = 'final';
    s.lastEvent = `${who(s, winnerId)} remporte la partie avec ${s.scores[winnerId]} points !`;
  } else {
    s.phase = 'round-over';
    s.lastEvent = `${who(s, winnerId)} termine la manche (+${points} points).`;
    ctx.schedule(NEXT_ROUND, NEXT_ROUND_MS);
  }
}

function playCard(s: CardGameState, playerId: string, index: number, entry: CardEntry, ctx: GameContext): void {
  const [card] = s.hands[playerId]!.splice(index, 1);
  s.discard.push(card!);
  if (entry.family !== WILD_FAMILY) s.family = entry.family;

  const name = who(s, playerId);
  if (s.hands[playerId]!.length === 0) {
    endRound(s, playerId, ctx);
    return;
  }

  const n = s.order.length;
  let steps = 1;
  let text = `${name} joue ${cardLabel(entry)}.`;
  const victimId = () => s.order[rawSeat(s, s.turn, 1)]!;

  switch (entry.effect) {
    case 'none':
      break;
    case 'skip':
      steps = 2;
      text += ` ${who(s, victimId())} passe son tour.`;
      break;
    case 'reverse':
      s.direction = s.direction === 1 ? -1 : 1;
      if (n === 2) steps = 2;
      text += ' Le sens du jeu change.';
      break;
    case 'draw2': {
      const victim = victimId();
      drawInto(s, ctx, victim, 2);
      steps = 2;
      text += ` ${who(s, victim)} pioche 2 cartes et passe.`;
      break;
    }
    case 'draw4': {
      const victim = victimId();
      drawInto(s, ctx, victim, 4);
      s.phase = 'pick-family';
      s.picker = playerId;
      s.pendingSteps = 2;
      text += ` ${who(s, victim)} pioche 4 cartes. Choisissez la couleur.`;
      break;
    }
    case 'wild':
      s.phase = 'pick-family';
      s.picker = playerId;
      s.pendingSteps = 1;
      text += ' Choisissez la couleur.';
      break;
  }

  s.lastEvent = text;
  if (s.phase === 'pick-family') return;
  endTurn(s, steps, ctx);
}

/** Famille la plus représentée dans une main (utile pour les robots et le temps écoulé). */
function majorityFamily(s: CardGameState, playerId: string): string {
  const map = entryMap(s.def);
  const counts = new Map<string, number>();
  for (const card of s.hands[playerId] ?? []) {
    const fam = map.get(card.entry)!.family;
    if (fam === WILD_FAMILY) continue;
    counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  let best = s.def.families[0]!.id;
  let bestCount = -1;
  for (const [fam, count] of counts) {
    if (count > bestCount) {
      best = fam;
      bestCount = count;
    }
  }
  return best;
}

/** Crée un jeu jouable à partir d'une définition validée. */
export function createCardGame(
  def: CardGameDefinition,
  options: { id: string },
): GameModule<CardGameState, CardSettings> {
  const { rules } = def;
  const settingsSchema = cardSettingsSchema({
    targetScore: rules.targetScore,
    turnSeconds: rules.turnSeconds,
  });
  const defaultSettings: CardSettings = {
    targetScore: rules.targetScore,
    turnSeconds: rules.turnSeconds,
  };

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
    durationMin: Math.max(5, Math.round(rules.targetScore / 25)),
    notice: def.notice,
  };

  function initialize(settings: CardSettings, players: PlayerRef[]): CardGameState {
    return {
      def,
      settings,
      started: false,
      order: players.map((p) => p.id),
      names: directory(players),
      hands: {},
      draw: [],
      discard: [],
      family: def.families[0]!.id,
      direction: 1,
      turn: 0,
      drew: false,
      phase: 'play',
      picker: null,
      pendingSteps: 0,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      round: 0,
      roundWinner: null,
      lastEvent: '',
      turnEndsAt: null,
    };
  }

  function onPlayerJoin(state: CardGameState, player: PlayerRef): CardGameState {
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.started && !s.order.includes(player.id)) {
      s.order.push(player.id);
      s.scores[player.id] = 0;
    }
    return s;
  }

  function onPlayerLeave(state: CardGameState, player: PlayerRef): CardGameState {
    if (state.started) return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.scores[player.id];
    return s;
  }

  function start(state: CardGameState, ctx: GameContext): GameResult<CardGameState> {
    if (state.started) return fail('La partie est déjà lancée.');
    if (state.order.length < rules.minPlayers) {
      return fail(`Il faut au moins ${rules.minPlayers} joueurs.`);
    }
    const s = structuredClone(state);
    s.started = true;
    s.turn = 0;
    s.round = 0;
    return ok(dealRound(s, ctx));
  }

  function handleAction(
    state: CardGameState,
    player: PlayerRef,
    type: string,
    payload: unknown,
    ctx: GameContext,
  ): GameResult<CardGameState> {
    const s = structuredClone(state);
    const pid = player.id;
    if (!s.started || !s.hands[pid]) return fail('Vous ne participez pas à cette manche.');
    const map = entryMap(s.def);
    const myTurn = s.order[s.turn] === pid;

    switch (type) {
      case 'play': {
        if (s.phase !== 'play') return fail('Choisissez une famille avant de jouer.');
        if (!myTurn) return fail("Ce n'est pas votre tour.");
        const { cardId } = payload as { cardId: string };
        const index = s.hands[pid]!.findIndex((c) => c.uid === cardId);
        if (index < 0) return fail('Cette carte n’est plus dans votre main.');
        const entry = map.get(s.hands[pid]![index]!.entry)!;
        if (!canPlayCard(s, entry)) return fail('Cette carte ne va pas sur la défausse.');
        playCard(s, pid, index, entry, ctx);
        return ok(s);
      }
      case 'draw': {
        if (s.phase !== 'play') return fail('Choisissez une famille avant de piocher.');
        if (!myTurn) return fail("Ce n'est pas votre tour.");
        if (s.drew) return fail('Vous avez déjà pioché.');
        const card = takeCard(s, ctx);
        if (card) s.hands[pid]!.push(card);
        s.drew = true;
        s.lastEvent = card ? `${who(s, pid)} pioche une carte.` : `${who(s, pid)} ne peut plus piocher.`;
        return ok(s);
      }
      case 'pass': {
        if (s.phase !== 'play') return fail('Choisissez une famille avant de passer.');
        if (!myTurn) return fail("Ce n'est pas votre tour.");
        if (!s.drew) return fail('Piochez une carte avant de passer.');
        s.lastEvent = `${who(s, pid)} passe.`;
        endTurn(s, 1, ctx);
        return ok(s);
      }
      case 'choose-family': {
        if (s.phase !== 'pick-family' || s.picker !== pid) {
          return fail('Rien à choisir pour vous pour le moment.');
        }
        const { family } = payload as { family: string };
        const chosen = s.def.families.find((f) => f.id === family);
        if (!chosen) return fail('Famille inconnue.');
        const steps = s.pendingSteps || 1;
        s.family = chosen.id;
        s.lastEvent = `${who(s, pid)} choisit ${chosen.label}.`;
        endTurn(s, steps, ctx);
        return ok(s);
      }
      default:
        return fail('Action inconnue.');
    }
  }

  function startNextRound(state: CardGameState, ctx: GameContext): CardGameState {
    if (state.phase !== 'round-over') return state;
    const s = structuredClone(state);
    ctx.cancel(NEXT_ROUND);
    const winner = s.roundWinner ? s.order.indexOf(s.roundWinner) : -1;
    s.turn = winner >= 0 ? winner : s.turn;
    return dealRound(s, ctx);
  }

  function onTimer(state: CardGameState, key: string, ctx: GameContext): CardGameState {
    if (key === NEXT_ROUND) return startNextRound(state, ctx);
    if (key !== TURN || !state.started) return state;

    const s = structuredClone(state);
    if (s.phase === 'pick-family' && s.picker) {
      const fam = majorityFamily(s, s.picker);
      const steps = s.pendingSteps || 1;
      s.family = fam;
      s.lastEvent = `Temps écoulé : ${who(s, s.picker)} garde ${fam}.`;
      endTurn(s, steps, ctx);
    } else if (s.phase === 'play') {
      const current = s.order[s.turn]!;
      if (!s.drew) {
        const card = takeCard(s, ctx);
        if (card) s.hands[current]!.push(card);
      }
      s.lastEvent = `Temps écoulé pour ${who(s, current)}.`;
      endTurn(s, 1, ctx);
    }
    return s;
  }

  function nextRound(state: CardGameState, ctx: GameContext): CardGameState {
    return startNextRound(state, ctx);
  }

  function calculateScores(state: CardGameState) {
    const names = Object.fromEntries(state.order.map((id) => [id, state.names[id] ?? '?']));
    return rankEntries(names, state.scores);
  }

  function end(state: CardGameState, ctx: GameContext): CardGameState {
    if (state.phase === 'final') return state;
    const s = structuredClone(state);
    ctx.cancel(TURN);
    ctx.cancel(NEXT_ROUND);
    s.turnEndsAt = null;
    s.phase = 'final';
    s.lastEvent = 'Partie interrompue.';
    return s;
  }

  function getPublicState(state: CardGameState) {
    const current = state.started && state.phase !== 'final' ? (state.order[state.turn] ?? null) : null;
    const revealed = state.phase === 'round-over' || state.phase === 'final';
    return {
      phase: state.phase,
      started: state.started,
      def: state.def,
      settings: state.settings,
      round: state.round,
      order: state.order,
      names: state.names,
      scores: state.scores,
      current,
      picker: state.picker,
      family: state.family,
      direction: state.direction,
      drew: state.drew,
      counts: Object.fromEntries(state.order.map((id) => [id, state.hands[id]?.length ?? 0])),
      drawCount: state.draw.length,
      top: state.discard[state.discard.length - 1] ?? null,
      roundWinner: state.roundWinner,
      lastEvent: state.lastEvent,
      turnEndsAt: state.turnEndsAt,
      revealed: revealed ? state.hands : null,
    };
  }

  function getPlayerState(state: CardGameState, playerId: string) {
    const hand = state.hands[playerId] ?? [];
    const map = entryMap(state.def);
    const myTurn = state.phase === 'play' && state.order[state.turn] === playerId;
    const playable = myTurn ? hand.filter((c) => canPlayCard(state, map.get(c.entry)!)).map((c) => c.uid) : [];
    return {
      hand,
      playable,
      spectator: !state.hands[playerId],
      isMyTurn: myTurn,
      canDraw: myTurn && !state.drew,
      canPass: myTurn && state.drew,
      mustPick: state.phase === 'pick-family' && state.picker === playerId,
    };
  }

  function isFinished(state: CardGameState): boolean {
    return state.phase === 'final';
  }

  function suggest(state: CardGameState, playerId: string) {
    if (!state.started) return null;
    if (state.phase === 'pick-family' && state.picker === playerId) {
      return {
        type: 'choose-family',
        payload: { family: majorityFamily(state, playerId) },
        key: `pick:${state.round}:${state.hands[playerId]?.length ?? 0}`,
      };
    }
    if (state.phase === 'play' && state.order[state.turn] === playerId) {
      const map = entryMap(state.def);
      const playable = (state.hands[playerId] ?? []).find((c) => canPlayCard(state, map.get(c.entry)!));
      if (playable) {
        return { type: 'play', payload: { cardId: playable.uid }, key: `play:${playable.uid}` };
      }
      const len = state.hands[playerId]?.length ?? 0;
      if (!state.drew) {
        return { type: 'draw', key: `draw:${state.round}:${state.turn}:${len}` };
      }
      return { type: 'pass', key: `pass:${state.round}:${state.turn}:${len}` };
    }
    return null;
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
