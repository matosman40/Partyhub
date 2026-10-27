import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, everyConnectedDone, fail, ok, rankEntries } from '../common/engine.js';
import { GRACE_MS, WALK_MS, judgeWalk, windLabel, windStrength, type WalkJudgement } from './rules.js';

/**
 * Funambule : chaque joueur tient son funambule sur le fil en penchant son téléphone. Tout le monde marche en
 * même temps, sous le même vent ; l’écran principal montre tous les funambules en direct.
 *
 * Déroulement d’une manche : présentation (2,5 s), traversée (12 s), bilan (4 s). Un funambule qui tombe
 * envoie son temps tenu ; celui qui traverse envoie la durée complète. Le serveur borne le temps reçu par ce
 * qui s’est écoulé (voir `judgeWalk`) : il ne croit jamais un temps plus long que la réalité.
 */

export const funambuleSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(6).default(3),
});

export type FunambuleSettings = z.infer<typeof funambuleSettingsSchema>;

const INTRO_MS = 2500;
const REVEAL_MS = 4000;

const INTRO_END = 'intro-end';
const WALK_END = 'walk-end';
const REVEAL_END = 'reveal-end';

export type FunambulePhase = 'ready' | 'intro' | 'walk' | 'reveal' | 'final';

export interface Crossing extends WalkJudgement {
  /** Temps écoulé côté serveur à la réception, en millisecondes. */
  elapsed: number;
}

export interface FunambuleState {
  phase: FunambulePhase;
  settings: FunambuleSettings;
  players: Record<string, string>;
  points: Record<string, number>;
  /** Une graine de vent par manche, tirée au lancement. */
  seeds: number[];
  /** Index de la manche en cours (à partir de 0). */
  round: number;
  /** Début de la traversée, horloge serveur (ms epoch). 0 hors traversée. */
  startedAt: number;
  introEndsAt: number;
  endsAt: number;
  revealEndsAt: number;
  submissions: Record<string, Crossing>;
  /** Résultats du bilan en cours, ou null. */
  results: Record<string, { survived: number; success: boolean; points: number }> | null;
}

/** Description publique du vent d’une manche : tout ce qu’il faut pour l’afficher et le reproduire. */
function windOf(s: FunambuleState) {
  const seed = s.seeds[s.round];
  if (seed === undefined) return null;
  return {
    seed,
    strength: windStrength(s.round),
    label: windLabel(windStrength(s.round)),
    walkMs: WALK_MS,
  };
}

function cancelAll(ctx: GameContext): void {
  for (const key of [INTRO_END, WALK_END, REVEAL_END]) ctx.cancel(key);
}

