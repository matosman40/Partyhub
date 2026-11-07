import { describe, expect, it } from 'vitest';
import { quizParty } from '../quiz-party/module.js';
import { questionSchema } from '../quiz-party/questions.js';
import { A, B, PLAYERS, must } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

const IMAGE = {
  src: '/quiz-party/monet-nympheas.jpg',
  alt: 'Tableau aux nymphéas',
  credit: 'The Met',
  license: 'CC0',
  source: 'https://www.metmuseum.org/art/collection/search/436535',
};

const BASE = {
  id: 'img-1',
  category: 'Culture',
  question: 'Qui a peint ce tableau ?',
  choices: ['Claude Monet', 'Edgar Degas', 'Pierre Renoir'],
  answer: 0,
};

describe('image d’une question du quiz', () => {
  it('accepte une image servie sous /quiz-party/ et une question sans image', () => {
    expect(questionSchema.safeParse({ ...BASE, image: IMAGE }).success).toBe(true);
    expect(questionSchema.safeParse(BASE).success).toBe(true);
  });

  it('refuse une image qui pointe hors de /quiz-party/', () => {
    const externe = { ...IMAGE, src: 'https://exemple.org/tableau.jpg' };
    expect(questionSchema.safeParse({ ...BASE, image: externe }).success).toBe(false);
  });

  it('refuse une image sans crédit ni licence', () => {
    const { credit: _credit, ...sansCredit } = IMAGE;
    expect(questionSchema.safeParse({ ...BASE, image: sansCredit }).success).toBe(false);
  });

  it('la vue publique transmet l’image, sans révéler la réponse pendant la question', () => {
    const h = harness({ connected: [A.id, B.id] });
    let s = quizParty.initialize(
      { enDirect: false, source: 'curated', questionCount: 1, answerSeconds: 20, topicSeconds: 30, speedBonus: false },
      PLAYERS.slice(0, 2),
      h.ctx,
    );
    s = must(quizParty.start(s, h.ctx));
    s = { ...s, questions: [{ ...s.questions[0]!, image: IMAGE }] };

    const pendant = quizParty.getPublicState(s) as { question: Record<string, unknown> };
    expect(pendant.question.image).toEqual(IMAGE);
    expect(pendant.question).not.toHaveProperty('answer');

    const revelee = quizParty.nextRound(s, h.ctx);
    const apres = quizParty.getPublicState(revelee) as { phase: string; question: Record<string, unknown> };
    expect(apres.phase).toBe('reveal');
    expect(apres.question.image).toEqual(IMAGE);
  });

  it('sans image, la vue publique ne contient pas de champ image', () => {
    const h = harness({ connected: [A.id, B.id] });
    let s = quizParty.initialize(
      { enDirect: false, source: 'curated', questionCount: 1, answerSeconds: 20, topicSeconds: 30, speedBonus: false },
      PLAYERS.slice(0, 2),
      h.ctx,
    );
    s = must(quizParty.start(s, h.ctx));
    s = { ...s, questions: [{ ...s.questions[0]!, image: undefined }] };
    const pub = quizParty.getPublicState(s) as { question: Record<string, unknown> };
    expect(pub.question).not.toHaveProperty('image');
  });
});
