import { describe, expect, it } from 'vitest';
import type { GameJob, JobOutcome, PlayerRef } from '@partyhub/shared';
import { phrasesTrous, type PhrasesState } from '../phrases-trous/module.js';
import {
  buildPhrasesPrompt,
  runPhrasesJob,
  validatePhrasesDraft,
  type PhrasesThemesInput,
} from '../phrases-trous/ai.js';
import { BLANK, completesHole, dealHand, fillSentence, removeCard } from '../phrases-trous/rules.js';
import { CURATED_CARDS_MIN } from '../phrases-trous/fallback.js';
import { A, B, C, PLAYERS, mulberry32, must } from './aventure-helpers.js';
import { fakeAi, harness, type Harness } from './turn-harness.js';

const signal = () => new AbortController().signal;

const SETTINGS = phrasesTrous.settingsSchema.parse({
  rounds: 3,
  handSize: 3,
  topicSeconds: 30,
  fillSeconds: 30,
  voteSeconds: 25,
});

/** Réponse de l'IA valide : trois phrases à trou et des leurres. */
const DRAFT = {
  phrases: [
    { phrase: `Au petit-déjeuner, le chat a renversé son bol de ${BLANK}.`, reponse: 'lait' },
    { phrase: `Le facteur est arrivé en ${BLANK} sur son vélo.`, reponse: 'retard' },
    { phrase: `Le pirate a enterré son trésor au pied d’un ${BLANK}.`, reponse: 'palmier' },
  ],
  cartes: [
    'pantoufle',
    'tuba',
    'ananas',
    'soupe',
    'brocoli',
    'casserole',
    'parapluie',
    'yaourt',
    'moustache',
    'fromage',
    'kangourou',
    'trompette',
  ],
};

const INPUT: PhrasesThemesInput = { themes: [{ name: 'Ana', keywords: ['volcans'] }], rounds: 3 };

/** Vue publique, typée seulement pour les besoins des assertions. */
interface View {
  phase: string;
  index: number;
  notice: string | null;
  sentence?: string;
  options?: Array<{ text: string }>;
  voted?: number;
  voters?: number;
  topics?: { current: string | null };
  ranking: Array<{ name: string; points: number }>;
}
const view = (s: PhrasesState) => phrasesTrous.getPublicState(s) as unknown as View;

function begin(h: Harness): PhrasesState {
  return must(phrasesTrous.start(phrasesTrous.initialize(SETTINGS, PLAYERS, h.ctx), h.ctx));
}

/** Tout le monde laisse passer son tour de mots-clés : la partie prend alors les phrases intégrées. */
function passAllTopics(h: Harness, start: PhrasesState): PhrasesState {
  let s = start;
  for (let i = 0; i < PLAYERS.length; i++) s = h.fire(phrasesTrous, s, 'topic-timeout');
  return s;
}

