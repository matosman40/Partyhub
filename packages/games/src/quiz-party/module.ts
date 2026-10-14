import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { QUESTIONS, type QuizQuestion } from './questions.js';

export const quizSettingsSchema = z.object({
  questionCount: z.number().int().min(1).max(20).default(5),
  answerSeconds: z.number().int().min(5).max(60).default(20),
  speedBonus: z.boolean().default(true),
});

export type QuizSettings = z.infer<typeof quizSettingsSchema>;

const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 50;
const REVEAL_DELAY_MS = 7000;

const ANSWER_TIMEOUT = 'answer-timeout';
const REVEAL_NEXT = 'reveal-next';

const answerSchema = z.object({ choice: z.number().int().min(0).max(3) });

export type QuizPhase = 'ready' | 'question' | 'reveal' | 'final';

export interface QuizGain {
  correct: boolean;
  gained: number;
  choice: number | null;
}

export interface QuizState {
  phase: QuizPhase;
  settings: QuizSettings;
  questions: QuizQuestion[];
  index: number;
  startedAt: number;
  answerEndsAt: number;
  /** id -> pseudo, figé au début de la partie (plus les arrivées en salle d'attente). */
  players: Record<string, string>;
  points: Record<string, number>;
  answers: Record<string, { choice: number; elapsedMs: number }>;
  gains: Record<string, QuizGain>;
}

function ok<S>(state: S): GameResult<S> {
  return { ok: true, state };
}

function fail<S>(error: string): GameResult<S> {
  return { ok: false, error };
}

