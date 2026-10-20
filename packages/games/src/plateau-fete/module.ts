import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok } from '../common/engine.js';
import {
  MICROGAMES,
  buildSequence,
  judge,
  losingValue,
  winningValue,
  type Microgame,
  type MicrogameId,
} from '../micro-defis/microgames.js';
import {
  CHOICES,
  DEFIS,
  DEPART_BONUS,
  MINIGAME_EVERY,
  PARI,
  PARTICIPATION,
  PICKPOCKET,
  PIECES_GAIN,
  PIECES_LOSS,
  RAIN,
  RING,
  SHIFT,
  START_COINS,
  STAR_COST,
  STAR_COUNT,
  STAR_SPOTS,
  TIMING,
  TURNS,
  competitionRanks,
  defaultChoice,
  drawEvent,
  estimatedMinutes,
  isChoiceFor,
  jumpSteps,
  kindAt,
  leaderOf,
  payoutFor,
  rollDie,
  standings,
  walk,
  wrap,
  type CellKind,
  type Choice,
  type ChoiceKind,
  type EventId,
} from './rules.js';

/**
 * Plateau fête : un jeu de plateau au dé, joué sur les téléphones. Chaque tour, tout le monde lance le dé en même
 * temps, les pions avancent sur un anneau de cases, et les cases donnent des pièces, des événements ou une étoile
 * à acheter. Tous les trois tours, un mini-jeu de cinq défis (les micro-défis) distribue des pièces.
 *
 * Déroulement d’un tour : bannière (2,5 s), lancer (12 s au plus, ou plus tôt si tout le monde a lancé), déplacement
 * (5 s), choix éventuels (8 s au plus), bilan (3,5 s). Le serveur tire tous les dés et toutes les cartes ; le
 * téléphone ne fait que les envoyer, et l’écran principal ne reçoit que ce qui se voit.
 */

export const plateauSettingsSchema = z.object({});
export type PlateauSettings = z.infer<typeof plateauSettingsSchema>;

/** Un seul minuteur par partie : la phase en cours en a toujours un (sauf « prête » et « finale »). */
const TIMER = 'next';

export type PlateauPhase =
  | 'ready'
  | 'intro'
  | 'banner'
  | 'roll'
  | 'move'
  | 'choice'
  | 'resolve'
  | 'mg-intro'
  | 'mg-play'
  | 'mg-reveal'
  | 'mg-results'
  | 'final';

/** Un déplacement, pour l’animation de l’écran principal : les distances visitées, pas à pas. */
export interface MoveRecord {
  id: string;
  /** Résultat du dé (0 pour un déplacement subi, sans dé). */
  roll: number;
  path: number[];
  to: number;
}

export interface PendingChoice {
  kind: ChoiceKind;
  title: string;
  /** Pour l’étoile : la case où elle se trouve, pour la déplacer après un achat. */
  cell?: number;
}

export interface Submission {
  value: number;
  success: boolean;
  points: number;
  /** Temps écoulé côté serveur à la réception, en millisecondes. */
  elapsed: number;
}

export interface MiniGameState {
  /** Numéro du mini-jeu dans la partie, à partir de 1. */
  number: number;
  sequence: MicrogameId[];
  /** Défi en cours, à partir de 0. */
  round: number;
  startedAt: number;
  submissions: Record<string, Submission>;
  /** Points cumulés de chaque joueur dans ce mini-jeu. */
  points: Record<string, number>;
  /** Bilan du défi en cours, une fois joué. */
  reveal: Record<string, { success: boolean; points: number }> | null;
  /** Pièces gagnées au classement du mini-jeu, une fois celui-ci terminé. */
  payouts: Record<string, number> | null;
}

export interface EventView {
  id: EventId;
  name: string;
  icon: string;
  text: string;
  by: string;
}

