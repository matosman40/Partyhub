import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, everyConnectedDone, fail, ok, rankEntries } from '../common/engine.js';
import {
  GAGS,
  buildSequence,
  judge,
  losingAnswer,
  silentOutcome,
  winningAnswer,
  type Answer,
  type Gag,
  type GagId,
  type Judgement,
} from './gags.js';

/**
 * Gags en rafale, dans l’esprit des jeux-éclair loufoques : une succession de gags très courts, les mêmes pour tout
 * le monde, seul ou à plusieurs. Le téléphone est la manette : il glisse, il tape, il gonfle, il reste de marbre.
 *
 * Déroulement d’un gag : présentation (2,2 s), gag (4 à 6 s, ou plus tôt si tous les joueurs connectés ont répondu),
 * bilan (3 s). Une réussite rapporte 100 points, plus jusqu’à 60 pour la rapidité.
 */

export const gagsSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(20).default(10),
});

export type GagsSettings = z.infer<typeof gagsSettingsSchema>;

const INTRO_MS = 2200;
const REVEAL_MS = 3000;

const INTRO_END = 'intro-end';
const PLAY_END = 'play-end';
const REVEAL_END = 'reveal-end';

export type GagsPhase = 'ready' | 'intro' | 'play' | 'reveal' | 'final';

/** Un gag tiré pour la partie, avec sa graine (la mouche s’en sert pour bouger). */
export interface Planned {
  gag: GagId;
  seed: number;
}

export interface Submission {
  success: boolean;
  points: number;
  /** Temps écoulé côté serveur à la réception, en millisecondes. */
  elapsed: number;
}

export interface GagsState {
  phase: GagsPhase;
  settings: GagsSettings;
  players: Record<string, string>;
  points: Record<string, number>;
  plan: Planned[];
  /** Index du gag en cours (à partir de 0). */
  round: number;
  /** Début du gag, horloge serveur (ms epoch). 0 hors gag. */
  startedAt: number;
  introEndsAt: number;
  endsAt: number;
  revealEndsAt: number;
  submissions: Record<string, Submission>;
  /** Résultats du bilan en cours, ou null. */
  results: Record<string, { success: boolean; points: number }> | null;
}

/** Gag en cours, ou null hors manche. */
function current(s: GagsState): Planned | null {
  return s.plan[s.round] ?? null;
}

/** Description publique d’un gag : tout pour l’afficher, rien sur la réponse attendue. */
function describe(planned: Planned) {
  const gag: Gag = GAGS[planned.gag];
  return {
    id: gag.id,
    name: gag.name,
    icon: gag.icon,
    instruction: gag.instruction,
    hint: gag.hint,
    flavor: gag.flavor,
    quips: gag.quips,
    durationMs: gag.durationMs,
    input: gag.input,
    seed: planned.seed,
  };
}

function cancelAll(ctx: GameContext): void {
  for (const key of [INTRO_END, PLAY_END, REVEAL_END]) ctx.cancel(key);
}

