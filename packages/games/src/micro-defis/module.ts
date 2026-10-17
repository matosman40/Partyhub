import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, everyConnectedDone, fail, ok, rankEntries } from '../common/engine.js';
import {
  MICROGAMES,
  buildSequence,
  judge,
  losingValue,
  winningValue,
  type Microgame,
  type MicrogameId,
} from './microgames.js';

/**
 * Micro-Défis, dans l'esprit des jeux-éclair à la WarioWare : une succession de défis très courts, les mêmes pour
 * tout le monde. Le téléphone est la manette : il secoue, il penche, il tourne, il souffle, il tapote.
 *
 * Déroulement d'une manche : présentation du défi (2,5 s), défi (5 à 6 s, ou plus tôt si tous ont fini),
 * bilan (3,5 s). Les points viennent de la réussite et de la rapidité.
 * La valeur envoyée par le téléphone est jugée par `judge` (voir microgames.ts) : le serveur ne croit jamais
 * un résultat impossible dans le temps écoulé.
 */

export const microDefisSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(12).default(6),
});

export type MicroDefisSettings = z.infer<typeof microDefisSettingsSchema>;

const INTRO_MS = 2500;
const REVEAL_MS = 3500;

const INTRO_END = 'intro-end';
const PLAY_END = 'play-end';
const REVEAL_END = 'reveal-end';

export type MicroDefisPhase = 'ready' | 'intro' | 'play' | 'reveal' | 'final';

export interface Submission {
  value: number;
  success: boolean;
  points: number;
  /** Temps écoulé côté serveur à la réception, en millisecondes. */
  elapsed: number;
}

export interface MicroDefisState {
  phase: MicroDefisPhase;
  settings: MicroDefisSettings;
  players: Record<string, string>;
  points: Record<string, number>;
  sequence: MicrogameId[];
  /** Index du défi en cours (à partir de 0). */
  round: number;
  /** Début du défi, horloge serveur (ms epoch). 0 hors défi. */
  startedAt: number;
  introEndsAt: number;
  endsAt: number;
  revealEndsAt: number;
  submissions: Record<string, Submission>;
  /** Résultats du bilan en cours, ou null. */
  results: Record<string, { success: boolean; points: number }> | null;
}

/** Défi en cours, ou null hors manche. */
function currentGame(s: MicroDefisState): Microgame | null {
  const id = s.sequence[s.round];
  return id ? MICROGAMES[id] : null;
}

/** Description publique d'un défi : tout ce qu'il faut pour l'afficher, rien sur la réponse. */
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

function cancelAll(ctx: GameContext): void {
  for (const key of [INTRO_END, PLAY_END, REVEAL_END]) ctx.cancel(key);
}

function beginIntro(s: MicroDefisState, ctx: GameContext): MicroDefisState {
  ctx.cancel(REVEAL_END);
  ctx.schedule(INTRO_END, INTRO_MS);
  return {
    ...s,
    phase: 'intro',
    submissions: {},
    results: null,
    startedAt: 0,
    endsAt: 0,
    revealEndsAt: 0,
    introEndsAt: ctx.now() + INTRO_MS,
  };
}

function beginPlay(s: MicroDefisState, ctx: GameContext): MicroDefisState {
  const game = currentGame(s);
  if (!game) return s;
  ctx.cancel(INTRO_END);
  ctx.schedule(PLAY_END, game.durationMs);
  const now = ctx.now();
  return { ...s, phase: 'play', startedAt: now, endsAt: now + game.durationMs, introEndsAt: 0 };
}

/** Clôt le défi : les joueurs sans réponse ratent, puis le bilan s'affiche. */
function finishPlay(s: MicroDefisState, ctx: GameContext): MicroDefisState {
  ctx.cancel(PLAY_END);
  ctx.schedule(REVEAL_END, REVEAL_MS);
  const results: Record<string, { success: boolean; points: number }> = {};
  let points = s.points;
  for (const id of Object.keys(s.players)) {
    const sub = s.submissions[id];
    results[id] = { success: sub?.success ?? false, points: sub?.points ?? 0 };
    if (sub?.points) points = addPoints(points, id, sub.points);
  }
  return {
    ...s,
    phase: 'reveal',
    points,
    results,
    endsAt: 0,
    revealEndsAt: ctx.now() + REVEAL_MS,
  };
}

/** Passe au défi suivant, ou termine la partie après le dernier. */
function advance(s: MicroDefisState, ctx: GameContext): MicroDefisState {
  ctx.cancel(REVEAL_END);
  if (s.round + 1 < s.settings.rounds) return beginIntro({ ...s, round: s.round + 1 }, ctx);
  return finish(s, ctx);
}

function finish(s: MicroDefisState, ctx: GameContext): MicroDefisState {
  cancelAll(ctx);
  return { ...s, phase: 'final', results: null };
}

function resultsOf(s: MicroDefisState): { playerId: string; name: string; success: boolean; points: number }[] {
  if (!s.results) return [];
  return Object.keys(s.players).map((id) => ({
    playerId: id,
    name: s.players[id] ?? '?',
    success: s.results?.[id]?.success ?? false,
    points: s.results?.[id]?.points ?? 0,
  }));
}

