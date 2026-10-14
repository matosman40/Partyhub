import { describe, expect, it } from 'vitest';
import { quizMoods } from '../quiz-party/client/moods.js';

/** Humeurs des personnages pendant le quiz : elles suivent la phase, sans rien inventer. */
describe('Quiz : humeurs des personnages', () => {
  const ranking = [
    { name: 'Ana', rank: 1 },
    { name: 'Léo', rank: 2 },
    { name: 'Max', rank: 3 },
  ];

  it('fait saluer ceux qui ont répondu et laisse au repos ceux qui attendent', () => {
    const moods = quizMoods({ phase: 'question', ranking }, ['Max']);
    expect(moods).toEqual({ Ana: 'wave', Léo: 'wave', Max: 'idle' });
  });

  it('fait sourire la bonne réponse et attrister la mauvaise ou l’absence de réponse', () => {
    const results = [
      { name: 'Ana', correct: true },
      { name: 'Léo', correct: false },
      { name: 'Max', correct: false },
    ];
    expect(quizMoods({ phase: 'reveal', ranking, results }, [])).toEqual({
      Ana: 'joy',
      Léo: 'sad',
      Max: 'sad',
    });
  });

  it('fait danser le ou les premiers au classement final', () => {
    const tied = [
      { name: 'Ana', rank: 1 },
      { name: 'Léo', rank: 1 },
      { name: 'Max', rank: 3 },
    ];
    expect(quizMoods({ phase: 'final', ranking: tied }, [])).toEqual({ Ana: 'dance', Léo: 'dance', Max: 'idle' });
  });

  it('ne met aucune humeur avant le lancement', () => {
    expect(quizMoods({ phase: 'ready', ranking }, [])).toEqual({});
  });
});
