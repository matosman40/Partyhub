import type { CharacterMood } from '@partyhub/shared';

/** Ce que l'écran de quiz connaît de la partie : phase, classement et résultats publics. */
export interface QuizMoodInput {
  phase: 'ready' | 'question' | 'reveal' | 'final';
  ranking: { name: string; rank: number }[];
  results?: { name: string; correct: boolean }[];
}

/**
 * Humeur de chaque personnage pendant le quiz :
 * - question : qui a répondu salue (il a appuyé sur un bouton), les autres restent au repos ;
 * - réponse : bonne réponse → joie, mauvaise ou aucune → tristesse ;
 * - classement final : le ou les premiers dansent.
 */
export function quizMoods(pub: QuizMoodInput, pending: string[]): Record<string, CharacterMood> {
  const moods: Record<string, CharacterMood> = {};
  if (pub.phase === 'question') {
    const waiting = new Set(pending);
    for (const entry of pub.ranking) moods[entry.name] = waiting.has(entry.name) ? 'idle' : 'wave';
  } else if (pub.phase === 'reveal') {
    for (const r of pub.results ?? []) moods[r.name] = r.correct ? 'joy' : 'sad';
  } else if (pub.phase === 'final') {
    for (const entry of pub.ranking) moods[entry.name] = entry.rank === 1 ? 'dance' : 'idle';
  }
  return moods;
}