export interface PlateauState {
  phase: PlateauPhase;
  names: Record<string, string>;
  /** Joueurs dans l’ordre d’arrivée : l’ordre de tous les tirages et de tous les déplacements. */
  order: string[];
  turn: number;
  /** Distance parcourue, sans borne : la case est cette distance modulo `RING`. */
  dist: Record<string, number>;
  coins: Record<string, number>;
  stars: Record<string, number>;
  /** Cases où se trouvent les étoiles à acheter (`STAR_COUNT` cases, toutes différentes). */
  starCells: number[];
  rolls: Record<string, number>;
  moves: MoveRecord[];
  /** Compteur qui change à chaque déplacement : l’écran principal rejoue l’animation quand il change. */
  moveStamp: number;
  pending: Record<string, PendingChoice>;
  event: EventView | null;
  /** Ce qui s’est passé pendant le tour, une phrase par joueur. */
  notes: string[];
  mg: MiniGameState | null;
  /** Échéance de la phase en cours, horloge serveur (0 hors minuteur). */
  nextAt: number;
}

/** Description publique d’un défi : tout ce qu’il faut pour l’afficher, sans rien sur la réponse. */
function describe(game: Microgame) {
  return {
    id: game.id,
    name: game.name,
    icon: game.icon,
    instruction: game.instruction,
    hint: game.hint,
    durationMs: game.durationMs,
    sensor: game.sensor,
    target: game.target,
  };
}

const zeroes = (ids: string[]): Record<string, number> => Object.fromEntries(ids.map((id) => [id, 0]));

/* ---------- Transitions de phase (elles modifient le brouillon fourni par l’appelant) ---------- */

function enter(s: PlateauState, phase: PlateauPhase, ms: number, ctx: GameContext): PlateauState {
  ctx.cancel(TIMER);
  ctx.schedule(TIMER, ms);
  s.phase = phase;
  s.nextAt = ctx.now() + ms;
  return s;
}

function finish(s: PlateauState, ctx: GameContext): PlateauState {
  ctx.cancel(TIMER);
  s.phase = 'final';
  s.nextAt = 0;
  return s;
}

function beginTurn(s: PlateauState, turn: number, ctx: GameContext): PlateauState {
  s.turn = turn;
  s.rolls = {};
  s.moves = [];
  s.pending = {};
  s.event = null;
  s.notes = [];
  s.mg = null;
  return enter(s, 'banner', TIMING.banner, ctx);
}

function beginRoll(s: PlateauState, ctx: GameContext): PlateauState {
  s.rolls = {};
  return enter(s, 'roll', TIMING.rollMax, ctx);
}

/** Passe au tour suivant, ou termine la partie après le dernier tour. */
function nextTurnOrEnd(s: PlateauState, ctx: GameContext): PlateauState {
  if (s.turn >= TURNS) return finish(s, ctx);
  return beginTurn(s, s.turn + 1, ctx);
}

/* ---------- Le tour : dés, déplacements, choix, bilan ---------- */

/** Fait avancer un joueur, sans effet de case. Renvoie les distances visitées. */
function shift(s: PlateauState, id: string, steps: number): number[] {
  const from = s.dist[id] ?? 0;
  const w = walk(from, steps);
  s.dist[id] = w.to;
  s.coins[id] = (s.coins[id] ?? 0) + w.bonus;
  return w.path;
}

/** Nouvelle case pour une étoile achetée : une case libre, qui n’est ni l’ancienne ni celle d’une autre étoile. */
function moveStar(s: PlateauState, from: number, ctx: GameContext): number {
  const spots = STAR_SPOTS.filter((cell) => cell !== from && !s.starCells.includes(cell));
  return spots[Math.floor(ctx.random() * spots.length)] ?? from;
}

