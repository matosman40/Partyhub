import { describe, expect, it } from 'vitest';
import { adaptChoices, quizParty } from '../quiz-party/module.js';
import { photoMystere, pointsFor, SCALE_BY_DIFFICULTY } from '../photo-mystere/module.js';
import { A, B, PLAYERS, mulberry32, must } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

const QUESTION = {
  id: 'd-1',
  category: 'Test',
  question: 'Quelle est la bonne réponse ?',
  choices: ['Un', 'Deux', 'Trois', 'Quatre'],
  answer: 2,
};

describe('difficulté du quiz : nombre de choix', () => {
  it('garde la bonne réponse et le nombre de choix demandé', () => {
    for (let graine = 1; graine <= 20; graine++) {
      const r = adaptChoices(QUESTION, 2, mulberry32(graine));
      expect(r.choices).toHaveLength(2);
      expect(r.choices[r.answer]).toBe('Trois');
    }
  });

  it('ne touche pas à une question déjà assez courte', () => {
    expect(adaptChoices(QUESTION, 4, mulberry32(1))).toBe(QUESTION);
  });

  it('au niveau facile, une partie n’affiche que deux choix', () => {
    const h = harness({ connected: [A.id, B.id] });
    let s = quizParty.initialize(
      {
        enDirect: false,
        source: 'curated',
        questionCount: 2,
        answerSeconds: 20,
        topicSeconds: 30,
        speedBonus: false,
        difficulty: 1,
      },
      PLAYERS.slice(0, 2),
      h.ctx,
    );
    s = must(quizParty.start(s, h.ctx));
    const pub = quizParty.getPublicState(s) as { question: { choices: string[] } };
    expect(pub.question.choices).toHaveLength(2);
  });

  it('le niveau par défaut garde les quatre choix', () => {
    const h = harness({ connected: [A.id, B.id] });
    let s = quizParty.initialize(
      { enDirect: false, source: 'curated', questionCount: 1, answerSeconds: 20, topicSeconds: 30, speedBonus: false },
      PLAYERS.slice(0, 2),
      h.ctx,
    );
    s = must(quizParty.start(s, h.ctx));
    const pub = quizParty.getPublicState(s) as { question: { choices: string[] } };
    expect(pub.question.choices.length).toBeGreaterThanOrEqual(3);
  });
});

describe('difficulté de Photo mystère : échelle et indice', () => {
  it('à même distance, le niveau difficile rapporte moins que le facile', () => {
    expect(pointsFor(1000, SCALE_BY_DIFFICULTY[3])).toBeLessThan(pointsFor(1000, SCALE_BY_DIFFICULTY[1]));
  });

  it('le niveau facile affiche le pays pendant la devinette, les autres niveaux non', () => {
    const h = harness({ connected: [A.id, B.id] });
    for (const [niveau, attendu] of [
      [1, true],
      [3, false],
    ] as const) {
      let s = photoMystere.initialize(
        { enDirect: false, rounds: 1, guessSeconds: 60, difficulty: niveau },
        [A, B],
        h.ctx,
      );
      s = must(photoMystere.start(s, h.ctx));
      const pub = photoMystere.getPublicState(s) as { photo: { indice: string | null } };
      expect(pub.photo.indice !== null).toBe(attendu);
    }
  });
});
