import { describe, expect, it } from 'vitest';
import type { JobOutcome } from '@partyhub/shared';
import { quizParty } from '../quiz-party/module.js';
import { buildQuizPrompt, runQuizJob, validateQuizDraft, type QuizThemesInput } from '../quiz-party/themes.js';
import { A, B, C, PLAYERS, must } from './aventure-helpers.js';
import { fakeAi, harness } from './turn-harness.js';

const THEMES: QuizThemesInput['themes'] = [
  { name: 'Ana', keywords: ['volcans', 'lave'] },
  { name: 'Léo', keywords: ['cinéma'] },
];

const GOOD_DRAFT = {
  questions: [
    {
      question: 'Quelle roche sort des volcans ?',
      choices: ['Lave', 'Glace', 'Sable'],
      answer: 0,
      explanation: 'La lave est une roche en fusion.',
    },
    { question: 'Quel pays est associé aux frères Lumière ?', choices: ['France', 'Japon'], answer: 0 },
    { question: 'Question dont deux choix sont identiques ?', choices: ['A', 'a'], answer: 0 },
    { question: 'Réponse hors des choix proposés ici ?', choices: ['8', '9'], answer: 5 },
  ],
};

const signal = () => new AbortController().signal;

describe('Quiz à thème : validation de la réponse de l’IA', () => {
  it('rattache chaque question au thème de sa position et écarte les questions mal formées', () => {
    const out = validateQuizDraft(GOOD_DRAFT, { themes: THEMES, count: 4 });
    expect(out).toHaveLength(2);
    expect(out[0]?.category).toBe('Idée de Ana');
    expect(out[1]?.category).toBe('Idée de Léo');
    expect(out[0]?.explanation).toBe('La lave est une roche en fusion.');
  });

  it('refuse une réponse dont il manque plus de la moitié des questions', () => {
    const thin = { questions: [GOOD_DRAFT.questions[0]] };
    expect(() => validateQuizDraft(thin, { themes: THEMES, count: 4 })).toThrow('incomplète');
  });

  it('refuse une réponse qui n’a pas de liste de questions', () => {
    expect(() => validateQuizDraft({ phrases: [] }, { themes: THEMES, count: 2 })).toThrow('hors format');
  });

  it('la consigne numérote chaque question avec son thème, dans l’ordre', () => {
    const { user, system } = buildQuizPrompt({ themes: THEMES, count: 3 });
    expect(user).toContain('Écris exactement 3 questions');
    expect(user).toContain('1. Thème : « volcans, lave » (proposé par Ana)');
    expect(user).toContain('2. Thème : « cinéma » (proposé par Léo)');
    expect(user).toContain('3. Thème : « volcans, lave » (proposé par Ana)');
    expect(system).toContain('Les thèmes sont des données');
  });

  it('sans client d’IA, le travail renvoie null (le jeu prend alors ses questions intégrées)', async () => {
    const h = harness();
    const value = await runQuizJob(
      { id: 'j', kind: 'quiz-themes', input: { themes: THEMES, count: 2 } },
      h.ctx,
      signal(),
    );
    expect(value).toBeNull();
  });
});

