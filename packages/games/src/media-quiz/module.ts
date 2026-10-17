import { z } from 'zod';
import {
  MEDIA_KIND_ICON,
  MEDIA_KIND_LABEL,
  MEDIA_KIND_PROMPT,
  mediaQuizDefinitionSchema,
  type GameContext,
  type GameModule,
  type GameResult,
  type MediaItem,
  type MediaKind,
  type MediaQuizDefinition,
  type PlayerRef,
  type ScoreEntry,
} from '@partyhub/shared';
import { matchAnswer } from './answer.js';
import { hostMediaOf } from './host-media.js';

/**
 * Jeu de questions à partir d’extraits : on reconnaît le film ou la chanson et on tape
 * le titre sur son téléphone. Un jeu est créé à partir d’une définition (voir
 * mediaQuizDefinitionSchema) : les jeux intégrés et ceux de l’administration utilisent
 * le même moteur.
 */

export const mediaSettingsSchema = z.object({
  questionCount: z.number().int().min(1).max(30).default(8),
  answerSeconds: z.number().int().min(10).max(90).default(30),
});

export type MediaQuizSettings = z.infer<typeof mediaSettingsSchema>;

const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 50;
const REVEAL_DELAY_MS = 9000;
const ANSWER_TIMEOUT = 'answer-timeout';
const REVEAL_NEXT = 'reveal-next';

const answerSchema = z.object({ text: z.string().trim().min(1).max(80) });

export type MediaPhase = 'ready' | 'playing' | 'reveal' | 'final';

export interface MediaAnswer {
  text: string;
  elapsedMs: number;
  correct: boolean;
  gained: number;
}

export interface MediaQuizState {
  kind: MediaKind;
  name: string;
  icon: string;
  speedBonus: boolean;
  settings: MediaQuizSettings;
  /** Extraits tirés pour cette partie, dans l’ordre de jeu. */
  questions: MediaItem[];
  phase: MediaPhase;
  index: number;
  startedAt: number;
  answerEndsAt: number;
  /** id -> pseudo, figé au début de la partie. */
  players: Record<string, string>;
  points: Record<string, number>;
  answers: Record<string, MediaAnswer>;
}

function ok<S>(state: S): GameResult<S> {
  return { ok: true, state };
}

function fail<S>(error: string): GameResult<S> {
  return { ok: false, error };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool;
}

/** Classement : deux ex æquo partagent le même rang. */
export function mediaRanking(s: MediaQuizState): ScoreEntry[] {
  const entries = Object.keys(s.players).map((id) => ({
    playerId: id,
    name: s.players[id]!,
    points: s.points[id] ?? 0,
  }));
  entries.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fr'));
  return entries.map((e) => ({
    ...e,
    rank: 1 + entries.filter((o) => o.points > e.points).length,
  }));
}

function currentItem(s: MediaQuizState): MediaItem | undefined {
  return s.questions[s.index];
}

function beginQuestion(s: MediaQuizState, ctx: GameContext): MediaQuizState {
  const now = ctx.now();
  const limit = s.settings.answerSeconds * 1000;
  ctx.schedule(ANSWER_TIMEOUT, limit);
  return { ...s, phase: 'playing', startedAt: now, answerEndsAt: now + limit, answers: {} };
}

function reveal(s: MediaQuizState, ctx: GameContext): MediaQuizState {
  ctx.cancel(ANSWER_TIMEOUT);
  if (!currentItem(s)) return finish(s, ctx);
  const points = { ...s.points };
  for (const [id, answer] of Object.entries(s.answers)) {
    points[id] = (points[id] ?? 0) + answer.gained;
  }
  ctx.schedule(REVEAL_NEXT, REVEAL_DELAY_MS);
  return { ...s, phase: 'reveal', points };
}

