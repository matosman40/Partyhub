import { describe, expect, it } from 'vitest';
import { quizParty, type QuizState } from '../quiz-party/module.js';
import { createWorld, step } from '../sauteurs/engine.js';
import { createBot } from '../sauteurs/bot.js';
import { LEVELS } from '../sauteurs/levels.js';

/** Les robots sont des adversaires modestes : ils répondent tard, et courent avec des distractions. */
describe('Quiz : robot', () => {
  const state = {
    phase: 'question',
    answers: {},
    index: 0,
    questions: [{ choices: ['a', 'b', 'c', 'd'], answer: 1 }],
    settings: { answerSeconds: 20 },
  } as unknown as QuizState;

  it('répond dans la seconde moitié du temps imparti, jamais avant', () => {
    for (const r of [0, 0.5, 0.999]) {
      const s = quizParty.suggest!(state, 'bot', () => r);
      expect(s?.delayMs).toBeGreaterThanOrEqual(20_000 * 0.55);
      expect(s?.delayMs).toBeLessThan(20_000 * 0.9 + 1);
    }
  });

  it('ne propose rien une fois sa réponse donnée', () => {
    const answered = { ...state, answers: { bot: { choice: 0 } } } as unknown as QuizState;
    expect(quizParty.suggest!(answered, 'bot', () => 0.5)).toBeNull();
  });
});

describe('Sauteurs : robot distrait', () => {
  it('sans distraction, il avance dès le premier pas', () => {
    const w = createWorld(LEVELS[0]!, ['a']);
    const bot = createBot('a', { lapse: 0 });
    expect(bot.act(w).right).toBe(true);
  });

  it('une distraction lui fait lâcher les commandes plusieurs pas de suite', () => {
    const w = createWorld(LEVELS[0]!, ['a']);
    const bot = createBot('a', { lapse: 1, random: () => 0 });
    const inputs = Array.from({ length: 8 }, () => bot.act(w));
    expect(inputs.every((i) => !i.left && !i.right && !i.jump)).toBe(true);
  });

  it('un robot distrait avance moins loin qu’un robot attentif sur le même temps', () => {
    const run = (lapse: number): number => {
      const w = createWorld(LEVELS[0]!, ['a']);
      let seed = 3;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const bot = createBot('a', { horizon: 22, lapse, random });
      for (let i = 0; i < 600; i++) step(w, { a: bot.act(w) });
      return w.players[0]!.x;
    };
    expect(run(0.03)).toBeLessThan(run(0));
  });
});