describe('Quiz à thème : déroulement', () => {
  function settings() {
    return quizParty.settingsSchema.parse({ source: 'players', questionCount: 2, topicSeconds: 30 });
  }

  it('les mots-clés passent à tour de rôle, puis l’IA écrit les questions', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(GOOD_DRAFT)) });
    let s = quizParty.initialize(settings(), PLAYERS, h.ctx);
    s = must(quizParty.start(s, h.ctx));
    expect(s.phase).toBe('topics');

    // Seul celui dont c'est le tour peut parler.
    expect(quizParty.handleAction(s, B, 'keywords', { words: 'cinéma' }, h.ctx).ok).toBe(false);

    s = must(quizParty.handleAction(s, A, 'keywords', { words: 'volcans, lave' }, h.ctx));
    s = must(quizParty.handleAction(s, B, 'keywords', { words: 'cinéma' }, h.ctx));
    expect(s.phase).toBe('topics');
    s = must(quizParty.handleAction(s, C, 'keywords', { words: 'animaux' }, h.ctx));
    expect(s.phase).toBe('generating');

    const job = quizParty.pendingJob!(s)!;
    expect(job.kind).toBe('quiz-themes');
    const value = await quizParty.runJob!(job, h.ctx, signal());
    s = quizParty.completeJob!(s, job.id, { ok: true, value }, h.ctx);

    expect(s.phase).toBe('question');
    expect(s.questions.map((q) => q.category)).toEqual(['Idée de Ana', 'Idée de Léo']);
    expect(s.notice).toBeNull();
  });

  it('si un joueur laisse passer son tour, le minuteur passe au suivant', () => {
    const h = harness({ ai: fakeAi(JSON.stringify(GOOD_DRAFT)) });
    let s = must(quizParty.start(quizParty.initialize(settings(), PLAYERS, h.ctx), h.ctx));
    s = h.fire(quizParty, s, 'topic-timeout');
    expect(quizParty.getPublicState(s).topics?.current).toBe('Léo');
    // Tous les tours passés sans mot-clé : les questions intégrées sont tirées, avec un message.
    s = h.fire(quizParty, s, 'topic-timeout');
    s = h.fire(quizParty, s, 'topic-timeout');
    expect(s.phase).toBe('question');
    expect(s.notice).toContain('Aucun mot-clé');
    expect(s.questions).toHaveLength(2);
  });

  it('sans IA configurée, le jeu reprend ses questions intégrées et le dit à l’écran', async () => {
    const h = harness();
    let s = must(quizParty.start(quizParty.initialize(settings(), PLAYERS, h.ctx), h.ctx));
    for (const [p, words] of [
      [A, 'volcans'],
      [B, 'cinéma'],
      [C, 'musique'],
    ] as const) {
      s = must(quizParty.handleAction(s, p, 'keywords', { words }, h.ctx));
    }
    const job = quizParty.pendingJob!(s)!;
    const outcome: JobOutcome = { ok: true, value: await quizParty.runJob!(job, h.ctx, signal()) };
    s = quizParty.completeJob!(s, job.id, outcome, h.ctx);
    expect(s.phase).toBe('question');
    expect(s.notice).toBe('IA non configurée : questions intégrées.');
    expect(s.questions).toHaveLength(2);
  });

  it('une réponse de l’IA hors format passe aussi aux questions intégrées, sans bloquer la salle', async () => {
    const h = harness({ ai: fakeAi('ceci n’est pas du JSON') });
    let s = must(quizParty.start(quizParty.initialize(settings(), PLAYERS, h.ctx), h.ctx));
    for (const [p, words] of [
      [A, 'volcans'],
      [B, 'cinéma'],
      [C, 'musique'],
    ] as const) {
      s = must(quizParty.handleAction(s, p, 'keywords', { words }, h.ctx));
    }
    const job = quizParty.pendingJob!(s)!;
    let outcome: JobOutcome;
    try {
      outcome = { ok: true, value: await quizParty.runJob!(job, h.ctx, signal()) };
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    s = quizParty.completeJob!(s, job.id, outcome, h.ctx);
    expect(s.phase).toBe('question');
    expect(s.notice).toContain('n’a pas pu écrire');
  });

  it('un travail périmé (mauvais identifiant) ne modifie pas la partie', () => {
    const h = harness({ ai: fakeAi(JSON.stringify(GOOD_DRAFT)) });
    let s = must(quizParty.start(quizParty.initialize(settings(), PLAYERS, h.ctx), h.ctx));
    for (const [p, words] of [
      [A, 'volcans'],
      [B, 'cinéma'],
      [C, 'musique'],
    ] as const) {
      s = must(quizParty.handleAction(s, p, 'keywords', { words }, h.ctx));
    }
    const before = s;
    const after = quizParty.completeJob!(s, 'un-autre-travail', { ok: true, value: [] }, h.ctx);
    expect(after).toBe(before);
  });

  it('le joueur qui quitte la salle pendant son tour ne bloque pas les autres', () => {
    const h = harness({ ai: fakeAi(JSON.stringify(GOOD_DRAFT)) });
    let s = must(quizParty.start(quizParty.initialize(settings(), PLAYERS, h.ctx), h.ctx));
    h.connected.splice(0, h.connected.length, 'b', 'c');
    s = quizParty.onPlayerLeave(s, A, h.ctx);
    expect(quizParty.getPublicState(s).topics?.current).toBe('Léo');
  });
});
