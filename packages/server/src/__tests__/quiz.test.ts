import { describe, expect, it } from 'vitest';
import { quizParty, type QuizState } from '@partyhub/games';
import type { GameContext, PlayerRef } from '@partyhub/shared';

/** Contexte de test : horloge pilotée à la main, joueurs connectés imposés. */
function makeCtx(connected: string[]) {
  const clock = { t: 1_000_000 };
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random: () => 0.42,
    connectedPlayerIds: () => connected,
  };
  return { ctx, clock, timers };
}

const alice: PlayerRef = { id: 'a', name: 'Alice' };
const bob: PlayerRef = { id: 'b', name: 'Bob' };

function startedGame(questionCount = 3, answerSeconds = 20, speedBonus = true) {
  const { ctx, clock, timers } = makeCtx(['a', 'b']);
  const init = quizParty.initialize(
    { questionCount, answerSeconds, speedBonus },
    [alice, bob],
    ctx,
  ) as QuizState;
  const started = quizParty.start(init, ctx);
  if (!started.ok) throw new Error(started.error);
  return { state: started.state as QuizState, ctx, clock, timers };
}

function answer(state: QuizState, player: PlayerRef, choice: number, ctx: GameContext) {
  const res = quizParty.handleAction(state, player, 'answer', { choice }, ctx);
  if (!res.ok) throw new Error(res.error);
  return res.state as QuizState;
}

/** Ferme la question comme le ferait le minuteur (un joueur n'a pas répondu à temps). */
function timeout(state: QuizState, ctx: GameContext): QuizState {
  return quizParty.onTimer(state, 'answer-timeout', ctx);
}

describe('Quiz Party : règles de score', () => {
  it('attribue les points de base aux bonnes réponses et rien aux mauvaises', () => {
    const { state, ctx } = startedGame(1, 20, false);
    const good = state.questions[0]!.answer;
    const wrong = (good + 1) % state.questions[0]!.choices.length;

    let s = answer(state, alice, good, ctx);
    s = answer(s, bob, wrong, ctx);

    expect(s.phase).toBe('reveal');
    expect(s.points.a).toBe(100);
    expect(s.points.b).toBe(0);
  });

  it('ajoute un bonus de rapidité plafonné quand il est activé', () => {
    // Réponse immédiate : bonus maximal (50), soit 150 points.
    const { state, ctx } = startedGame(1, 20, true);
    const fast = timeout(answer(state, alice, state.questions[0]!.answer, ctx), ctx);
    expect(fast.points.a).toBe(150);

    // Moitié du temps écoulé : bonus de 25, soit 125 points.
    const { state: s2, ctx: ctx2, clock: clock2 } = startedGame(1, 20, true);
    clock2.t += 10_000;
    const slow = timeout(answer(s2, alice, s2.questions[0]!.answer, ctx2), ctx2);
    expect(slow.points.a).toBe(125);
  });

  it('ne donne aucun bonus si la fonction est désactivée', () => {
    const { state, ctx } = startedGame(1, 20, false);
    const s = timeout(answer(state, alice, state.questions[0]!.answer, ctx), ctx);
    expect(s.points.a).toBe(100);
  });

  it('classe les ex æquo au même rang (compétition : 1, 1, 3)', () => {
    const { ctx } = makeCtx(['a', 'b', 'c']);
    const carl: PlayerRef = { id: 'c', name: 'Carl' };
    const init = quizParty.initialize(
      { questionCount: 1, answerSeconds: 20, speedBonus: false },
      [alice, bob, carl],
      ctx,
    ) as QuizState;
    const s0 = quizParty.start(init, ctx);
    if (!s0.ok) throw new Error(s0.error);
    const correct = s0.state.questions[0]!.answer;
    const wrong = (correct + 1) % 4;

    let s = answer(s0.state as QuizState, alice, correct, ctx);
    s = answer(s, bob, correct, ctx);
    s = answer(s, carl, wrong, ctx);

    const ranks = quizParty.calculateScores(s).map((e) => [e.name, e.rank]);
    expect(ranks).toEqual([
      ['Alice', 1],
      ['Bob', 1],
      ['Carl', 3],
    ]);
  });
});

describe('Quiz Party : validation et déroulement', () => {
  it('refuse une seconde réponse du même joueur', () => {
    const { state, ctx } = startedGame(2);
    const once = answer(state, alice, 0, ctx);
    const twice = quizParty.handleAction(once, alice, 'answer', { choice: 1 }, ctx);
    expect(twice.ok).toBe(false);
  });

  it('refuse un choix hors des propositions', () => {
    const { state, ctx } = startedGame(2);
    const res = quizParty.handleAction(state, alice, 'answer', { choice: 9 }, ctx);
    expect(res.ok).toBe(false);
  });

  it('refuse une action inconnue', () => {
    const { state, ctx } = startedGame(2);
    const res = quizParty.handleAction(state, alice, 'tricher', {}, ctx);
    expect(res.ok).toBe(false);
  });

  it('ne révèle jamais la bonne réponse pendant la question', () => {
    const { state } = startedGame(2);
    const view = quizParty.getPublicState(state) as Record<string, unknown>;
    expect(view.phase).toBe('question');
    expect(view).not.toHaveProperty('answer');
  });

  it('ne montre à un joueur que sa propre réponse', () => {
    const { state, ctx } = startedGame(2);
    const s = answer(state, alice, 2, ctx);
    const mine = quizParty.getPlayerState(s, 'a') as { myChoice: number | null };
    const theirs = quizParty.getPlayerState(s, 'b') as { myChoice: number | null; answered: boolean };
    expect(mine.myChoice).toBe(2);
    expect(theirs.answered).toBe(false);
    expect(JSON.stringify(theirs)).not.toContain('"myChoice":2');
  });

  it('passe de la question à la révélation puis à la fin', () => {
    const { state, ctx } = startedGame(1);
    const q = state.questions[0]!;
    const revealed = answer(state, alice, q.answer, ctx);
    const bothAnswered = answer(revealed, bob, q.answer, ctx);
    expect(bothAnswered.phase).toBe('reveal');

    const finished = quizParty.nextRound(bothAnswered, ctx);
    expect(finished.phase).toBe('final');
    expect(quizParty.isFinished(finished)).toBe(true);
  });

  it('ferme la question quand le temps est écoulé', () => {
    const { state, ctx } = startedGame(2);
    const after = quizParty.onTimer(state, 'answer-timeout', ctx);
    expect(after.phase).toBe('reveal');
  });
});
