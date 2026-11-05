import { describe, expect, it } from 'vitest';
import { QUESTIONS } from '../quiz-party/questions.js';

describe('banque de questions du quiz', () => {
  const openData = QUESTIONS.filter((q) => q.id.startsWith('od-'));

  it('charge les questions écrites et celles tirées des données ouvertes', () => {
    expect(QUESTIONS.length).toBeGreaterThan(openData.length);
    expect(openData.length).toBeGreaterThanOrEqual(40);
  });

  it('donne quatre choix distincts sans révéler la réponse dans la question', () => {
    for (const q of openData) {
      expect(new Set(q.choices).size, q.id).toBe(4);
      expect(q.question, q.id).not.toContain(q.choices[q.answer]!);
    }
  });
});