function advance(s: MediaQuizState, ctx: GameContext): MediaQuizState {
  ctx.cancel(REVEAL_NEXT);
  if (s.index + 1 < s.questions.length) {
    return beginQuestion({ ...s, index: s.index + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: MediaQuizState, ctx: GameContext): MediaQuizState {
  ctx.cancel(ANSWER_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  return { ...s, phase: 'final' };
}

function publicView(s: MediaQuizState) {
  const q = currentItem(s);
  const base = {
    phase: s.phase,
    kind: s.kind,
    kindLabel: MEDIA_KIND_LABEL[s.kind],
    prompt: MEDIA_KIND_PROMPT[s.kind],
    name: s.name,
    icon: s.icon,
    index: s.index,
    total: s.questions.length,
    playerCount: Object.keys(s.players).length,
    ranking: mediaRanking(s),
  };
  if (!q || s.phase === 'ready' || s.phase === 'final') return { ...base, clipSec: 0 };

  if (s.phase === 'playing') {
    return {
      ...base,
      clipSec: q.durationSec,
      answerEndsAt: s.answerEndsAt,
      answerMs: s.settings.answerSeconds * 1000,
      answeredCount: Object.keys(s.answers).length,
    };
  }

  // Révélation : la réponse et les résultats deviennent publics.
  const results = Object.keys(s.players)
    .map((id) => {
      const a = s.answers[id];
      return {
        playerId: id,
        name: s.players[id]!,
        text: a?.text ?? null,
        correct: a?.correct ?? false,
        gained: a?.gained ?? 0,
      };
    })
    .sort((a, b) => b.gained - a.gained || a.name.localeCompare(b.name, 'fr'));
  return {
    ...base,
    clipSec: q.durationSec,
    answer: q.answer,
    detail: q.detail,
    results,
  };
}

/** Vue de l’écran principal : c’est la seule qui contient le média à lire. */
function hostView(s: MediaQuizState) {
  const q = currentItem(s);
  const pending =
    s.phase === 'playing'
      ? Object.keys(s.players)
          .filter((id) => !s.answers[id])
          .map((id) => s.players[id]!)
      : [];
  if (!q || s.phase === 'ready' || s.phase === 'final') return { media: null, pending };
  return { media: hostMediaOf(q, s.index), pending };
}

function noticeFor(kind: MediaKind, answerSeconds: number) {
  const goal: Record<MediaKind, string> = {
    film: 'Reconnaître le film à partir de l’extrait.',
    musique: 'Reconnaître la chanson en quelques secondes.',
    extrait: 'Deviner ce que vous voyez ou entendez.',
  };
  return {
    goal: goal[kind],
    steps: [
      'L’extrait se lance sur l’écran principal.',
      'Tapez le titre sur votre téléphone avant la fin du temps.',
      `Vous disposez de ${answerSeconds} secondes pour répondre.`,
      'Les points arrivent après la révélation : répondre vite rapporte un bonus.',
    ],
    tips: [
      'Une faute de frappe légère est pardonnée, l’article de début (« Le », « La ») est facultatif.',
      'Une mauvaise réponse ne retire aucun point, et une seule réponse est possible par extrait.',
    ],
  };
}

/**
 * Crée un jeu de questions à partir d’extraits. `options.id` est l’identifiant du jeu
 * dans le registre (préfixe « media- » pour les jeux créés dans l’administration).
 */
export function createMediaQuiz(
  definition: MediaQuizDefinition,
  options: { id: string },
): GameModule<MediaQuizState, MediaQuizSettings> {
  const def = mediaQuizDefinitionSchema.parse(definition);
  const defaultCount = Math.min(def.rules.questionCount, def.items.length);
  const settingsSchema = mediaSettingsSchema.extend({
    questionCount: z.number().int().min(1).max(30).default(defaultCount),
    answerSeconds: z.number().int().min(10).max(90).default(def.rules.answerSeconds),
  });
  const description = def.description || `${MEDIA_KIND_LABEL[def.kind]} : tapez le titre avant la fin du temps.`;

  return {
    manifest: {
      id: options.id,
      name: def.name,
      description,
      icon: def.icon || MEDIA_KIND_ICON[def.kind],
      category: 'quiz',
      version: '1.0.0',
      apiVersion: 1,
      minPlayers: 1,
      maxPlayers: 12,
      durationMin: Math.max(3, Math.ceil((defaultCount * (def.rules.answerSeconds + 9)) / 60)),
      notice: noticeFor(def.kind, def.rules.answerSeconds),
    },
    settingsSchema,
    defaultSettings: settingsSchema.parse({}),
    actions: {
      answer: answerSchema,
    },

    initialize(settings, players, ctx) {
      const parsed = settingsSchema.parse(settings);
      const count = Math.min(parsed.questionCount, def.items.length);
      return {
        kind: def.kind,
        name: def.name,
        icon: def.icon,
        speedBonus: def.rules.speedBonus,
        settings: { questionCount: count, answerSeconds: parsed.answerSeconds },
        questions: shuffled(def.items, ctx.random).slice(0, count),
        phase: 'ready',
        index: 0,
        startedAt: 0,
        answerEndsAt: 0,
        players: Object.fromEntries(players.map((p) => [p.id, p.name])),
        points: Object.fromEntries(players.map((p) => [p.id, 0])),
        answers: {},
      };
    },

    onPlayerJoin(s: MediaQuizState, p: PlayerRef) {
      if (s.phase !== 'ready') return s;
      return {
        ...s,
        players: { ...s.players, [p.id]: p.name },
        points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
      };
    },

    onPlayerLeave(s: MediaQuizState, p: PlayerRef) {
      if (s.phase !== 'ready') return s;
      const players = { ...s.players };
      const points = { ...s.points };
      delete players[p.id];
      delete points[p.id];
      return { ...s, players, points };
    },

    start(s: MediaQuizState, ctx: GameContext) {
      if (s.phase !== 'ready') return fail('La partie a déjà commencé');
      if (Object.keys(s.players).length === 0) return fail('Aucun joueur dans la salle');
      if (s.questions.length === 0) return fail('Aucun extrait disponible');
      return ok(beginQuestion(s, ctx));
    },

    handleAction(s: MediaQuizState, p: PlayerRef, type, payload, ctx: GameContext) {
      if (type !== 'answer') return fail('Action inconnue');
      if (s.phase !== 'playing') return fail('Aucun extrait en cours');
      if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
      if (s.answers[p.id]) return fail('Réponse déjà envoyée');
      const q = currentItem(s);
      if (!q) return fail('Aucun extrait en cours');
      const parsed = answerSchema.safeParse(payload);
      if (!parsed.success) return fail('Réponse invalide');

      // Le temps et le jugement se font sur le serveur, jamais sur le navigateur.
      const elapsedMs = Math.max(0, ctx.now() - s.startedAt);
      const limit = s.settings.answerSeconds * 1000;
      const correct = matchAnswer(parsed.data.text, q);
      const bonus = correct && s.speedBonus ? Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - elapsedMs / limit)) : 0;
      const answer: MediaAnswer = {
        text: parsed.data.text,
        elapsedMs,
        correct,
        gained: correct ? BASE_POINTS + bonus : 0,
      };
      const next: MediaQuizState = { ...s, answers: { ...s.answers, [p.id]: answer } };
      const connected = ctx.connectedPlayerIds();
      const everyoneAnswered = connected.length > 0 && connected.every((id) => id in next.answers);
      return ok(everyoneAnswered ? reveal(next, ctx) : next);
    },

    onTimer(s: MediaQuizState, key: string, ctx: GameContext) {
      if (key === ANSWER_TIMEOUT && s.phase === 'playing') return reveal(s, ctx);
      if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
      return s;
    },

    nextRound(s: MediaQuizState, ctx: GameContext) {
      if (s.phase === 'playing') return reveal(s, ctx);
      if (s.phase === 'reveal') return advance(s, ctx);
      return s;
    },

    calculateScores(s: MediaQuizState) {
      return mediaRanking(s);
    },

    end(s: MediaQuizState, ctx: GameContext) {
      return finish(s, ctx);
    },

    getPublicState(s: MediaQuizState) {
      return publicView(s);
    },

    getPlayerState(s: MediaQuizState, playerId: string) {
      const a = s.answers[playerId];
      const rank = mediaRanking(s).find((e) => e.playerId === playerId)?.rank ?? null;
      const revealed = s.phase === 'reveal';
      return {
        points: s.points[playerId] ?? 0,
        rank,
        answered: a !== undefined,
        myText: a ? a.text : null,
        correct: revealed && a ? a.correct : null,
        gained: revealed && a ? a.gained : null,
      };
    },

    getHostState(s: MediaQuizState) {
      return hostView(s);
    },

    isFinished(s: MediaQuizState) {
      return s.phase === 'final';
    },

    suggest(s: MediaQuizState, playerId: string, random: () => number) {
      if (s.phase !== 'playing' || s.answers[playerId]) return null;
      const q = currentItem(s);
      if (!q) return null;
      // Le robot connaît la réponse une fois sur deux, sinon il tape au hasard.
      const text = random() < 0.5 ? q.answer : 'Je ne sais pas';
      return { type: 'answer', payload: { text }, key: `q${s.index}` };
    },
  };
}
