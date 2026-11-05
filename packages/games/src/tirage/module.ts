import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { addPoints, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import banque from './banque-estimer.fr.json' with { type: 'json' };

/**
 * Tirage surprise, mode Estimer : chacun devine un chiffre réel (population, altitude). Le score dépend de l'écart
 * relatif à la bonne valeur, dans une tolérance qui dépend du niveau. Ce fichier contient les règles ; il est pur.
 */

export const tirageSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(5),
  guessSeconds: z.number().int().min(20).max(180).default(60),
  difficulty: z.number().int().min(1).max(3).default(2),
});

export type TirageSettings = z.infer<typeof tirageSettingsSchema>;

const entreeSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(5),
  valeur: z.number().int().min(0),
  unite: z.string().min(1),
  theme: z.string().min(1),
  source: z.string().min(1),
});

export type Entree = z.infer<typeof entreeSchema>;

/** Banque chargée et validée au démarrage ; une entrée mal formée fait échouer le chargement, pas une partie. */
export const BANQUE: Entree[] = z.object({ entrees: z.array(entreeSchema).min(1) }).parse(banque).entrees;

/** Points au maximum, et tolérance (écart relatif accepté pour un point) selon le niveau. */
export const MAX_POINTS = 5000;
export const TOLERANCE_BY_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.5, 3: 0.2 };

const ESTIMATE_TIMEOUT = 'estimate-timeout';
const REVEAL_NEXT = 'reveal-next';
const REVEAL_DELAY_MS = 12_000;

export const estimateSchema = z.object({ valeur: z.number().int().min(0).max(1e13) });

/** Points d'une estimation : le maximum pile sur la valeur, nul au-delà de la tolérance. */
export function pointsEstimation(guess: number, reel: number, tolerance: number): number {
  if (reel === 0) return guess === 0 ? MAX_POINTS : 0;
  const ecart = Math.abs(guess - reel) / reel;
  return Math.max(0, Math.round(MAX_POINTS * (1 - ecart / tolerance)));
}

export interface Manche {
  entreeId: string;
  guesses: Record<string, number>;
  gains: Record<string, number>;
}

export interface TirageState {
  settings: TirageSettings;
  phase: 'ready' | 'guess' | 'reveal' | 'final';
  names: Record<string, string>;
  /** Entrées tirées pour la partie, sans répétition. */
  entrees: Entree[];
  index: number;
  guesses: Record<string, number>;
  guessEndsAt: number;
  points: Record<string, number>;
  manches: Manche[];
}

function beginRound(s: TirageState, ctx: GameContext): TirageState {
  const limit = s.settings.guessSeconds * 1000;
  ctx.schedule(ESTIMATE_TIMEOUT, limit);
  return { ...s, phase: 'guess', guesses: {}, guessEndsAt: ctx.now() + limit };
}

function reveal(s: TirageState, ctx: GameContext): TirageState {
  ctx.cancel(ESTIMATE_TIMEOUT);
  const entree = s.entrees[s.index];
  if (!entree) return finish(s, ctx);
  const tolerance = TOLERANCE_BY_DIFFICULTY[s.settings.difficulty as 1 | 2 | 3];
  let points = { ...s.points };
  const gains: Record<string, number> = {};
  for (const id of Object.keys(s.names)) {
    const guess = s.guesses[id];
    const gained = guess === undefined ? 0 : pointsEstimation(guess, entree.valeur, tolerance);
    gains[id] = gained;
    points = addPoints(points, id, gained);
  }
  ctx.schedule(REVEAL_NEXT, REVEAL_DELAY_MS);
  return { ...s, phase: 'reveal', points, manches: [...s.manches, { entreeId: entree.id, guesses: s.guesses, gains }] };
}

function advance(s: TirageState, ctx: GameContext): TirageState {
  ctx.cancel(REVEAL_NEXT);
  if (s.index + 1 < s.entrees.length) return beginRound({ ...s, index: s.index + 1 }, ctx);
  return finish(s, ctx);
}

