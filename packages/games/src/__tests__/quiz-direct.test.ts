import { describe, expect, it } from 'vitest';
import { quizParty, QUIZ_DIRECT_JOB, type QuizState } from '../quiz-party/module.js';
import { qcm } from '../quiz-party/en-direct.js';
import type { QuizQuestion } from '../quiz-party/questions.js';
import { A, B, mulberry32, must } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

const neuve = (i: number): QuizQuestion => ({
  id: `direct-cap-Q${i}`,
  category: 'Géographie',
  question: `Quelle est la capitale du pays « Pays ${i} » ?`,
  choices: ['A', 'B', 'C', 'D'],
  answer: 0,
  image: {
    src: '/api/images-ouvertes?u=https%3A%2F%2Fupload.wikimedia.org%2Fx.jpg',
    alt: 'Lieu à situer',
    credit: 'Auteur',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:X.jpg',
  },
});

function lancer(questionCount = 6): { h: ReturnType<typeof harness>; s: QuizState } {
  const h = harness({ connected: [A.id, B.id] });
  const s = quizParty.initialize({ questionCount }, [A, B], h.ctx);
  return { h, s: must(quizParty.start(s, h.ctx)) };
}

describe('Quiz Party : questions tirées en direct', () => {
  it('qcm : la réponse et trois leurres distincts, ou rien si le choix est trop court', () => {
    const q = qcm(
      { id: 'x', category: 'Géographie', question: 'Capitale ?' },
      'Paris',
      ['Paris', 'Rome', 'Rome', 'Oslo', 'Lima'],
      mulberry32(1),
    );
    expect(q?.choices).toHaveLength(4);
    expect(new Set(q?.choices).size).toBe(4);
    expect(q?.choices[q.answer]).toBe('Paris');
    expect(
      qcm({ id: 'y', category: 'G', question: 'Capitale ?' }, 'Paris', ['Rome', 'Oslo'], mulberry32(2)),
    ).toBeNull();
  });

  it('passe par la préparation et demande le tirage', () => {
    const { s } = lancer();
    expect(s.phase).toBe('preparation');
    expect(quizParty.pendingJob?.(s)).toEqual({ id: QUIZ_DIRECT_JOB, kind: QUIZ_DIRECT_JOB, input: { count: 6 } });
  });

  it('mêle les questions neuves (deux tiers au plus) aux questions intégrées', () => {
    const { h, s } = lancer(6);
    const valeur = [1, 2, 3, 4, 5, 6].map(neuve);
    const next = quizParty.completeJob!(s, QUIZ_DIRECT_JOB, { ok: true, value: valeur }, h.ctx);
    expect(next.phase).toBe('question');
    expect(next.questions).toHaveLength(6);
    expect(next.questions.filter((q) => q.id.startsWith('direct-'))).toHaveLength(4);
    expect(next.notice).toBeNull();
  });

  it('garde les questions intégrées sans réseau, et ignore une question mal formée', () => {
    const { h, s } = lancer(5);
    const echec = quizParty.completeJob!(s, QUIZ_DIRECT_JOB, { ok: false, error: 'délai' }, h.ctx);
    expect(echec.phase).toBe('question');
    expect(echec.questions.map((q) => q.id).sort()).toEqual(s.questions.map((q) => q.id).sort());
    expect(echec.notice).toContain('Internet');
    const invalide = quizParty.completeJob!(s, QUIZ_DIRECT_JOB, { ok: true, value: [{ id: 'cassé' }] }, h.ctx);
    expect(invalide.questions.every((q) => !q.id.startsWith('direct-'))).toBe(true);
  });

  it('sans tirage en direct, la partie commence tout de suite', () => {
    const h = harness({ connected: [A.id] });
    const s = quizParty.initialize({ enDirect: false }, [A], h.ctx);
    expect(must(quizParty.start(s, h.ctx)).phase).toBe('question');
  });
});