function pickQuestions(count: number, random: () => number): QuizQuestion[] {
  const pool = [...QUESTIONS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function currentQuestion(s: QuizState): QuizQuestion | undefined {
  return s.questions[s.index];
}

/** Classement en compétition : deux ex æquo partagent le même rang. */
export function rankPlayers(s: QuizState): ScoreEntry[] {
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

function beginQuestion(s: QuizState, ctx: GameContext): QuizState {
  const now = ctx.now();
  const limit = s.settings.answerSeconds * 1000;
  ctx.schedule(ANSWER_TIMEOUT, limit);
  return {
    ...s,
    phase: 'question',
    startedAt: now,
    answerEndsAt: now + limit,
    answers: {},
    gains: {},
  };
}

function reveal(s: QuizState, ctx: GameContext): QuizState {
  ctx.cancel(ANSWER_TIMEOUT);
  const q = currentQuestion(s);
  if (!q) return finish(s, ctx);

  const limit = s.settings.answerSeconds * 1000;
  const points = { ...s.points };
  const gains: Record<string, QuizGain> = {};

  for (const id of Object.keys(s.players)) {
    const a = s.answers[id];
    const correct = a !== undefined && a.choice === q.answer;
    const elapsed = a?.elapsedMs ?? limit;
    const bonus = correct && s.settings.speedBonus ? Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - elapsed / limit)) : 0;
    const gained = correct ? BASE_POINTS + bonus : 0;
    points[id] = (points[id] ?? 0) + gained;
    gains[id] = { correct, gained, choice: a ? a.choice : null };
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_DELAY_MS);
  return { ...s, phase: 'reveal', points, gains };
}

function advance(s: QuizState, ctx: GameContext): QuizState {
  ctx.cancel(REVEAL_NEXT);
  if (s.index + 1 < s.questions.length) {
    return beginQuestion({ ...s, index: s.index + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: QuizState, ctx: GameContext): QuizState {
  ctx.cancel(ANSWER_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  return { ...s, phase: 'final' };
}

function publicView(s: QuizState) {
  const base = {
    phase: s.phase,
    index: s.index,
    total: s.questions.length,
    playerCount: Object.keys(s.players).length,
    ranking: rankPlayers(s),
  };

  if (s.phase === 'ready' || s.phase === 'final') {
    return { ...base, question: null };
  }

  const q = currentQuestion(s);
  if (!q) return { ...base, question: null };

  const question = { category: q.category, text: q.question, choices: q.choices };

  if (s.phase === 'question') {
    return {
      ...base,
      question,
      answerEndsAt: s.answerEndsAt,
      answerMs: s.settings.answerSeconds * 1000,
      answeredCount: Object.keys(s.answers).length,
    };
  }

  // Phase « reveal » : la bonne réponse et les résultats deviennent publics.
  const counts = q.choices.map((_, i) => Object.values(s.answers).filter((a) => a.choice === i).length);
  const results = Object.keys(s.players)
    .map((id) => ({
      playerId: id,
      name: s.players[id]!,
      correct: s.gains[id]?.correct ?? false,
      gained: s.gains[id]?.gained ?? 0,
    }))
    .sort((a, b) => b.gained - a.gained || a.name.localeCompare(b.name, 'fr'));

  return {
    ...base,
    question,
    answer: q.answer,
    explanation: q.explanation ?? null,
    counts,
    results,
  };
}

export const quizParty: GameModule<QuizState, QuizSettings> = {
  manifest: {
    id: 'quiz-party',
    name: 'Quiz Party',
    description: 'Questions à choix multiples, points et bonus de rapidité.',
    icon: '🧠',
    category: 'quiz',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 10,
    notice: {
      goal: 'Répondre le plus vite et le plus juste aux questions pour marquer le plus de points.',
      steps: [
        "L'hôte lance la partie depuis l'écran principal.",
        "Chaque question s'affiche sur l'écran et sur votre téléphone.",
        'Touchez la bonne réponse avant la fin du temps.',
        'Les points arrivent après la révélation : répondre vite rapporte un bonus.',
      ],
      tips: [
        'Une mauvaise réponse ne retire aucun point.',
        'Le nombre de questions et le temps se règlent dans le salon, avant le lancement.',
      ],
    },
  },

  settingsSchema: quizSettingsSchema,
  defaultSettings: quizSettingsSchema.parse({}),

  actions: {
    answer: answerSchema,
  },

  initialize(settings, players, ctx) {
    const parsed = quizSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      questions: pickQuestions(parsed.questionCount, ctx.random),
      index: 0,
      startedAt: 0,
      answerEndsAt: 0,
      players: Object.fromEntries(players.map((p) => [p.id, p.name])),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      answers: {},
      gains: {},
    };
  },

  onPlayerJoin(s: QuizState, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return {
      ...s,
      players: { ...s.players, [p.id]: p.name },
      points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
    };
  },

  onPlayerLeave(s: QuizState, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    const players = { ...s.players };
    const points = { ...s.points };
    delete players[p.id];
    delete points[p.id];
    return { ...s, players, points };
  },

  start(s: QuizState, ctx: GameContext) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (Object.keys(s.players).length === 0) return fail('Aucun joueur dans la salle');
    if (s.questions.length === 0) return fail('Aucune question disponible');
    return ok(beginQuestion(s, ctx));
  },

  handleAction(s: QuizState, p: PlayerRef, type, payload, ctx: GameContext) {
    if (type !== 'answer') return fail('Action inconnue');
    if (s.phase !== 'question') return fail('Aucune question en cours');
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (s.answers[p.id]) return fail('Réponse déjà envoyée');

    const q = currentQuestion(s);
    if (!q) return fail('Aucune question en cours');

    const parsed = answerSchema.safeParse(payload);
    if (!parsed.success) return fail('Réponse invalide');
    const { choice } = parsed.data;
    if (choice >= q.choices.length) return fail('Choix invalide');

    // Le temps est mesuré par le serveur à la réception, jamais par le navigateur.
    const elapsedMs = Math.max(0, ctx.now() - s.startedAt);
    const next: QuizState = { ...s, answers: { ...s.answers, [p.id]: { choice, elapsedMs } } };

    const connected = ctx.connectedPlayerIds();
    const everyoneAnswered = connected.length > 0 && connected.every((id) => id in next.answers);

    return ok(everyoneAnswered ? reveal(next, ctx) : next);
  },

  onTimer(s: QuizState, key: string, ctx: GameContext) {
    if (key === ANSWER_TIMEOUT && s.phase === 'question') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s: QuizState, ctx: GameContext) {
    if (s.phase === 'question') return reveal(s, ctx);
    if (s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  calculateScores(s: QuizState) {
    return rankPlayers(s);
  },

  end(s: QuizState, ctx: GameContext) {
    return finish(s, ctx);
  },

  getPublicState(s: QuizState) {
    return publicView(s);
  },

  getPlayerState(s: QuizState, playerId: string) {
    const a = s.answers[playerId];
    const g = s.gains[playerId];
    const rank = rankPlayers(s).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      answered: a !== undefined,
      myChoice: a ? a.choice : null,
      correct: g ? g.correct : null,
      gained: g ? g.gained : null,
    };
  },

  getHostState(s: QuizState) {
    const q = currentQuestion(s);
    return {
      pending:
        s.phase === 'question'
          ? Object.keys(s.players)
              .filter((id) => !s.answers[id])
              .map((id) => s.players[id])
          : [],
      explanation: s.phase === 'reveal' ? (q?.explanation ?? null) : null,
    };
  },

  isFinished(s: QuizState) {
    return s.phase === 'final';
  },
  suggest(s, playerId, random) {
    if (s.phase !== 'question' || s.answers[playerId]) return null;
    const q = s.questions[s.index];
    if (!q) return null;
    return { type: 'answer', payload: { choice: Math.floor(random() * q.choices.length) }, key: `q${s.index}` };
  },
};