function finish(s: TirageState, ctx: GameContext): TirageState {
  ctx.cancel(ESTIMATE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  return { ...s, phase: 'final' };
}

export const tirageEstimer: GameModule<TirageState, TirageSettings> = {
  manifest: {
    id: 'tirage-surprise',
    category: 'quiz',
    name: 'Tirage surprise',
    description: 'Des chiffres réels tirés au sort : devinez-les le plus près possible.',
    icon: '🎲',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 8,
    notice: {
      goal: 'Deviner au plus près des chiffres réels tirés au sort.',
      steps: [
        'Lisez la question sur l’écran principal.',
        'Tapez votre estimation sur votre téléphone, avant la fin du temps.',
        'À la révélation, chacun gagne des points selon l’écart avec la bonne valeur.',
      ],
      tips: [
        'Plus le niveau est difficile, plus la tolérance est étroite.',
        'Les chiffres viennent de Wikidata (CC0).',
      ],
    },
  },

  settingsSchema: tirageSettingsSchema,
  defaultSettings: tirageSettingsSchema.parse({}),

  actions: { estimate: estimateSchema },

  initialize(settings, players, ctx) {
    const parsed = tirageSettingsSchema.parse(settings);
    const entrees = shuffle(BANQUE, ctx.random).slice(0, Math.min(parsed.rounds, BANQUE.length));
    return {
      settings: parsed,
      phase: 'ready',
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      entrees,
      index: 0,
      guesses: {},
      guessEndsAt: 0,
      points: {},
      manches: [],
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    return { ...s, names: { ...s.names, [p.id]: p.name } };
  },

  onPlayerLeave(s, p: PlayerRef, ctx) {
    const names = { ...s.names };
    delete names[p.id];
    const next = { ...s, names };
    if (next.phase === 'guess' && everyConnectedDone(ctx, Object.keys(next.names), (id) => id in next.guesses)) {
      return reveal(next, ctx);
    }
    return next;
  },

  start(s, ctx): GameResult<TirageState> {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (s.entrees.length === 0) return fail('Aucune question disponible');
    return ok(beginRound(s, ctx));
  },

  handleAction(s, p, type, payload, ctx): GameResult<TirageState> {
    if (type !== 'estimate') return fail('Action inconnue');
    if (s.phase !== 'guess') return fail('Pas de question en cours');
    if (!(p.id in s.names)) return fail('Joueur inconnu');
    const { valeur } = payload as { valeur: number };
    const next: TirageState = { ...s, guesses: { ...s.guesses, [p.id]: valeur } };
    return ok(everyConnectedDone(ctx, Object.keys(next.names), (id) => id in next.guesses) ? reveal(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === ESTIMATE_TIMEOUT && s.phase === 'guess') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'guess') return reveal(s, ctx);
    if (s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  calculateScores(s): ScoreEntry[] {
    return rankEntries(s.names, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  // Vue publique : la question pendant la devinette, la bonne valeur et les estimations seulement à la révélation.
  getPublicState(s) {
    const entree = s.entrees[s.index];
    const visible = entree && (s.phase === 'guess' || s.phase === 'reveal');
    const revealed = s.phase === 'reveal';
    const last = s.manches[s.manches.length - 1];
    return {
      phase: s.phase,
      round: s.index + 1,
      total: s.entrees.length,
      endsAt: s.phase === 'guess' ? s.guessEndsAt : undefined,
      guessSeconds: s.settings.guessSeconds,
      question: visible ? entree.question : null,
      unit: visible ? entree.unite : null,
      answered: Object.keys(s.guesses).length,
      playerCount: Object.keys(s.names).length,
      answer: revealed && entree ? { valeur: entree.valeur, source: entree.source, theme: entree.theme } : null,
      placements:
        revealed && last
          ? Object.keys(s.names).map((id) => ({
              playerId: id,
              name: s.names[id] ?? '?',
              guess: last.guesses[id] ?? null,
              gained: last.gains[id] ?? 0,
            }))
          : [],
      ranking: rankEntries(s.names, s.points),
    };
  },

  // Vue privée : sa propre estimation, jamais celles des autres avant la révélation.
  getPlayerState(s, playerId) {
    const rank = rankEntries(s.names, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      myGuess: s.guesses[playerId] ?? null,
      guessed: playerId in s.guesses,
      points: s.points[playerId] ?? 0,
      rank,
    };
  },

  getHostState(s) {
    return {
      pending:
        s.phase === 'guess'
          ? Object.keys(s.names)
              .filter((id) => !(id in s.guesses))
              .map((id) => s.names[id])
          : [],
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  // Mode test : un robot estime au hasard, entre la moitié et le double de la bonne valeur.
  suggest(s, playerId, random) {
    const entree = s.entrees[s.index];
    if (s.phase !== 'guess' || !entree || playerId in s.guesses) return null;
    return {
      type: 'estimate',
      payload: { valeur: Math.round(entree.valeur * (0.5 + random() * 1.5)) },
      key: `estimate-${s.index}-${playerId}`,
      delayMs: 3000 + random() * 5000,
    };
  },
};