/** Chacun donne des mots-clés à son tour, puis la phrase est demandée à l'IA et la pose commence. */
async function toFillWithAi(h: Harness, start: PhrasesState): Promise<PhrasesState> {
  let s = start;
  const turns: Array<[PlayerRef, string]> = [
    [A, 'volcans, lave'],
    [B, 'cinéma'],
    [C, 'musique'],
  ];
  for (const [p, words] of turns) {
    s = must(phrasesTrous.handleAction(s, p, 'keywords', { words }, h.ctx));
  }
  const job = phrasesTrous.pendingJob!(s)!;
  let outcome: JobOutcome;
  try {
    outcome = { ok: true, value: await phrasesTrous.runJob!(job, h.ctx, signal()) };
  } catch (err) {
    outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return phrasesTrous.completeJob!(s, job.id, outcome, h.ctx);
}

/** Chaque joueur pose la première carte de sa main. */
function playFirstCards(h: Harness, start: PhrasesState, players: PlayerRef[] = PLAYERS): PhrasesState {
  let s = start;
  for (const p of players) {
    const card = (s.hands[p.id] ?? [])[0];
    if (card === undefined) continue;
    s = must(phrasesTrous.handleAction(s, p, 'play', { card }, h.ctx));
  }
  return s;
}

describe('Phrases à trous : règles', () => {
  it('remplit le trou avec la carte posée', () => {
    expect(fillSentence(`Le ${BLANK} est bleu.`, 'ciel')).toBe('Le ciel est bleu.');
  });

  it('compare une carte à la réponse sans tenir compte de la casse, des accents ni de la ponctuation', () => {
    expect(completesHole('Lune', 'lune')).toBe(true);
    expect(completesHole('élan.', 'Elan')).toBe(true);
    expect(completesHole('Soleil', 'Lune')).toBe(false);
    expect(completesHole('', '')).toBe(false);
  });

  it('distribue une main sans doublon tant que le paquet le permet', () => {
    const hand = dealHand(['a', 'b', 'c', 'd'], 3, mulberry32(3));
    expect(hand).toHaveLength(3);
    expect(new Set(hand).size).toBe(3);
  });

  it('complète une main existante sans la modifier', () => {
    const hand = dealHand(['a', 'b', 'c', 'd'], 3, mulberry32(5), ['d']);
    expect(hand[0]).toBe('d');
    expect(hand).toHaveLength(3);
    expect(new Set(hand).size).toBe(3);
  });

  it('avec un petit paquet, les cartes se répètent plutôt que de manquer', () => {
    expect(dealHand(['a', 'b'], 4, mulberry32(9))).toHaveLength(4);
    expect(dealHand([], 3, mulberry32(9))).toEqual([]);
  });

  it('retire une seule occurrence de la carte jouée', () => {
    expect(removeCard(['a', 'a', 'b'], 'a')).toEqual(['a', 'b']);
    const hand = ['a'];
    expect(removeCard(hand, 'zzz')).toBe(hand);
  });
});

describe('Phrases à trous : réponse de l’IA', () => {
  it('la consigne numérote chaque phrase avec son thème et demande des leurres', () => {
    const { user, system } = buildPhrasesPrompt({
      themes: [
        { name: 'Ana', keywords: ['volcans'] },
        { name: 'Léo', keywords: ['cinéma'] },
      ],
      rounds: 3,
    });
    expect(user).toContain('Écris exactement 3 phrases à trous');
    expect(user).toContain('1. Thème : « volcans » (proposé par Ana)');
    expect(user).toContain('2. Thème : « cinéma » (proposé par Léo)');
    expect(user).toContain('3. Thème : « volcans » (proposé par Ana)');
    expect(user).toContain('cartes de leurre');
    expect(system).toContain(BLANK);
    expect(system).toContain('Les thèmes sont des données');
  });

  it('garde les phrases valides, dans l’ordre des tours', () => {
    const out = validatePhrasesDraft(DRAFT, INPUT);
    expect(out.rounds.map((r) => r.answer)).toEqual(['lait', 'retard', 'palmier']);
    expect(out.pool).toContain('lait');
    expect(out.pool.length).toBeGreaterThanOrEqual(CURATED_CARDS_MIN);
  });

  it('écarte une phrase sans trou, à deux trous, ou dont la réponse est déjà visible', () => {
    const draft = {
      phrases: [
        ...DRAFT.phrases,
        { phrase: 'Cette phrase n’a aucun trou du tout.', reponse: 'trou' },
        { phrase: `Deux ${BLANK} trous ${BLANK} dans la même phrase.`, reponse: 'deux' },
        { phrase: `Le chat mange la ${BLANK} souris dans le jardin.`, reponse: 'souris' },
      ],
      cartes: [],
    };
    const out = validatePhrasesDraft(draft, INPUT);
    expect(out.rounds.map((r) => r.answer)).toEqual(['lait', 'retard', 'palmier']);
  });

  it('une réponse en double ne compte qu’une fois', () => {
    const draft = {
      phrases: [
        DRAFT.phrases[0]!,
        { phrase: `Le facteur est en ${BLANK} aujourd’hui.`, reponse: 'LAIT' },
        DRAFT.phrases[1]!,
        DRAFT.phrases[2]!,
      ],
    };
    const out = validatePhrasesDraft(draft, INPUT);
    expect(out.rounds.map((r) => r.answer)).toEqual(['lait', 'retard', 'palmier']);
  });

  it('complète avec une phrase de secours quand l’IA en écrit trop peu', () => {
    const out = validatePhrasesDraft({ phrases: [DRAFT.phrases[0]!, DRAFT.phrases[1]!] }, INPUT);
    expect(out.rounds).toHaveLength(3);
    const answers = out.rounds.map((r) => r.answer.toLowerCase());
    expect(new Set(answers).size).toBe(3);
  });

  it('sans leurres dans la réponse, le paquet est complété avec des leurres écrits à l’avance', () => {
    const out = validatePhrasesDraft({ phrases: DRAFT.phrases }, INPUT);
    expect(out.pool.length).toBeGreaterThanOrEqual(CURATED_CARDS_MIN);
    expect(out.pool).toContain('lait');
  });

  it('refuse une réponse hors format, ou trop incomplète pour être jouée', () => {
    expect(() => validatePhrasesDraft({ questions: [] }, INPUT)).toThrow('hors format');
    expect(() => validatePhrasesDraft({ phrases: [DRAFT.phrases[0]!] }, { ...INPUT, rounds: 4 })).toThrow('incomplète');
  });
});

describe('Phrases à trous : travail de l’IA', () => {
  const job = (input: PhrasesThemesInput): GameJob => ({ id: 'j', kind: 'phrases-themes', input });

  it('sans IA configurée, renvoie null (le jeu prend alors ses phrases intégrées)', async () => {
    expect(await runPhrasesJob(job(INPUT), harness().ctx, signal())).toBeNull();
  });

  it('lit la réponse de l’IA et la valide', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    const out = await runPhrasesJob(job(INPUT), h.ctx, signal());
    expect(out?.rounds).toHaveLength(3);
  });

  it('une réponse qui n’est pas du JSON lève une erreur, sans reprendre le texte de l’IA', async () => {
    const h = harness({ ai: fakeAi('bonjour, voici vos phrases') });
    await expect(runPhrasesJob(job(INPUT), h.ctx, signal())).rejects.toThrow('Réponse sans objet JSON.');
  });
});