function beginIntro(s: FunambuleState, ctx: GameContext): FunambuleState {
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

function beginWalk(s: FunambuleState, ctx: GameContext): FunambuleState {
  ctx.cancel(INTRO_END);
  ctx.schedule(WALK_END, WALK_MS + GRACE_MS);
  const now = ctx.now();
  return { ...s, phase: 'walk', startedAt: now, endsAt: now + WALK_MS + GRACE_MS, introEndsAt: 0 };
}

/** Clôt la traversée : les funambules sans réponse tombent à l’instant zéro, puis le bilan s’affiche. */
function finishWalk(s: FunambuleState, ctx: GameContext): FunambuleState {
  ctx.cancel(WALK_END);
  ctx.schedule(REVEAL_END, REVEAL_MS);
  const results: Record<string, { survived: number; success: boolean; points: number }> = {};
  let points = s.points;
  for (const id of Object.keys(s.players)) {
    const sub = s.submissions[id];
    results[id] = { survived: sub?.survived ?? 0, success: sub?.success ?? false, points: sub?.points ?? 0 };
    if (sub?.points) points = addPoints(points, id, sub.points);
  }
  return { ...s, phase: 'reveal', points, results, endsAt: 0, revealEndsAt: ctx.now() + REVEAL_MS };
}

/** Passe à la manche suivante, ou termine la partie après la dernière. */
function advance(s: FunambuleState, ctx: GameContext): FunambuleState {
  ctx.cancel(REVEAL_END);
  if (s.round + 1 < s.settings.rounds) return beginIntro({ ...s, round: s.round + 1 }, ctx);
  return finish(s, ctx);
}

function finish(s: FunambuleState, ctx: GameContext): FunambuleState {
  cancelAll(ctx);
  return { ...s, phase: 'final', results: null };
}

function resultsOf(
  s: FunambuleState,
): { playerId: string; name: string; success: boolean; survived: number; points: number }[] {
  if (!s.results) return [];
  return Object.keys(s.players).map((id) => ({
    playerId: id,
    name: s.players[id] ?? '?',
    success: s.results?.[id]?.success ?? false,
    survived: s.results?.[id]?.survived ?? 0,
    points: s.results?.[id]?.points ?? 0,
  }));
}

/** Joueurs qui n’ont pas encore envoyé leur réponse à ce tour. */
function pendingOf(s: FunambuleState): string[] {
  return Object.keys(s.players)
    .filter((id) => !(id in s.submissions))
    .map((id) => s.players[id] ?? '?');
}

export const funambule: GameModule<FunambuleState, FunambuleSettings> = {
  manifest: {
    id: 'funambule',
    category: 'plateau',
    name: 'Funambule',
    description: 'Tenez votre funambule sur le fil : penchez le téléphone pour contrer le vent.',
    icon: '🤸',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 5,
    notice: {
      goal: 'Traverser le fil le plus longtemps possible, sous un vent qui se renforce.',
      steps: [
        'Chaque manche, tous les funambules s’élancent en même temps sur l’écran principal.',
        'Le vent pousse les personnages. Penchez le téléphone du côté opposé pour rester droit.',
        'Quand le personnage penche trop longtemps, il tombe. Celui qui tient douze secondes traverse et gagne une prime.',
        'Le bilan s’affiche après chaque manche, puis la manche suivante commence.',
      ],
      tips: [
        'Le mouvement demande HTTPS sur le réseau local (voir la page « Test des appareils »).',
        'Tenez le téléphone comme au départ : la pose de départ sert de référence. « Recentrer » la reprend.',
        'Un téléphone sans capteur ne peut pas jouer : le personnage reste alors sur le fil sans être compté.',
      ],
    },
  },

  settingsSchema: funambuleSettingsSchema,
  defaultSettings: funambuleSettingsSchema.parse({}),

  actions: {
    done: z.object({ value: z.number().min(0).max(100_000) }),
  },

  initialize(settings, players) {
    const parsed = funambuleSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      seeds: [],
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
    const seeds = Array.from({ length: s.settings.rounds }, () => Math.floor(ctx.random() * 1_000_000) / 1_000_000);
    return ok(beginIntro({ ...s, seeds, round: 0 }, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (type !== 'done') return fail('Action inconnue');
    if (s.phase !== 'walk') return fail('Rien à jouer pour le moment');
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (p.id in s.submissions) return fail('Vous avez déjà joué cette manche');
    const { value } = payload as { value: number };
    const elapsed = Math.max(0, ctx.now() - s.startedAt);
    const verdict = judgeWalk(value, elapsed);
    const next: FunambuleState = {
      ...s,
      submissions: { ...s.submissions, [p.id]: { ...verdict, elapsed } },
    };
    const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.submissions);
    return ok(done ? finishWalk(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === INTRO_END && s.phase === 'intro') return beginWalk(s, ctx);
    if (key === WALK_END && s.phase === 'walk') return finishWalk(s, ctx);
    if (key === REVEAL_END && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'intro') return beginWalk(s, ctx);
    if (s.phase === 'walk') return finishWalk(s, ctx);
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
    const active = s.phase === 'intro' || s.phase === 'walk' || s.phase === 'reveal';
    const wind = active ? windOf(s) : null;
    const ids = Object.keys(s.submissions);
    return {
      phase: s.phase,
      round: s.round + 1,
      rounds: s.settings.rounds,
      wind,
      introEndsAt: s.introEndsAt,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      revealEndsAt: s.revealEndsAt,
      players: Object.entries(s.players).map(([id, name]) => ({ id, name })),
      pending: pendingOf(s),
      // Qui a fini la traversée : tombé ou arrivé. Le temps tenu ne s’affiche qu’au bilan.
      submitted: ids,
      fallen: ids.filter((id) => !s.submissions[id]?.success),
      crossed: ids.filter((id) => s.submissions[id]?.success),
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
    return { pending: pendingOf(s) };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  /** Robots du mode test : traversent six fois sur dix, sinon tombent à un instant au hasard. */
  suggest(s, playerId, random) {
    if (s.phase !== 'walk' || playerId in s.submissions) return null;
    const value = random() < 0.6 ? WALK_MS : Math.round(1000 + random() * (WALK_MS - 2000));
    return { type: 'done', payload: { value }, key: `${s.round}:${playerId}` };
  },
};
