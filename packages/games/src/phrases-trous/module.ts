import { z } from 'zod';
import type { GameContext, GameModule, GameResult, JobOutcome, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import {
  BOT_KEYWORDS,
  TOPIC_SECONDS_DEFAULT,
  keywordThemes,
  keywordsPayloadSchema,
  openKeywordTurns,
  parseKeywords,
  passTurn,
  submitKeywords,
  turnPlayer,
  turnsDone,
  type KeywordTurns,
} from '../common/keywords.js';
import { PHRASES_JOB_KIND, runPhrasesJob, type PhrasesThemesInput } from './ai.js';
import { curatedContent, type PhraseContent, type PhraseRound } from './fallback.js';
import { completesHole, dealHand, fillSentence, removeCard } from './rules.js';

/**
 * Phrases à trous : l'IA écrit des phrases à trou à partir des mots-clés de chacun. À chaque tour, tout le monde
 * pose une carte de sa main dans le trou. Les phrases complétées sont ensuite votées, sans savoir qui les a
 * écrites. Une carte qui complète juste le trou rapporte un bonus. Après le dernier tour, le plus de points gagne.
 */

export const phrasesSettingsSchema = z.object({
  rounds: z.number().int().min(3).max(8).default(5),
  handSize: z.number().int().min(3).max(6).default(4),
  topicSeconds: z.number().int().min(10).max(60).default(TOPIC_SECONDS_DEFAULT),
  fillSeconds: z.number().int().min(10).max(60).default(30),
  voteSeconds: z.number().int().min(10).max(60).default(25),
});

export type PhrasesSettings = z.infer<typeof phrasesSettingsSchema>;

const VOTE_POINTS = 100;
const CORRECT_POINTS = 50;
const REVEAL_MS = 9000;

const TOPIC_TIMEOUT = 'topic-timeout';
const FILL_TIMEOUT = 'fill-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const REVEAL_NEXT = 'reveal-next';

const playSchema = z.object({ card: z.string().min(1).max(40) });
const voteSchema = z.object({ option: z.number().int().min(0).max(11) });

export type PhrasesPhase = 'ready' | 'topics' | 'generating' | 'fill' | 'vote' | 'reveal' | 'final';

export interface RoundGain {
  votes: number;
  points: number;
  correct: boolean;
}

export interface PhrasesState {
  phase: PhrasesPhase;
  settings: PhrasesSettings;
  players: Record<string, string>;
  points: Record<string, number>;
  /** Tour de parole des mots-clés, conservé ensuite pour l'affichage des thèmes. */
  topics: KeywordTurns | null;
  jobId: string | null;
  notice: string | null;
  /** Tours du jeu : une phrase et sa réponse (cachée tant que le tour n'est pas révélé). */
  rounds: PhraseRound[];
  /** Cartes du jeu. Chaque main est tirée dedans et complétée après chaque tour. */
  pool: string[];
  hands: Record<string, string[]>;
  index: number;
  endsAt: number;
  /** Carte posée dans le trou, par joueur, pour le tour en cours. */
  fills: Record<string, string>;
  /** Joueurs dont la carte a été choisie automatiquement, faute de temps. */
  auto: Record<string, boolean>;
  /** Auteurs des phrases dans l'ordre de vote anonyme. */
  options: string[];
  /** Votant -> indice de la phrase choisie. */
  votes: Record<string, number>;
  /** Résultats du tour en cours, révélés à la fin du vote. */
  gains: Record<string, RoundGain>;
}

function clearTimers(ctx: GameContext): void {
  ctx.cancel(TOPIC_TIMEOUT);
  ctx.cancel(FILL_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
}

export function rankPlayers(s: PhrasesState): ScoreEntry[] {
  return rankEntries(s.players, s.points);
}

/* ---------------------------------------------------------------- mots-clés */

function openTopics(s: PhrasesState, ctx: GameContext): PhrasesState {
  const topics = openKeywordTurns(Object.keys(s.players), ctx.now(), s.settings.topicSeconds, ctx.connectedPlayerIds());
  return afterTopicTurn({ ...s, phase: 'topics' }, topics, ctx);
}

function afterTopicTurn(s: PhrasesState, topics: KeywordTurns, ctx: GameContext): PhrasesState {
  if (turnsDone(topics)) return closeTopics({ ...s, topics }, ctx);
  ctx.schedule(TOPIC_TIMEOUT, s.settings.topicSeconds * 1000);
  return { ...s, topics };
}

/** Sans aucun mot-clé, les phrases intégrées sont tirées tout de suite. Sinon, l'IA écrit les phrases. */
function closeTopics(s: PhrasesState, ctx: GameContext): PhrasesState {
  ctx.cancel(TOPIC_TIMEOUT);
  const themes = s.topics ? keywordThemes(s.topics, s.players) : [];
  if (themes.length === 0) {
    const content = curatedContent(s.settings.rounds, ctx.random);
    return startGame({ ...s, notice: 'Aucun mot-clé proposé : phrases intégrées.' }, content, ctx);
  }
  return { ...s, phase: 'generating', jobId: `phrases-${ctx.now()}`, notice: null };
}

/* ---------------------------------------------------------------- tours */

/** Distribue une main à chaque joueur, puis ouvre le premier tour. */
function startGame(s: PhrasesState, content: PhraseContent, ctx: GameContext): PhrasesState {
  const hands: Record<string, string[]> = {};
  for (const id of Object.keys(s.players)) {
    hands[id] = dealHand(content.pool, s.settings.handSize, ctx.random);
  }
  return openFill({ ...s, rounds: content.rounds, pool: content.pool, hands, index: 0, jobId: null }, ctx);
}

function openFill(s: PhrasesState, ctx: GameContext): PhrasesState {
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  const ms = s.settings.fillSeconds * 1000;
  ctx.schedule(FILL_TIMEOUT, ms);
  return { ...s, phase: 'fill', fills: {}, auto: {}, options: [], votes: {}, gains: {}, endsAt: ctx.now() + ms };
}

/** Faute de temps, chaque joueur connecté sans carte posée en pose une au hasard. */
function autoFill(s: PhrasesState, ctx: GameContext): PhrasesState {
  const fills = { ...s.fills };
  const auto = { ...s.auto };
  const hands = { ...s.hands };
  const connected = ctx.connectedPlayerIds();
  for (const id of Object.keys(s.players)) {
    if (id in fills || !connected.includes(id)) continue;
    const hand = hands[id] ?? [];
    if (hand.length === 0) continue;
    const card = hand[Math.floor(ctx.random() * hand.length)]!;
    fills[id] = card;
    auto[id] = true;
    hands[id] = removeCard(hand, card);
  }
  return { ...s, fills, auto, hands };
}

/** Fin de la pose : deux phrases ou plus se votent ; une seule, ou aucune, passe directement à la révélation. */
function closeFill(s: PhrasesState, ctx: GameContext): PhrasesState {
  ctx.cancel(FILL_TIMEOUT);
  const options = shuffle(Object.keys(s.fills), ctx.random);
  if (options.length < 2) return reveal({ ...s, options, votes: {} }, ctx);
  const ms = s.settings.voteSeconds * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', options, votes: {}, endsAt: ctx.now() + ms };
}

/** Points de la manche : 100 par vote reçu, 50 de plus pour la carte qui complète juste le trou. */
function reveal(s: PhrasesState, ctx: GameContext): PhrasesState {
  ctx.cancel(FILL_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  const answer = s.rounds[s.index]?.answer ?? '';
  const gains: Record<string, RoundGain> = {};
  for (const id of Object.keys(s.fills)) {
    gains[id] = { votes: 0, points: 0, correct: completesHole(s.fills[id]!, answer) };
  }
  for (const option of Object.values(s.votes)) {
    const author = s.options[option];
    if (author !== undefined && gains[author]) gains[author]!.votes += 1;
  }
  const points = { ...s.points };
  for (const [id, gain] of Object.entries(gains)) {
    gain.points = gain.votes * VOTE_POINTS + (gain.correct ? CORRECT_POINTS : 0);
    points[id] = (points[id] ?? 0) + gain.points;
  }
  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'reveal', points, gains, endsAt: ctx.now() + REVEAL_MS };
}

/** Après la révélation : chaque joueur qui a posé une carte en reçoit une nouvelle, puis le tour suivant commence. */
function advance(s: PhrasesState, ctx: GameContext): PhrasesState {
  ctx.cancel(REVEAL_NEXT);
  const hands = { ...s.hands };
  for (const id of Object.keys(s.fills)) {
    hands[id] = dealHand(s.pool, s.settings.handSize, ctx.random, hands[id] ?? []);
  }
  if (s.index + 1 < s.rounds.length) return openFill({ ...s, hands, index: s.index + 1 }, ctx);
  return finish({ ...s, hands }, ctx);
}

function finish(s: PhrasesState, ctx: GameContext): PhrasesState {
  clearTimers(ctx);
  return { ...s, phase: 'final' };
}

/* ---------------------------------------------------------------- vues */

function topicsView(s: PhrasesState) {
  if (!s.topics) return null;
  const t = s.topics;
  const current = turnPlayer(t);
  return {
    endsAt: t.endsAt,
    turnMs: s.settings.topicSeconds * 1000,
    current: current !== null ? (s.players[current] ?? null) : null,
    turns: t.order.map((id, i) => ({
      name: s.players[id] ?? '?',
      keywords: t.entries[id] ?? [],
      state: i < t.turn ? 'done' : i === t.turn ? 'current' : 'waiting',
    })),
  };
}

function nameOf(s: PhrasesState, id: string): string {
  return s.players[id] ?? '?';
}

function publicView(s: PhrasesState) {
  const base = {
    phase: s.phase,
    index: s.index,
    total: s.rounds.length || s.settings.rounds,
    playerCount: Object.keys(s.players).length,
    ranking: rankPlayers(s),
    notice: s.notice,
    topics: topicsView(s),
  };

  if (s.phase === 'topics') return { ...base, endsAt: s.topics?.endsAt ?? 0 };
  if (s.phase === 'ready' || s.phase === 'generating' || s.phase === 'final') return { ...base, endsAt: 0 };

  const round = s.rounds[s.index];
  if (!round) return { ...base, endsAt: 0 };
  const sentence = round.sentence;

  if (s.phase === 'fill') {
    return {
      ...base,
      sentence,
      endsAt: s.endsAt,
      limitMs: s.settings.fillSeconds * 1000,
      played: Object.keys(s.fills).map((id) => nameOf(s, id)),
      waiting: Object.keys(s.players)
        .filter((id) => !(id in s.fills))
        .map((id) => nameOf(s, id)),
    };
  }

  if (s.phase === 'vote') {
    return {
      ...base,
      sentence,
      endsAt: s.endsAt,
      limitMs: s.settings.voteSeconds * 1000,
      // Anonyme : seuls le texte complété et le nombre de votes sont visibles.
      options: s.options.map((id) => ({ text: fillSentence(sentence, s.fills[id] ?? '') })),
      voted: Object.keys(s.votes).length,
      voters: Object.keys(s.players).length,
      pending: Object.keys(s.players)
        .filter((id) => !(id in s.votes))
        .map((id) => nameOf(s, id)),
    };
  }

  // Révélation : auteurs, votes, réponse attendue et points.
  return {
    ...base,
    sentence,
    answer: round.answer,
    endsAt: s.endsAt,
    options: s.options.map((id) => {
      const gain = s.gains[id];
      return {
        text: fillSentence(sentence, s.fills[id] ?? ''),
        card: s.fills[id] ?? '',
        author: nameOf(s, id),
        auto: s.auto[id] ?? false,
        votes: gain?.votes ?? 0,
        points: gain?.points ?? 0,
        correct: gain?.correct ?? false,
      };
    }),
  };
}

/* ---------------------------------------------------------------- module */

export const phrasesTrous: GameModule<PhrasesState, PhrasesSettings> = {
  manifest: {
    id: 'phrases-trous',
    name: 'Phrases à trous',
    description:
      'Remplissez le trou de la phrase avec la carte la plus drôle ou la plus juste, puis votez pour la meilleure. Les mots-clés de chacun servent de thème.',
    icon: '🧩',
    category: 'quiz',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 8,
    durationMin: 12,
    notice: {
      goal: 'Compléter chaque phrase avec la carte la plus drôle ou la plus juste, puis gagner les votes du public.',
      steps: [
        'Chacun propose à son tour quelques mots-clés : l’IA écrit les phrases à partir de ces thèmes.',
        'À chaque tour, posez une carte de votre main dans le trou de la phrase.',
        'Votez pour la phrase la plus drôle, sans savoir qui l’a écrite : chaque vote rapporte 100 points à son auteur.',
        'Une carte qui complète juste le trou rapporte 50 points de plus.',
        'Après le dernier tour, le joueur qui a le plus de points gagne.',
      ],
      tips: [
        'Vous ne pouvez pas voter pour votre propre phrase.',
        'Sans IA configurée, le jeu reprend ses phrases intégrées et le dit à l’écran.',
        'Le nombre de tours, la taille de la main et les temps se règlent dans le salon.',
      ],
    },
  },

  settingsSchema: phrasesSettingsSchema,
  defaultSettings: phrasesSettingsSchema.parse({}),

  actions: {
    keywords: keywordsPayloadSchema,
    play: playSchema,
    vote: voteSchema,
  },

  initialize(settings, players) {
    return {
      phase: 'ready',
      settings: phrasesSettingsSchema.parse(settings),
      players: Object.fromEntries(players.map((p) => [p.id, p.name])),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      topics: null,
      jobId: null,
      notice: null,
      rounds: [],
      pool: [],
      hands: {},
      index: 0,
      endsAt: 0,
      fills: {},
      auto: {},
      options: [],
      votes: {},
      gains: {},
    };
  },

  onPlayerJoin(s: PhrasesState, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return {
      ...s,
      players: { ...s.players, [p.id]: p.name },
      points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
    };
  },

  onPlayerLeave(s: PhrasesState, p: PlayerRef, ctx: GameContext) {
    // Son tour de parole passe tout de suite, sans attendre le minuteur.
    if (s.phase === 'topics' && s.topics && turnPlayer(s.topics) === p.id) {
      const connected = ctx.connectedPlayerIds().filter((id) => id !== p.id);
      return afterTopicTurn(s, passTurn(s.topics, ctx.now(), s.settings.topicSeconds, connected), ctx);
    }
    if (s.phase !== 'ready') return s;
    const players = { ...s.players };
    const points = { ...s.points };
    delete players[p.id];
    delete points[p.id];
    return { ...s, players, points };
  },

  start(s: PhrasesState, ctx: GameContext) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (Object.keys(s.players).length < 2) return fail('Il faut au moins deux joueurs');
    return ok(openTopics(s, ctx));
  },

  handleAction(s: PhrasesState, p: PlayerRef, type, payload, ctx: GameContext) {
    if (type === 'keywords') return handleKeywords(s, p, payload, ctx);
    if (type === 'play') return handlePlay(s, p, payload, ctx);
    if (type === 'vote') return handleVote(s, p, payload, ctx);
    return fail('Action inconnue');
  },

  onTimer(s: PhrasesState, key: string, ctx: GameContext) {
    if (key === TOPIC_TIMEOUT && s.phase === 'topics' && s.topics) {
      return afterTopicTurn(s, passTurn(s.topics, ctx.now(), s.settings.topicSeconds, ctx.connectedPlayerIds()), ctx);
    }
    if (key === FILL_TIMEOUT && s.phase === 'fill') return closeFill(autoFill(s, ctx), ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s: PhrasesState, ctx: GameContext) {
    if (s.phase === 'topics' && s.topics) {
      return afterTopicTurn(s, passTurn(s.topics, ctx.now(), s.settings.topicSeconds, ctx.connectedPlayerIds()), ctx);
    }
    if (s.phase === 'fill') return closeFill(autoFill(s, ctx), ctx);
    if (s.phase === 'vote') return reveal(s, ctx);
    if (s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  // Travail demandé à l'IA : les thèmes des joueurs et le nombre de tours.
  pendingJob(s: PhrasesState) {
    if (s.phase !== 'generating' || !s.topics || !s.jobId) return null;
    const input: PhrasesThemesInput = {
      themes: keywordThemes(s.topics, s.players).map(({ name, keywords }) => ({ name, keywords })),
      rounds: s.settings.rounds,
    };
    return { id: s.jobId, kind: PHRASES_JOB_KIND, input };
  },

  runJob: runPhrasesJob,

  completeJob(s: PhrasesState, jobId: string, outcome: JobOutcome, ctx: GameContext) {
    if (s.phase !== 'generating' || s.jobId !== jobId) return s;
    const generated = outcome.ok ? (outcome.value as PhraseContent | null) : null;
    if (generated && generated.rounds.length > 0) return startGame({ ...s, notice: null }, generated, ctx);
    // Pas d'IA configurée, ou réponse inutilisable : le jeu reprend ses phrases intégrées, sans bloquer la salle.
    const notice =
      outcome.ok && outcome.value === null
        ? 'IA non configurée : phrases intégrées.'
        : 'L’IA n’a pas pu écrire les phrases : phrases intégrées.';
    return startGame({ ...s, notice }, curatedContent(s.settings.rounds, ctx.random), ctx);
  },

  calculateScores(s: PhrasesState) {
    return rankPlayers(s);
  },

  end(s: PhrasesState, ctx: GameContext) {
    return finish(s, ctx);
  },

  getPublicState(s: PhrasesState) {
    return publicView(s);
  },

  getPlayerState(s: PhrasesState, playerId: string) {
    const g = s.gains[playerId];
    const rank = rankPlayers(s).find((e) => e.playerId === playerId)?.rank ?? null;
    const ownOption = s.options.indexOf(playerId);
    return {
      points: s.points[playerId] ?? 0,
      rank,
      // La main n'est visible que pendant la pose : elle ne sert à rien ensuite.
      hand: s.phase === 'fill' ? (s.hands[playerId] ?? []) : [],
      played: s.fills[playerId] ?? null,
      myVote: s.votes[playerId] ?? null,
      ownOption: ownOption >= 0 ? ownOption : null,
      myTurn: s.phase === 'topics' && s.topics !== null && turnPlayer(s.topics) === playerId,
      auto: s.auto[playerId] ?? false,
      gained: g ? g.points : null,
      correct: g ? g.correct : null,
      votesReceived: g ? g.votes : null,
    };
  },

  getHostState(s: PhrasesState) {
    if (s.phase === 'topics' && s.topics) {
      const id = turnPlayer(s.topics);
      return { pending: id ? [nameOf(s, id)] : [] };
    }
    if (s.phase === 'fill') {
      return {
        pending: Object.keys(s.players)
          .filter((id) => !(id in s.fills))
          .map((id) => nameOf(s, id)),
      };
    }
    if (s.phase === 'vote') {
      return {
        pending: Object.keys(s.players)
          .filter((id) => !(id in s.votes))
          .map((id) => nameOf(s, id)),
      };
    }
    return { pending: [] };
  },

  isFinished(s: PhrasesState) {
    return s.phase === 'final';
  },

  suggest(s: PhrasesState, playerId: string, random: () => number) {
    if (s.phase === 'topics' && s.topics && turnPlayer(s.topics) === playerId) {
      const words = BOT_KEYWORDS[Math.floor(random() * BOT_KEYWORDS.length)] ?? BOT_KEYWORDS[0]!;
      return { type: 'keywords', payload: { words }, key: `topic-${s.topics.turn}` };
    }
    const hand = s.hands[playerId] ?? [];
    if (s.phase === 'fill' && !(playerId in s.fills) && hand.length > 0) {
      const card = hand[Math.floor(random() * hand.length)]!;
      return { type: 'play', payload: { card }, key: `fill-${s.index}` };
    }
    if (s.phase === 'vote' && playerId in s.players && !(playerId in s.votes)) {
      const choices = s.options.map((id, i) => (id === playerId ? -1 : i)).filter((i) => i >= 0);
      if (choices.length === 0) return null;
      const option = choices[Math.floor(random() * choices.length)]!;
      return { type: 'vote', payload: { option }, key: `vote-${s.index}` };
    }
    return null;
  },
};

/** Saisie d'un tour de parole : seul le joueur dont c'est le tour peut la proposer. */
function handleKeywords(s: PhrasesState, p: PlayerRef, payload: unknown, ctx: GameContext): GameResult<PhrasesState> {
  if (s.phase !== 'topics' || !s.topics) return fail('Aucun mot-clé attendu pour le moment');
  if (turnPlayer(s.topics) !== p.id) return fail('Ce n’est pas votre tour');
  const parsed = keywordsPayloadSchema.safeParse(payload);
  if (!parsed.success) return fail('Saisie invalide');
  const words = parseKeywords(parsed.data.words);
  if (words.length === 0) return fail('Indiquez au moins un mot-clé');
  const topics = submitKeywords(s.topics, words, ctx.now(), s.settings.topicSeconds, ctx.connectedPlayerIds());
  return ok(afterTopicTurn(s, topics, ctx));
}

function handlePlay(s: PhrasesState, p: PlayerRef, payload: unknown, ctx: GameContext): GameResult<PhrasesState> {
  if (s.phase !== 'fill') return fail('Aucune carte à poser pour le moment');
  if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
  if (p.id in s.fills) return fail('Carte déjà posée');
  const parsed = playSchema.safeParse(payload);
  if (!parsed.success) return fail('Carte invalide');
  const hand = s.hands[p.id] ?? [];
  const { card } = parsed.data;
  if (!hand.includes(card)) return fail('Cette carte n’est pas dans votre main');
  const next: PhrasesState = {
    ...s,
    fills: { ...s.fills, [p.id]: card },
    hands: { ...s.hands, [p.id]: removeCard(hand, card) },
  };
  const everyone = everyConnectedDone(ctx, Object.keys(s.players), (id) => id in next.fills);
  return ok(everyone ? closeFill(next, ctx) : next);
}

/** Tout joueur de la partie vote, même sans carte posée (un joueur revenu après la pose, par exemple). */
function handleVote(s: PhrasesState, p: PlayerRef, payload: unknown, ctx: GameContext): GameResult<PhrasesState> {
  if (s.phase !== 'vote') return fail('Pas de vote en cours');
  if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
  if (p.id in s.votes) return fail('Vote déjà envoyé');
  const parsed = voteSchema.safeParse(payload);
  if (!parsed.success) return fail('Choix invalide');
  const { option } = parsed.data;
  if (option >= s.options.length) return fail('Choix invalide');
  if (s.options[option] === p.id) return fail('Vous ne pouvez pas voter pour votre propre phrase');
  const next: PhrasesState = { ...s, votes: { ...s.votes, [p.id]: option } };
  const everyone = everyConnectedDone(ctx, Object.keys(s.players), (id) => id in next.votes);
  return ok(everyone ? reveal(next, ctx) : next);
}