/** Applique l’événement tiré sur la case, et renvoie la phrase du bilan. */
function applyEvent(s: PlateauState, id: string, ctx: GameContext, path: number[]): string {
  const card = drawEvent(() => ctx.random());
  s.event = { id: card.id, name: card.name, icon: card.icon, text: card.text, by: id };
  switch (card.id) {
    case 'pluie':
      s.coins[id] = (s.coins[id] ?? 0) + RAIN;
      return `tire « ${card.name} » : +${RAIN} pièces`;
    case 'pickpocket': {
      const victim = s.order
        .filter((other) => other !== id && (s.coins[other] ?? 0) > 0)
        .sort((a, b) => (s.coins[b] ?? 0) - (s.coins[a] ?? 0))[0];
      if (!victim) return `tire « ${card.name} » : personne à dépouiller`;
      const take = Math.min(PICKPOCKET, s.coins[victim] ?? 0);
      s.coins[victim] = (s.coins[victim] ?? 0) - take;
      s.coins[id] = (s.coins[id] ?? 0) + take;
      return `tire « ${card.name} » : +${take} pièces, prises à ${s.names[victim] ?? '?'}`;
    }
    case 'saut': {
      const steps = jumpSteps(() => ctx.random());
      path.push(...shift(s, id, steps));
      return `tire « ${card.name} » : ${steps} cases d’un bond`;
    }
    case 'echange': {
      const leader = leaderOf(s.order, s.dist);
      const mine = s.dist[id] ?? 0;
      if (!leader || leader === id || (s.dist[leader] ?? 0) <= mine) {
        return `tire « ${card.name} » : vous êtes déjà en tête`;
      }
      const theirs = s.dist[leader] ?? 0;
      s.dist[id] = theirs;
      s.dist[leader] = mine;
      path.push(theirs);
      s.moves.push({ id: leader, roll: 0, path: [mine], to: mine });
      return `tire « ${card.name} » : échange avec ${s.names[leader] ?? '?'}`;
    }
    case 'pari':
      s.pending[id] = { kind: 'pari', title: card.name };
      return `tire « ${card.name} » : à vous de choisir`;
    case 'filante':
      s.stars[id] = (s.stars[id] ?? 0) + 1;
      return `tire « ${card.name} » : une étoile gratuite`;
  }
}

/** Effet de la case d’arrivée. Les déplacements d’avance, de recul ou de saut ne déclenchent pas d’autre case. */
function landOn(s: PlateauState, id: string, kind: CellKind, ctx: GameContext, path: number[]): string[] {
  const parts: string[] = [];
  switch (kind) {
    case 'pieces':
      s.coins[id] = (s.coins[id] ?? 0) + PIECES_GAIN;
      parts.push(`gagne ${PIECES_GAIN} pièces`);
      break;
    case 'perte': {
      const loss = Math.min(PIECES_LOSS, s.coins[id] ?? 0);
      s.coins[id] = (s.coins[id] ?? 0) - loss;
      parts.push(loss > 0 ? `perd ${loss} pièces` : 'n’a rien à perdre');
      break;
    }
    case 'avance':
      path.push(...shift(s, id, SHIFT));
      parts.push(`avance encore de ${SHIFT} cases`);
      break;
    case 'recule':
      path.push(...shift(s, id, -SHIFT));
      parts.push(`recule de ${SHIFT} cases`);
      break;
    case 'event':
      parts.push(applyEvent(s, id, ctx, path));
      break;
    default:
      break;
  }
  return parts;
}

/** Fait jouer le dé d’un joueur : déplacement, passage des départs, case d’arrivée, puis étoile éventuelle. */
function resolveMove(s: PlateauState, id: string, ctx: GameContext): void {
  const roll = s.rolls[id] ?? 1;
  const first = walk(s.dist[id] ?? 0, roll);
  s.dist[id] = first.to;
  s.coins[id] = (s.coins[id] ?? 0) + first.bonus;
  const path = [...first.path];
  const parts = [`avance de ${roll} case${roll > 1 ? 's' : ''}`];
  if (first.bonus > 0) parts.push(`passe le départ (+${DEPART_BONUS} pièces)`);
  parts.push(...landOn(s, id, kindAt(first.to), ctx, path));

  // Une étoile se propose sur la case où le joueur finit, si rien d’autre ne l’occupe déjà.
  const finalCell = wrap(s.dist[id] ?? 0);
  if (s.starCells.includes(finalCell) && !s.pending[id]) {
    if ((s.coins[id] ?? 0) >= STAR_COST) {
      s.pending[id] = { kind: 'etoile', title: 'Étoile', cell: finalCell };
    } else {
      parts.push(`n’a pas les ${STAR_COST} pièces pour l’étoile`);
    }
  }

  s.moves.push({ id, roll, path, to: s.dist[id] ?? 0 });
  s.notes.push(`${s.names[id] ?? '?'} ${parts.join(', ')}.`);
}