describe('Phrases à trous : déroulement', () => {
  it('refuse le lancement à moins de deux joueurs', () => {
    const h = harness();
    const r = phrasesTrous.start(phrasesTrous.initialize(SETTINGS, [A], h.ctx), h.ctx);
    expect(r).toEqual({ ok: false, error: 'Il faut au moins deux joueurs' });
  });

  it('les mots-clés passent à tour de rôle : seul le joueur dont c’est le tour peut les donner', () => {
    const h = harness();
    let s = begin(h);
    expect(view(s).phase).toBe('topics');
    expect(phrasesTrous.handleAction(s, B, 'keywords', { words: 'cinéma' }, h.ctx).ok).toBe(false);
    s = must(phrasesTrous.handleAction(s, A, 'keywords', { words: 'volcans, lave' }, h.ctx));
    expect(view(s).phase).toBe('topics');
    expect(view(s).topics?.current).toBe('Léo');
  });

  it('si personne ne propose de mot-clé, les phrases intégrées sont tirées avec un message', () => {
    const h = harness();
    const s = passAllTopics(h, begin(h));
    expect(s.phase).toBe('fill');
    expect(s.notice).toBe('Aucun mot-clé proposé : phrases intégrées.');
    expect(s.rounds).toHaveLength(3);
    for (const p of PLAYERS) expect(s.hands[p.id]).toHaveLength(3);
  });

  it('avec l’IA, les phrases écrites à partir des mots-clés sont jouées', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    const s = await toFillWithAi(h, begin(h));
    expect(s.phase).toBe('fill');
    expect(s.notice).toBeNull();
    expect(s.rounds.map((r) => r.answer)).toEqual(['lait', 'retard', 'palmier']);
    expect(view(s).sentence).toBe(DRAFT.phrases[0]!.phrase);
  });

  it('sans IA configurée, le jeu prend ses phrases intégrées et le dit à l’écran', async () => {
    const h = harness();
    const s = await toFillWithAi(h, begin(h));
    expect(s.phase).toBe('fill');
    expect(s.notice).toBe('IA non configurée : phrases intégrées.');
  });

  it('une réponse de l’IA inutilisable ramène aux phrases intégrées sans bloquer la salle', async () => {
    const h = harness({ ai: fakeAi('pas du JSON du tout') });
    const s = await toFillWithAi(h, begin(h));
    expect(s.phase).toBe('fill');
    expect(s.notice).toBe('L’IA n’a pas pu écrire les phrases : phrases intégrées.');
  });

  it('un travail périmé ne change pas la partie', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = begin(h);
    for (const [p, words] of [
      [A, 'volcans'],
      [B, 'cinéma'],
      [C, 'musique'],
    ] as const) {
      s = must(phrasesTrous.handleAction(s, p, 'keywords', { words }, h.ctx));
    }
    expect(phrasesTrous.completeJob!(s, 'un-autre-travail', { ok: true, value: null }, h.ctx)).toBe(s);
  });

  it('une carte doit venir de sa main, et une seule carte se pose par tour', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = await toFillWithAi(h, begin(h));
    expect(phrasesTrous.handleAction(s, A, 'play', { card: 'carte-inconnue' }, h.ctx)).toEqual({
      ok: false,
      error: 'Cette carte n’est pas dans votre main',
    });
    const mine = (s.hands['a'] ?? [])[0]!;
    s = must(phrasesTrous.handleAction(s, A, 'play', { card: mine }, h.ctx));
    expect(s.fills['a']).toBe(mine);
    expect(s.hands['a']).toHaveLength(2);
    expect(phrasesTrous.handleAction(s, A, 'play', { card: (s.hands['a'] ?? [])[0] }, h.ctx)).toEqual({
      ok: false,
      error: 'Carte déjà posée',
    });
  });

  it('la main n’est visible que pendant la pose', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = await toFillWithAi(h, begin(h));
    expect(phrasesTrous.getPlayerState(s, 'a').hand).toHaveLength(3);
    s = playFirstCards(h, s);
    expect(s.phase).toBe('vote');
    expect(phrasesTrous.getPlayerState(s, 'a').hand).toEqual([]);
  });

  it('une fois toutes les cartes posées, les phrases se votent sans indiquer leur auteur', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    const s = playFirstCards(h, await toFillWithAi(h, begin(h)));
    expect(s.phase).toBe('vote');
    const pub = view(s);
    expect(pub.options).toHaveLength(3);
    expect(pub.voters).toBe(3);
    expect(pub.voted).toBe(0);
    for (const o of pub.options ?? []) {
      expect(Object.keys(o)).toEqual(['text']);
      expect(o.text).not.toContain(BLANK);
    }
    expect(JSON.stringify(pub.options)).not.toMatch(/Ana|Léo|Max/);
  });

  it('on ne peut pas voter pour sa propre phrase, et un vote n’est envoyé qu’une fois', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    const s = playFirstCards(h, await toFillWithAi(h, begin(h)));
    const own = s.options.indexOf('a');
    expect(phrasesTrous.handleAction(s, A, 'vote', { option: own }, h.ctx)).toEqual({
      ok: false,
      error: 'Vous ne pouvez pas voter pour votre propre phrase',
    });
    const other = s.options.findIndex((id) => id !== 'a');
    const voted = must(phrasesTrous.handleAction(s, B, 'vote', { option: other }, h.ctx));
    expect(phrasesTrous.handleAction(voted, B, 'vote', { option: other }, h.ctx)).toEqual({
      ok: false,
      error: 'Vote déjà envoyé',
    });
  });

  it('un joueur sans carte posée peut quand même voter', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    const s: PhrasesState = {
      ...(await toFillWithAi(h, begin(h))),
      phase: 'vote',
      fills: { a: 'lait', b: 'tuba' },
      options: ['a', 'b'],
      votes: {},
    };
    expect(phrasesTrous.handleAction(s, C, 'vote', { option: 0 }, h.ctx).ok).toBe(true);
  });

  it('chaque vote rapporte 100 points à son auteur, la carte qui complète le trou 50 de plus', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = await toFillWithAi(h, begin(h));
    // Mains fixées pour le test : A a la bonne carte pour la première phrase (« lait »).
    s = {
      ...s,
      hands: {
        a: ['lait', 'tuba', 'ananas'],
        b: ['tuba', 'ananas', 'soupe'],
        c: ['soupe', 'tuba', 'brocoli'],
      },
    };
    s = must(phrasesTrous.handleAction(s, A, 'play', { card: 'lait' }, h.ctx));
    s = must(phrasesTrous.handleAction(s, B, 'play', { card: 'tuba' }, h.ctx));
    s = must(phrasesTrous.handleAction(s, C, 'play', { card: 'soupe' }, h.ctx));
    expect(s.phase).toBe('vote');

    const at = (id: string) => s.options.indexOf(id);
    s = must(phrasesTrous.handleAction(s, C, 'vote', { option: at('a') }, h.ctx));
    s = must(phrasesTrous.handleAction(s, A, 'vote', { option: at('b') }, h.ctx));
    s = must(phrasesTrous.handleAction(s, B, 'vote', { option: at('a') }, h.ctx));

    expect(s.phase).toBe('reveal');
    expect(s.points).toEqual({ a: 250, b: 100, c: 0 });
    expect(s.gains['a']).toEqual({ votes: 2, points: 250, correct: true });
    expect(s.gains['b']).toEqual({ votes: 1, points: 100, correct: false });
  });

  it('faute de temps, les cartes manquantes sont tirées au hasard et signalées', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = await toFillWithAi(h, begin(h));
    s = must(phrasesTrous.handleAction(s, A, 'play', { card: (s.hands['a'] ?? [])[0] }, h.ctx));
    s = h.fire(phrasesTrous, s, 'fill-timeout');
    expect(Object.keys(s.fills)).toHaveLength(3);
    expect(s.auto).toEqual({ b: true, c: true });
    expect(s.phase).toBe('vote');
  });

  it('une seule carte posée passe directement à la révélation, sans vote', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = await toFillWithAi(h, begin(h));
    s = { ...s, hands: { ...s.hands, b: [], c: [] } };
    s = must(phrasesTrous.handleAction(s, A, 'play', { card: (s.hands['a'] ?? [])[0] }, h.ctx));
    s = h.fire(phrasesTrous, s, 'fill-timeout');
    expect(s.phase).toBe('reveal');
  });

  it('le temps du vote écoulé, la révélation arrive avec les votes reçus', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = playFirstCards(h, await toFillWithAi(h, begin(h)));
    s = h.fire(phrasesTrous, s, 'vote-timeout');
    expect(s.phase).toBe('reveal');
  });

  it('après la révélation, les cartes jouées sont remplacées et le tour suivant s’ouvre', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = await toFillWithAi(h, begin(h));
    s = { ...s, hands: { ...s.hands, b: [], c: [] } };
    s = must(phrasesTrous.handleAction(s, A, 'play', { card: (s.hands['a'] ?? [])[0] }, h.ctx));
    s = h.fire(phrasesTrous, s, 'fill-timeout');
    expect(s.phase).toBe('reveal');

    s = h.fire(phrasesTrous, s, 'reveal-next');
    expect(s.phase).toBe('fill');
    expect(s.index).toBe(1);
    expect(view(s).sentence).toBe(DRAFT.phrases[1]!.phrase);
    expect(s.hands['a']).toHaveLength(3);
  });

  it('après le dernier tour, la partie se termine et le plus de points gagne', async () => {
    const h = harness({ ai: fakeAi(JSON.stringify(DRAFT)) });
    let s = await toFillWithAi(h, begin(h));
    let guard = 0;
    while (s.phase !== 'final' && guard < 60) {
      s = phrasesTrous.nextRound!(s, h.ctx);
      guard += 1;
    }
    expect(s.phase).toBe('final');
    expect(phrasesTrous.isFinished(s)).toBe(true);
    expect(h.timers.size).toBe(0);
    const ranking = view(s).ranking;
    expect(ranking[0]?.points).toBe(Math.max(...ranking.map((r) => r.points)));
  });
});