function beginIntro(s: GagsState, ctx: GameContext): GagsState {
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

function beginPlay(s: GagsState, ctx: GameContext): GagsState {
  const planned = current(s);
  if (!planned) return s;
  const gag = GAGS[planned.gag];
  ctx.cancel(INTRO_END);
  ctx.schedule(PLAY_END, gag.durationMs);
  const now = ctx.now();
  return { ...s, phase: 'play', startedAt: now, endsAt: now + gag.durationMs, introEndsAt: 0 };
}

/**
 * Clôt le gag. Qui n’a rien envoyé est jugé d’après le gag : un gag d’attente réussit pour qui ne touche à rien,
 * les autres ratent.
 */
function finishPlay(s: GagsState, ctx: GameContext): GagsState {
  ctx.cancel(PLAY_END);
  ctx.schedule(REVEAL_END, REVEAL_MS);
  const planned = current(s);
  const gag = planned ? GAGS[planned.gag] : null;
  // Le silence ne vaut quelque chose que pour un joueur encore là : un joueur parti ne gagne rien à ne rien faire.
  const connected = new Set(ctx.connectedPlayerIds());
  const results: Record<string, { success: boolean; points: number }> = {};
  let points = s.points;
  for (const id of Object.keys(s.players)) {
    const sub = s.submissions[id];
    const silent: Judgement = gag && connected.has(id) ? silentOutcome(gag) : { success: false, points: 0 };
    const verdict: Judgement = sub ?? silent;
    results[id] = { success: verdict.success, points: verdict.points };
    if (results[id].points) points = addPoints(points, id, results[id].points);
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

/** Passe au gag suivant, ou termine la partie après le dernier. */
function advance(s: GagsState, ctx: GameContext): GagsState {
  ctx.cancel(REVEAL_END);
  if (s.round + 1 < s.settings.rounds) return beginIntro({ ...s, round: s.round + 1 }, ctx);
  return finish(s, ctx);
}

function finish(s: GagsState, ctx: GameContext): GagsState {
  cancelAll(ctx);
  return { ...s, phase: 'final', results: null };
}

function resultsOf(s: GagsState): { playerId: string; name: string; success: boolean; points: number }[] {
  if (!s.results) return [];
  return Object.keys(s.players).map((id) => ({
    playerId: id,
    name: s.players[id] ?? '?',
    success: s.results?.[id]?.success ?? false,
    points: s.results?.[id]?.points ?? 0,
  }));
}

export const gagsEnRafale: GameModule<GagsState, GagsSettings> = {
  manifest: {
    id: 'gags-en-rafale',
    category: 'plateau',
    name: 'Gags en rafale',
    description: 'Des gags absurdes d’une seconde : glissez, tapez, gonflez, ou restez de marbre. Seul ou à plusieurs.',
    icon: '🤪',
    version: '1.0.1',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 3,
    notice: {
      goal: 'Réussir le plus de gags, le plus vite possible. Seul, c’est un entraînement ; à plusieurs, une compétition.',
      steps: [
        'Chaque gag est annoncé sur l’écran principal, puis joué en même temps par tout le monde.',
        'Le téléphone est la manette : glissez-le, tapez la mouche, gonflez le ballon, faites la statue, ou ne touchez à rien.',
        'Un gag réussi rapporte 100 points, plus jusqu’à 60 points pour la rapidité.',
        'Quand tout le monde a joué, ou quand le temps est écoulé, le bilan s’affiche, puis le gag suivant.',
      ],
      tips: [
        'Le gag « Faites la statue » demande le capteur de mouvement : le micro et le mouvement demandent HTTPS sur le réseau local.',
        'Le gag « Surtout, ne touchez pas » se gagne en ne faisant rien : le plus dur, c’est de résister.',
        'Un téléphone sans capteur peut jouer tous les gags sauf « Faites la statue ».',
      ],
    },
  },

  settingsSchema: gagsSettingsSchema,
  defaultSettings: gagsSettingsSchema.parse({}),

  actions: {
    done: z.object({
      value: z.number().min(0).max(100_000),
      x: z.number().min(0).max(1).optional(),
      y: z.number().min(0).max(1).optional(),
    }),
  },

  initialize(settings, players) {
    const parsed = gagsSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      plan: [],
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
    const plan: Planned[] = sequence.map((gag) => ({ gag, seed: 1 + Math.floor(ctx.random() * 999_999) }));
    return ok(beginIntro({ ...s, plan, round: 0 }, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (type !== 'done') return fail('Action inconnue');
    if (s.phase !== 'play') return fail('Rien à faire pour le moment');
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (p.id in s.submissions) return fail('Vous avez déjà joué ce gag');
    const planned = current(s);
    if (!planned) return fail('Rien à faire pour le moment');
    const gag = GAGS[planned.gag];
    const elapsed = Math.max(0, ctx.now() - s.startedAt);
    const verdict = judge(gag, payload as Answer, elapsed, planned.seed);
    const next: GagsState = {
      ...s,
      submissions: {
        ...s.submissions,
        [p.id]: { success: verdict.success, points: verdict.points, elapsed },
      },
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
    const planned = s.phase === 'ready' || s.phase === 'final' ? null : current(s);
    return {
      phase: s.phase,
      round: s.round + 1,
      rounds: s.settings.rounds,
      microgame: planned ? describe(planned) : null,
      introEndsAt: s.introEndsAt,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      revealEndsAt: s.revealEndsAt,
      players: Object.entries(s.players).map(([id, name]) => ({ id, name })),
      // Qui a déjà répondu à ce gag (sans le résultat, qui ne s’affiche qu’au bilan).
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

  /**
   * Robots du mode test : réussissent six fois sur dix. Un robot qui réussit un gag d’attente ne fait rien ;
   * sinon il joue la réponse gagnante, ou une réponse ratée.
   */
  suggest(s, playerId, random) {
    if (s.phase !== 'play' || playerId in s.submissions) return null;
    const planned = current(s);
    if (!planned) return null;
    const gag = GAGS[planned.gag];
    if (random() < 0.6) {
      const answer = winningAnswer(gag, planned.seed);
      if (!answer) return null;
      return { type: 'done', payload: answer, key: `${s.round}:${playerId}` };
    }
    return { type: 'done', payload: losingAnswer(gag), key: `${s.round}:${playerId}` };
  },
};