/** Tous les dés non lancés le sont par le serveur ; puis tout le monde avance dans l’ordre d’arrivée. */
function beginMove(s: PlateauState, ctx: GameContext): PlateauState {
  for (const id of s.order) {
    if (!(id in s.rolls)) s.rolls[id] = rollDie(() => ctx.random());
  }
  s.moves = [];
  s.notes = [];
  s.moveStamp += 1;
  for (const id of s.order) resolveMove(s, id, ctx);
  return enter(s, 'move', TIMING.move, ctx);
}

function beginChoice(s: PlateauState, ctx: GameContext): PlateauState {
  return enter(s, 'choice', TIMING.choiceMax, ctx);
}

function beginResolve(s: PlateauState, ctx: GameContext): PlateauState {
  return enter(s, 'resolve', TIMING.resolve, ctx);
}

/** Applique le choix d’un joueur (ou la réponse prudente à défaut) et écrit la phrase du bilan. */
function decide(s: PlateauState, id: string, choice: Choice, ctx: GameContext): void {
  const pending = s.pending[id];
  if (!pending) return;
  delete s.pending[id];
  const name = s.names[id] ?? '?';
  if (pending.kind === 'etoile') {
    const cell = pending.cell ?? -1;
    const index = s.starCells.indexOf(cell);
    if (choice === 'acheter' && index >= 0 && (s.coins[id] ?? 0) >= STAR_COST) {
      s.coins[id] = (s.coins[id] ?? 0) - STAR_COST;
      s.stars[id] = (s.stars[id] ?? 0) + 1;
      s.starCells[index] = moveStar(s, cell, ctx);
      s.notes.push(`${name} achète une étoile pour ${STAR_COST} pièces.`);
    } else {
      s.notes.push(`${name} garde ses pièces.`);
    }
    return;
  }
  if (choice === 'risque') {
    if (ctx.random() < 0.5) {
      s.coins[id] = (s.coins[id] ?? 0) + PARI.win;
      s.notes.push(`${name} gagne le pari : +${PARI.win} pièces.`);
    } else {
      const loss = Math.min(PARI.lose, s.coins[id] ?? 0);
      s.coins[id] = (s.coins[id] ?? 0) - loss;
      s.notes.push(`${name} perd le pari : −${loss} pièces.`);
    }
  } else {
    s.coins[id] = (s.coins[id] ?? 0) + PARI.safe;
    s.notes.push(`${name} joue prudent : +${PARI.safe} pièce.`);
  }
}

/** Temps écoulé pour les choix : ceux qui n’ont pas répondu prennent la réponse par défaut. */
function finishChoices(s: PlateauState, ctx: GameContext): PlateauState {
  for (const id of Object.keys(s.pending)) {
    const pending = s.pending[id];
    if (pending) decide(s, id, defaultChoice(pending.kind), ctx);
  }
  s.pending = {};
  return beginResolve(s, ctx);
}

function afterMove(s: PlateauState, ctx: GameContext): PlateauState {
  if (Object.keys(s.pending).length > 0) return beginChoice(s, ctx);
  return beginResolve(s, ctx);
}

/** Après le bilan : un mini-jeu si le tour est multiple de trois, sinon le tour suivant. */
function afterResolve(s: PlateauState, ctx: GameContext): PlateauState {
  if (s.turn % MINIGAME_EVERY === 0 && s.turn < TURNS) return beginMiniIntro(s, ctx);
  return nextTurnOrEnd(s, ctx);
}