export const microDefis: GameModule<MicroDefisState, MicroDefisSettings> = {
  manifest: {
    id: 'micro-defis',
    category: 'plateau',
    name: 'Micro-Défis',
    description: 'Des défis éclair à la manette : secouez, penchez, tournez, soufflez, tapotez !',
    icon: '🎮',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 8,
    notice: {
      goal: 'Réussir le plus de défis, et le plus vite possible.',
      steps: [
        'Chaque défi est présenté sur l’écran principal, puis joué en même temps par tout le monde.',
        'Le téléphone est la manette : secouez-le, gardez-le à plat, faites-le tourner, soufflez dans le micro ou tapotez.',
        'Un défi réussi rapporte 100 points, plus jusqu’à 60 points pour la rapidité.',
        'Quand tout le monde a joué, ou quand le temps est écoulé, le bilan s’affiche, puis le défi suivant.',
      ],
      tips: [
        'Le micro et le mouvement demandent HTTPS sur le réseau local (voir la page « Test des appareils »).',
        'Un téléphone sans capteur peut toujours jouer les défis « Tapote vite » et « Pile au bon moment ».',
        'Le téléphone doit être tenu comme au départ : la pose de départ sert de référence.',
      ],
    },
  },

  settingsSchema: microDefisSettingsSchema,
  defaultSettings: microDefisSettingsSchema.parse({}),

  actions: {
    done: z.object({ value: z.number().min(0).max(100_000) }),
  },

  initialize(settings, players) {
    const parsed = microDefisSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      sequence: [],
      round: 0,
      startedAt: 0,
      introEndsAt: 0,
      endsAt: 0,
      revealEndsAt: 0,
      submissions: {},
      results: null,
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return {
      ...s,
      players: { ...s.players, [p.id]: p.name },
      points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
    };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    const players = { ...s.players };
    const points = { ...s.points };
    delete players[p.id];
    delete points[p.id];
    return { ...s, players, points };
  },

  start(s, ctx) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (Object.keys(s.players).length === 0) return fail('Aucun joueur');
    const sequence = buildSequence(s.settings.rounds, () => ctx.random());
    return ok(beginIntro({ ...s, sequence, round: 0 }, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (type !== 'done') return fail('Action inconnue');
    if (s.phase !== 'play') return fail('Rien à jouer pour le moment');
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (p.id in s.submissions) return fail('Vous avez déjà joué ce défi');
    const game = currentGame(s);
    if (!game) return fail('Rien à jouer pour le moment');
    const { value } = payload as { value: number };
    const elapsed = Math.max(0, ctx.now() - s.startedAt);
    const verdict = judge(game, value, elapsed);
    const next: MicroDefisState = {
      ...s,
      submissions: { ...s.submissions, [p.id]: { value, success: verdict.success, points: verdict.points, elapsed } },
    };
    const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.submissions);
    return ok(done ? finishPlay(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === INTRO_END && s.phase === 'intro') return beginPlay(s, ctx);
    if (key === PLAY_END && s.phase === 'play') return finishPlay(s, ctx);
    if (key === REVEAL_END && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'intro') return beginPlay(s, ctx);
    if (s.phase === 'play') return finishPlay(s, ctx);
    if (s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  calculateScores(s) {
    return rankEntries(s.players, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  getPublicState(s) {
    const game = s.phase === 'ready' || s.phase === 'final' ? null : currentGame(s);
    return {
      phase: s.phase,
      round: s.round + 1,
      rounds: s.settings.rounds,
      microgame: game ? describe(game) : null,
      introEndsAt: s.introEndsAt,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      revealEndsAt: s.revealEndsAt,
      players: Object.entries(s.players).map(([id, name]) => ({ id, name })),
      // Qui a déjà joué ce défi (sans le résultat, qui ne s'affiche qu'au bilan).
      submitted: Object.keys(s.submissions),
      results: s.phase === 'reveal' ? resultsOf(s) : null,
      ranking: rankEntries(s.players, s.points),
    };
  },

  getPlayerState(s, playerId) {
    const sub = s.submissions[playerId];
    return {
      submitted: Boolean(sub),
      mine: s.phase === 'reveal' && s.results ? (s.results[playerId] ?? null) : null,
      points: s.points[playerId] ?? 0,
    };
  },

  getHostState(s) {
    return {
      pending: Object.keys(s.players)
        .filter((id) => !(id in s.submissions))
        .map((id) => s.players[id] ?? '?'),
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  /** Robots du mode test : réussissent six fois sur dix, sans jamais jouer deux fois le même défi. */
  suggest(s, playerId, random) {
    if (s.phase !== 'play' || playerId in s.submissions) return null;
    const game = currentGame(s);
    if (!game) return null;
    const succeed = random() < 0.6;
    return {
      type: 'done',
      payload: { value: succeed ? winningValue(game) : losingValue(game) },
      key: `${s.round}:${playerId}`,
    };
  },
};