/* ---------- Mini-jeux : cinq défis, puis le classement qui distribue des pièces ---------- */

function beginMiniIntro(s: PlateauState, ctx: GameContext): PlateauState {
  const sequence = buildSequence(DEFIS, () => ctx.random());
  s.mg = {
    number: s.turn / MINIGAME_EVERY,
    sequence,
    round: 0,
    startedAt: 0,
    submissions: {},
    points: zeroes(s.order),
    reveal: null,
    payouts: null,
  };
  return enter(s, 'mg-intro', TIMING.miniIntro, ctx);
}

function currentGame(s: PlateauState): Microgame | null {
  const mg = s.mg;
  const id = mg?.sequence[mg.round];
  return id ? MICROGAMES[id] : null;
}

function beginDefi(s: PlateauState, ctx: GameContext): PlateauState {
  const mg = s.mg;
  const game = currentGame(s);
  if (!mg || !game) return nextTurnOrEnd(s, ctx);
  mg.submissions = {};
  mg.reveal = null;
  mg.startedAt = ctx.now();
  return enter(s, 'mg-play', game.durationMs, ctx);
}

/** Fin du défi : les joueurs sans réponse ratent, les points s’ajoutent, puis le bilan s’affiche. */
function beginReveal(s: PlateauState, ctx: GameContext): PlateauState {
  const mg = s.mg;
  if (!mg) return nextTurnOrEnd(s, ctx);
  const reveal: Record<string, { success: boolean; points: number }> = {};
  for (const id of s.order) {
    const sub = mg.submissions[id];
    reveal[id] = { success: sub?.success ?? false, points: sub?.points ?? 0 };
    mg.points[id] = (mg.points[id] ?? 0) + (sub?.points ?? 0);
  }
  mg.reveal = reveal;
  return enter(s, 'mg-reveal', TIMING.reveal, ctx);
}

function afterReveal(s: PlateauState, ctx: GameContext): PlateauState {
  const mg = s.mg;
  if (!mg) return nextTurnOrEnd(s, ctx);
  if (mg.round + 1 < DEFIS) {
    mg.round += 1;
    return beginDefi(s, ctx);
  }
  return beginMiniResults(s, ctx);
}

/** Classement du mini-jeu : 10, 6, 4 et 2 pièces aux quatre premiers ; sans un seul point, la participation. */
function beginMiniResults(s: PlateauState, ctx: GameContext): PlateauState {
  const mg = s.mg;
  if (!mg) return nextTurnOrEnd(s, ctx);
  const ranks = competitionRanks(s.order, mg.points);
  const payouts: Record<string, number> = {};
  for (const id of s.order) {
    const points = mg.points[id] ?? 0;
    payouts[id] = points > 0 ? payoutFor(ranks[id] ?? s.order.length) : PARTICIPATION;
    s.coins[id] = (s.coins[id] ?? 0) + payouts[id]!;
  }
  mg.payouts = payouts;
  return enter(s, 'mg-results', TIMING.miniResults, ctx);
}

/** Une étape du déroulement, selon la phase : utilisée par le minuteur et par le passage forcé (mode test). */
function step(s: PlateauState, ctx: GameContext): PlateauState {
  switch (s.phase) {
    case 'intro':
      return beginTurn(s, 1, ctx);
    case 'banner':
      return beginRoll(s, ctx);
    case 'roll':
      return beginMove(s, ctx);
    case 'move':
      return afterMove(s, ctx);
    case 'choice':
      return finishChoices(s, ctx);
    case 'resolve':
      return afterResolve(s, ctx);
    case 'mg-intro':
      return beginDefi(s, ctx);
    case 'mg-play':
      return beginReveal(s, ctx);
    case 'mg-reveal':
      return afterReveal(s, ctx);
    case 'mg-results':
      return nextTurnOrEnd(s, ctx);
    default:
      return s;
  }
}

function waitingFor(s: PlateauState): string[] {
  switch (s.phase) {
    case 'roll':
      return s.order.filter((id) => !(id in s.rolls));
    case 'choice':
      return Object.keys(s.pending);
    case 'mg-play':
      return s.order.filter((id) => !(s.mg && id in s.mg.submissions));
    default:
      return [];
  }
}

function playersOf(s: PlateauState) {
  return s.order.map((id) => ({
    id,
    name: s.names[id] ?? '?',
    dist: s.dist[id] ?? 0,
    cell: wrap(s.dist[id] ?? 0),
    coins: s.coins[id] ?? 0,
    stars: s.stars[id] ?? 0,
  }));
}

/** Les pions se montrent quand le dé est tiré, et les cartes quand elles sont jouées. */
const SHOWS_ROLLS: readonly PlateauPhase[] = ['move', 'choice', 'resolve'];

export const plateauFete: GameModule<PlateauState, PlateauSettings> = {
  manifest: {
    id: 'plateau-fete',
    category: 'plateau',
    name: 'Plateau fête',
    description:
      'Un plateau au dé et des étoiles à acheter : lancez, avancez, tentez vos paris, et gagnez des mini-jeux sur vos téléphones.',
    icon: '🎡',
    version: '1.1.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 8,
    durationMin: estimatedMinutes(),
    notice: {
      goal: 'Gagner le plus d’étoiles en fin de partie, puis le plus de pièces.',
      steps: [
        'À chaque tour, tout le monde lance le dé sur son téléphone, puis tous les pions avancent sur l’anneau.',
        'Une case « Pièces » rapporte 3 pièces, une case « Perte » en retire 3, et chaque départ franchi rapporte 2 pièces.',
        `Trois étoiles attendent sur le plateau. Quand on finit son tour sur l’une d’elles, on peut l’acheter pour ${STAR_COST} pièces : elle change alors de place.`,
        'Une case « Événement » tire une carte : une surprise, ou un pari à faire sur le téléphone.',
        'Tous les trois tours, un mini-jeu de cinq défis rapporte 10, 6, 4 et 2 pièces aux quatre premiers.',
        `La partie dure ${TURNS} tours, environ ${estimatedMinutes()} minutes. Le plus d’étoiles gagne ; à égalité, le plus de pièces.`,
      ],
      tips: [
        'Les mini-jeux de mouvement demandent HTTPS sur le réseau local (voir la page « Test des appareils »).',
        'Un téléphone sans capteur peut toujours jouer « Tapote vite » et « Pile au bon moment ».',
        'Un choix non fait à temps prend la réponse prudente : la partie ne reste jamais bloquée.',
      ],
    },
  },

  settingsSchema: plateauSettingsSchema,
  defaultSettings: {},

  actions: {
    roll: z.any().optional(),
    choose: z.object({ choice: z.enum(['acheter', 'garder', 'risque', 'prudence']) }),
    done: z.object({ value: z.number().min(0).max(100_000) }),
  },

  initialize(_settings, players: PlayerRef[]): PlateauState {
    return {
      phase: 'ready',
      names: directory(players),
      order: players.map((p) => p.id),
      turn: 0,
      dist: zeroes(players.map((p) => p.id)),
      coins: Object.fromEntries(players.map((p) => [p.id, START_COINS])),
      stars: zeroes(players.map((p) => p.id)),
      starCells: [],
      rolls: {},
      moves: [],
      moveStamp: 0,
      pending: {},
      event: null,
      notes: [],
      mg: null,
      nextAt: 0,
    };
  },

  onPlayerJoin(state, player) {
    if (state.phase !== 'ready') return state;
    const s = structuredClone(state);
    s.names[player.id] = player.name;
    if (!s.order.includes(player.id)) s.order.push(player.id);
    s.dist[player.id] = 0;
    s.coins[player.id] = START_COINS;
    s.stars[player.id] = 0;
    return s;
  },

  onPlayerLeave(state, player) {
    if (state.phase !== 'ready') return state;
    const s = structuredClone(state);
    s.order = s.order.filter((id) => id !== player.id);
    delete s.names[player.id];
    delete s.dist[player.id];
    delete s.coins[player.id];
    delete s.stars[player.id];
    return s;
  },

  start(state, ctx): GameResult<PlateauState> {
    if (state.phase !== 'ready') return fail('La partie a déjà commencé');
    if (state.order.length < 2) return fail('Il faut au moins 2 joueurs');
    const s = structuredClone(state);
    const spots = [...STAR_SPOTS];
    s.starCells = [];
    for (let i = 0; i < STAR_COUNT && spots.length > 0; i++) {
      const pick = Math.floor(ctx.random() * spots.length);
      s.starCells.push(spots.splice(pick, 1)[0]!);
    }
    return ok(enter(s, 'intro', TIMING.intro, ctx));
  },

  handleAction(state, player, type, payload, ctx): GameResult<PlateauState> {
    if (!(player.id in state.names)) return fail('Vous ne jouez pas cette partie');
    if (type === 'roll') {
      if (state.phase !== 'roll') return fail('Ce n’est pas le moment de lancer le dé');
      if (player.id in state.rolls) return fail('Vous avez déjà lancé le dé');
      const s = structuredClone(state);
      s.rolls[player.id] = rollDie(() => ctx.random());
      if (everyConnectedDone(ctx, s.order, (id) => id in s.rolls)) {
        // Le lancer a commencé à `nextAt - rollMax` : on attend encore s’il n’a pas duré `rollMin`.
        const left = s.nextAt - ctx.now() - (TIMING.rollMax - TIMING.rollMin);
        if (left > 0) {
          ctx.cancel(TIMER);
          ctx.schedule(TIMER, left);
          s.nextAt = ctx.now() + left;
          return ok(s);
        }
        return ok(beginMove(s, ctx));
      }
      return ok(s);
    }
    if (type === 'choose') {
      const pending = state.pending[player.id];
      if (state.phase !== 'choice' || !pending) return fail('Aucun choix à faire pour le moment');
      const { choice } = payload as { choice: string };
      if (!isChoiceFor(pending.kind, choice)) return fail('Ce choix n’est pas proposé');
      const s = structuredClone(state);
      decide(s, player.id, choice, ctx);
      delete s.pending[player.id];
      if (Object.keys(s.pending).length === 0) return ok(beginResolve(s, ctx));
      return ok(s);
    }
    if (type === 'done') {
      if (state.phase !== 'mg-play' || !state.mg) return fail('Rien à jouer pour le moment');
      if (player.id in state.mg.submissions) return fail('Vous avez déjà joué ce défi');
      const game = currentGame(state);
      if (!game) return fail('Rien à jouer pour le moment');
      const s = structuredClone(state);
      const mg = s.mg!;
      const { value } = payload as { value: number };
      const elapsed = Math.max(0, ctx.now() - mg.startedAt);
      const verdict = judge(game, value, elapsed);
      mg.submissions[player.id] = { value, success: verdict.success, points: verdict.points, elapsed };
      if (everyConnectedDone(ctx, s.order, (id) => id in mg.submissions)) return ok(beginReveal(s, ctx));
      return ok(s);
    }
    return fail('Action inconnue');
  },

  onTimer(state, key, ctx) {
    if (key !== TIMER) return state;
    return step(structuredClone(state), ctx);
  },

  nextRound(state, ctx) {
    return step(structuredClone(state), ctx);
  },

  calculateScores(s): ScoreEntry[] {
    // Une seule valeur par joueur : les étoiles d’abord, les pièces ensuite (étoile = 100 points).
    return standings(s.order, s.stars, s.coins).map((row) => ({
      playerId: row.id,
      name: s.names[row.id] ?? '?',
      points: row.stars * 100 + row.coins,
      rank: row.rank,
    }));
  },

  end(state, ctx) {
    return finish(structuredClone(state), ctx);
  },

  getPublicState(s) {
    const mg = s.mg;
    const inMini = mg !== null && s.phase.startsWith('mg-');
    const showsMoves = s.phase === 'move' || s.phase === 'choice' || s.phase === 'resolve';
    const game = currentGame(s);
    return {
      phase: s.phase,
      turn: s.turn,
      turns: TURNS,
      ring: RING,
      nextAt: s.nextAt,
      starCells: s.starCells,
      players: playersOf(s).map((p) => ({
        ...p,
        rolled: p.id in s.rolls,
        roll: SHOWS_ROLLS.includes(s.phase) ? (s.rolls[p.id] ?? null) : null,
        choosing: p.id in s.pending,
      })),
      standings: standings(s.order, s.stars, s.coins).map((row) => ({ ...row, name: s.names[row.id] ?? '?' })),
      waiting: waitingFor(s).map((id) => s.names[id] ?? '?'),
      moves: showsMoves ? s.moves : [],
      moveStamp: s.moveStamp,
      event: showsMoves ? s.event : null,
      notes: showsMoves ? s.notes : [],
      mini:
        inMini && mg
          ? {
              number: mg.number,
              round: mg.round + 1,
              rounds: DEFIS,
              game: game ? describe(game) : null,
              sequence: mg.sequence.map((id) => ({ icon: MICROGAMES[id].icon, name: MICROGAMES[id].name })),
              endsAt: s.phase === 'mg-play' ? s.nextAt : 0,
              submitted: Object.keys(mg.submissions),
              reveal: s.phase === 'mg-reveal' || s.phase === 'mg-results' ? mg.reveal : null,
              points: mg.points,
              payouts: s.phase === 'mg-results' ? mg.payouts : null,
            }
          : null,
      final: s.phase === 'final' ? standings(s.order, s.stars, s.coins) : null,
      names: s.names,
    };
  },

  getPlayerState(s, playerId) {
    const pending = s.pending[playerId];
    return {
      seated: playerId in s.names,
      rolled: playerId in s.rolls,
      roll: s.rolls[playerId] ?? null,
      cell: wrap(s.dist[playerId] ?? 0),
      coins: s.coins[playerId] ?? 0,
      stars: s.stars[playerId] ?? 0,
      starCost: STAR_COST,
      choice: pending ? { kind: pending.kind, title: pending.title, options: CHOICES[pending.kind] } : null,
      mini: s.mg
        ? {
            submitted: playerId in s.mg.submissions,
            reveal: s.mg.reveal?.[playerId] ?? null,
            points: s.mg.points[playerId] ?? 0,
            payout: s.mg.payouts?.[playerId] ?? null,
          }
        : null,
    };
  },

  getHostState() {
    return {};
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  /**
   * Robots du mode test : lancent le dé, choisissent au hasard, et réussissent six défis sur dix. Ils ne jouent qu’à la
   * phase qui les concerne, une fois par décision.
   */
  suggest(s, playerId, random) {
    switch (s.phase) {
      case 'roll':
        return playerId in s.rolls ? null : { type: 'roll', key: `roll:${s.turn}:${playerId}` };
      case 'choice': {
        const pending = s.pending[playerId];
        if (!pending) return null;
        const choice: Choice =
          pending.kind === 'etoile' ? (random() < 0.7 ? 'acheter' : 'garder') : random() < 0.5 ? 'risque' : 'prudence';
        return { type: 'choose', payload: { choice }, key: `choose:${s.turn}:${playerId}` };
      }
      case 'mg-play': {
        const game = currentGame(s);
        if (!s.mg || !game || playerId in s.mg.submissions) return null;
        const value = random() < 0.6 ? winningValue(game) : losingValue(game);
        return { type: 'done', payload: { value }, key: `done:${s.mg.number}:${s.mg.round}:${playerId}` };
      }
      default:
        return null;
    }
  },
};
