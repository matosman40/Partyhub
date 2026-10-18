import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, normalizeText, ok, rankEntries, shuffle } from '../common/engine.js';
import rawWords from '../imposteur/content.fr.json' with { type: 'json' };
import {
  CLUE_MAX_LENGTH,
  GUESS_MAX_LENGTH,
  IMPOSTEUR_AMBIANCES,
  IMPOSTEUR_MODES,
  IMPOSTEUR_MODE_INFO,
  type ImposteurMode,
} from './info.js';

/**
 * L’imposteur parmi nous : chaque manche, un joueur tiré au sort, l’imposteur, ne reçoit pas le mot de l’équipe.
 * Selon le mode, il reçoit un mot proche (espion), un mot d’une autre catégorie (intrus), seulement la catégorie
 * (mot interdit), ou rien du tout (rôle secret). Chacun dit une phrase, puis tout le monde vote pour démasquer
 * l’imposteur. L’imposteur gagne s’il survit au vote, ou s’il devine le mot après avoir été démasqué.
 *
 * Mode « mot interdit » : le mot secret ne doit jamais apparaître dans une phrase, et le serveur le refuse.
 */

const contentSchema = z
  .array(z.object({ category: z.string().min(1), words: z.array(z.string().min(1)).min(2) }))
  .min(1);
const CATEGORIES = contentSchema.parse(rawWords);

export const imposteurPartageSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(6).default(3),
  clueSeconds: z.number().int().min(20).max(120).default(60),
  mode: z.enum(IMPOSTEUR_AMBIANCES).default('melange'),
});

export type ImposteurPartageSettings = z.infer<typeof imposteurPartageSettingsSchema>;

const ROLE_SECONDS = 25;
const VOTE_SECONDS = 30;
const GUESS_SECONDS = 25;
const REVEAL_MS = 10000;
const IMPOSTOR_WIN_POINTS = 300;
const IMPOSTOR_GUESS_POINTS = 150;
const CREW_POINTS = 100;

const ROLE_TIMEOUT = 'role-timeout';
const CLUE_TIMEOUT = 'clue-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const GUESS_TIMEOUT = 'guess-timeout';
const REVEAL_NEXT = 'reveal-next';

const ackSchema = z.object({});
const clueSchema = z.object({ text: z.string().trim().min(1).max(CLUE_MAX_LENGTH) });
const voteSchema = z.object({ target: z.string().min(1).max(64) });
const guessSchema = z.object({ text: z.string().trim().min(1).max(GUESS_MAX_LENGTH) });

export type ImposteurPartagePhase = 'ready' | 'role' | 'clue' | 'vote' | 'guess' | 'result' | 'final';
export type ImposteurOutcome = 'imposteur' | 'equipe';

/** Ce que l’imposteur sait de la manche : un mot, une catégorie, ou rien. */
export interface ImposteurView {
  kind: 'word' | 'category' | 'none';
  value: string | null;
}

export interface ImposteurRound {
  mode: ImposteurMode;
  category: string;
  word: string;
  impostor: string;
  impostorView: ImposteurView;
}

export interface ImposteurPartageState {
  phase: ImposteurPartagePhase;
  settings: ImposteurPartageSettings;
  rounds: ImposteurRound[];
  round: number;
  /** Ordre de jeu : les joueurs dans l’ordre où ils ont rejoint la salle. */
  order: string[];
  players: Record<string, string>;
  points: Record<string, number>;
  /** Joueurs qui ont lu leur rôle. */
  acks: string[];
  /** auteur -> phrase dite pendant la manche. */
  clues: Record<string, string>;
  /** votant -> joueur désigné comme imposteur. */
  votes: Record<string, string>;
  /** Joueur démasqué, ou null si personne (égalité ou aucun vote). */
  ejected: string | null;
  /** Tentative de l’imposteur démasqué. */
  guess: string | null;
  outcome: ImposteurOutcome | null;
  gains: Record<string, number>;
  endsAt: number;
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

/** Vue de l’imposteur selon le mode : un mot proche, un mot d’une autre catégorie, la catégorie, ou rien. */
function viewFor(mode: ImposteurMode, category: string, word: string, random: () => number): ImposteurView {
  switch (mode) {
    case 'espion': {
      const same = CATEGORIES.find((c) => c.category === category)?.words.filter((w) => w !== word) ?? [];
      return { kind: 'word', value: same.length > 0 ? pick(same, random) : null };
    }
    case 'intrus': {
      const others = CATEGORIES.filter((c) => c.category !== category).flatMap((c) => c.words);
      return { kind: 'word', value: others.length > 0 ? pick(others, random) : null };
    }
    case 'mot-interdit':
      return { kind: 'category', value: category };
    case 'role-secret':
      return { kind: 'none', value: null };
  }
}

/** Tire les manches : un mot, un mode et un imposteur par manche. L’imposteur tourne entre les joueurs. */
export function buildRounds(
  settings: ImposteurPartageSettings,
  order: string[],
  random: () => number,
): ImposteurRound[] {
  const modes = shuffle(IMPOSTEUR_MODES, random);
  const words = shuffle(
    CATEGORIES.flatMap((c) => c.words.map((word) => ({ category: c.category, word }))),
    random,
  );
  const impostors = shuffle(order, random);
  return Array.from({ length: settings.rounds }, (_, i) => {
    const entry = words[i % words.length]!;
    const mode: ImposteurMode = settings.mode === 'melange' ? modes[i % modes.length]! : settings.mode;
    return {
      mode,
      category: entry.category,
      word: entry.word,
      impostor: impostors[i % impostors.length]!,
      impostorView: viewFor(mode, entry.category, entry.word, random),
    };
  });
}

/** Vrai quand la phrase contient le mot secret, à la casse et aux accents près, comme un mot entier. */
export function containsWord(text: string, word: string): boolean {
  return ` ${normalizeText(text)} `.includes(` ${normalizeText(word)} `);
}

function clearRoundTimers(ctx: GameContext): void {
  ctx.cancel(ROLE_TIMEOUT);
  ctx.cancel(CLUE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(GUESS_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
}

function openRole(s: ImposteurPartageState, ctx: GameContext): ImposteurPartageState {
  clearRoundTimers(ctx);
  const ms = ROLE_SECONDS * 1000;
  ctx.schedule(ROLE_TIMEOUT, ms);
  return {
    ...s,
    phase: 'role',
    acks: [],
    clues: {},
    votes: {},
    ejected: null,
    guess: null,
    outcome: null,
    gains: {},
    endsAt: ctx.now() + ms,
  };
}

function openClue(s: ImposteurPartageState, ctx: GameContext): ImposteurPartageState {
  ctx.cancel(ROLE_TIMEOUT);
  const ms = s.settings.clueSeconds * 1000;
  ctx.schedule(CLUE_TIMEOUT, ms);
  return { ...s, phase: 'clue', endsAt: ctx.now() + ms };
}

function openVote(s: ImposteurPartageState, ctx: GameContext): ImposteurPartageState {
  ctx.cancel(CLUE_TIMEOUT);
  const ms = VOTE_SECONDS * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', votes: {}, endsAt: ctx.now() + ms };
}

/** Compte les votes et désigne le démasqué : seulement en cas de majorité nette (pas d’égalité au sommet). */
function tally(s: ImposteurPartageState): string | null {
  const counts: Record<string, number> = {};
  for (const target of Object.values(s.votes)) counts[target] = (counts[target] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  if (max === 0) return null;
  const leaders = Object.keys(counts).filter((id) => counts[id] === max);
  return leaders.length === 1 ? leaders[0]! : null;
}

function resolveVote(s: ImposteurPartageState, ctx: GameContext): ImposteurPartageState {
  ctx.cancel(VOTE_TIMEOUT);
  const ejected = tally(s);
  const impostor = s.rounds[s.round]?.impostor;
  // Démasqué : l’imposteur a encore une chance de deviner le mot. Sinon, il survit et gagne.
  if (ejected !== null && ejected === impostor) return openGuess({ ...s, ejected }, ctx);
  return settle({ ...s, ejected }, ctx, 'imposteur', { [impostor ?? '']: IMPOSTOR_WIN_POINTS });
}

function openGuess(s: ImposteurPartageState, ctx: GameContext): ImposteurPartageState {
  ctx.cancel(VOTE_TIMEOUT);
  const ms = GUESS_SECONDS * 1000;
  ctx.schedule(GUESS_TIMEOUT, ms);
  return { ...s, phase: 'guess', guess: null, endsAt: ctx.now() + ms };
}

/**
 * Règle la manche : les points gagnés sont ajoutés au total, puis le bilan reste affiché le temps de le lire.
 * `gains` ne contient que les gains de cette manche.
 */
function settle(
  s: ImposteurPartageState,
  ctx: GameContext,
  outcome: ImposteurOutcome,
  gains: Record<string, number>,
): ImposteurPartageState {
  clearRoundTimers(ctx);
  const points = { ...s.points };
  for (const [id, gained] of Object.entries(gains)) {
    if (!id) continue;
    points[id] = (points[id] ?? 0) + gained;
  }
  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return {
    ...s,
    phase: 'result',
    outcome,
    points,
    gains: Object.fromEntries(Object.entries(gains).filter(([id]) => id)),
    endsAt: ctx.now() + REVEAL_MS,
  };
}

/** Tentative de l’imposteur démasqué : juste, il gagne ; fausse, l’équipe gagne. */
function resolveGuess(s: ImposteurPartageState, ctx: GameContext, guess: string | null): ImposteurPartageState {
  const round = s.rounds[s.round]!;
  const guessed = guess !== null && normalizeText(guess) === normalizeText(round.word);
  const next = { ...s, guess };
  if (guessed) {
    return settle(next, ctx, 'imposteur', { [round.impostor]: IMPOSTOR_GUESS_POINTS });
  }
  const crew = s.order.filter((id) => id !== round.impostor);
  return settle(next, ctx, 'equipe', Object.fromEntries(crew.map((id) => [id, CREW_POINTS])));
}

function advance(s: ImposteurPartageState, ctx: GameContext): ImposteurPartageState {
  ctx.cancel(REVEAL_NEXT);
  if (s.round + 1 < s.rounds.length) {
    return openRole({ ...s, round: s.round + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: ImposteurPartageState, ctx: GameContext): ImposteurPartageState {
  clearRoundTimers(ctx);
  return { ...s, phase: 'final' };
}

const BOT_CLUES = [
  'Ça se trouve souvent en ville.',
  'Je pense à quelque chose de rond.',
  'Ça fait sourire les enfants.',
  'Ça dépend beaucoup de la saison.',
  'On peut en parler des heures.',
];

const BOT_GUESSES = ['Girafe', 'Pompier', 'Plage', 'Parapluie', 'Titanic'];

export const imposteurParmiNous: GameModule<ImposteurPartageState, ImposteurPartageSettings> = {
  manifest: {
    id: 'imposteur-parmi-nous',
    category: 'role',
    name: 'L’imposteur parmi nous',
    description: 'Un imposteur ignore le mot secret. Dites une phrase sans vous trahir, puis démasquez-le.',
    icon: '🫣',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 3,
    maxPlayers: 10,
    durationMin: 15,
    notice: {
      goal: 'Démasquer l’imposteur, ou, pour l’imposteur, survivre au vote ou deviner le mot.',
      steps: [
        'Regardez votre téléphone : vous connaissez le mot de l’équipe, ou vous êtes l’imposteur.',
        'Dites une phrase qui ne trahit pas le mot. Tapez-la sur votre téléphone (80 caractères maximum).',
        'Votez pour celui que vous soupçonnez, sans voter pour vous-même.',
        'L’imposteur gagne s’il survit au vote, ou s’il devine le mot après avoir été démasqué.',
      ],
      tips: [
        'En mode « Mot interdit », personne ne peut prononcer le mot secret.',
        'Sans majorité nette au vote, personne n’est démasqué.',
      ],
    },
  },

  settingsSchema: imposteurPartageSettingsSchema,
  defaultSettings: imposteurPartageSettingsSchema.parse({}),

  actions: {
    ack: ackSchema,
    clue: clueSchema,
    vote: voteSchema,
    guess: guessSchema,
  },

  // Les manches sont tirées au lancement, quand la liste des joueurs est fixée (voir start).
  initialize(settings, players) {
    const parsed = imposteurPartageSettingsSchema.parse(settings);
    const order = players.map((p) => p.id);
    return {
      phase: 'ready',
      settings: parsed,
      rounds: [],
      round: 0,
      order,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      acks: [],
      clues: {},
      votes: {},
      ejected: null,
      guess: null,
      outcome: null,
      gains: {},
      endsAt: 0,
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return {
      ...s,
      order: [...s.order, p.id],
      players: { ...s.players, [p.id]: p.name },
      points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
    };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    const players = { ...s.players };
    const points = { ...s.points };
    delete players[p.id];
    delete points[p.id];
    return { ...s, order: s.order.filter((id) => id !== p.id), players, points };
  },

  start(s, ctx) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (s.order.length < 3) return fail('Il faut au moins trois joueurs');
    const rounds = buildRounds(s.settings, s.order, ctx.random);
    return ok(openRole({ ...s, rounds }, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    const round = s.rounds[s.round];
    if (!round) return fail('Pas de manche en cours');

    if (type === 'ack') {
      if (s.phase !== 'role') return fail('Pas de rôle à lire maintenant');
      if (s.acks.includes(p.id)) return fail('Rôle déjà lu');
      const next = { ...s, acks: [...s.acks, p.id] };
      const done = everyConnectedDone(ctx, s.order, (id) => next.acks.includes(id));
      return ok(done ? openClue(next, ctx) : next);
    }

    if (type === 'clue') {
      if (s.phase !== 'clue') return fail('Les phrases ne sont pas attendues maintenant');
      if (p.id in s.clues) return fail('Phrase déjà envoyée');
      const parsed = clueSchema.safeParse(payload);
      if (!parsed.success) return fail('Phrase invalide');
      if (round.mode === 'mot-interdit' && containsWord(parsed.data.text, round.word)) {
        return fail('Ce mot est interdit cette fois-ci. Dites-le autrement.');
      }
      const next = { ...s, clues: { ...s.clues, [p.id]: parsed.data.text } };
      const done = everyConnectedDone(ctx, s.order, (id) => id in next.clues);
      return ok(done ? openVote(next, ctx) : next);
    }

    if (type === 'vote') {
      if (s.phase !== 'vote') return fail('Pas de vote en cours');
      if (p.id in s.votes) return fail('Vote déjà enregistré');
      const parsed = voteSchema.safeParse(payload);
      if (!parsed.success) return fail('Vote invalide');
      const { target } = parsed.data;
      if (!s.order.includes(target)) return fail('Choix invalide');
      if (target === p.id) return fail('Vous ne pouvez pas vous désigner');
      const next = { ...s, votes: { ...s.votes, [p.id]: target } };
      const done = everyConnectedDone(ctx, s.order, (id) => id in next.votes);
      return ok(done ? resolveVote(next, ctx) : next);
    }

    if (type === 'guess') {
      if (s.phase !== 'guess') return fail('Pas de tentative attendue');
      if (p.id !== round.impostor) return fail('Seul l’imposteur peut deviner le mot');
      if (s.guess !== null) return fail('Tentative déjà envoyée');
      const parsed = guessSchema.safeParse(payload);
      if (!parsed.success) return fail('Mot invalide');
      return ok(resolveGuess(s, ctx, parsed.data.text));
    }

    return fail('Action inconnue');
  },

  onTimer(s, key, ctx) {
    if (key === ROLE_TIMEOUT && s.phase === 'role') return openClue(s, ctx);
    if (key === CLUE_TIMEOUT && s.phase === 'clue') return openVote(s, ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return resolveVote(s, ctx);
    if (key === GUESS_TIMEOUT && s.phase === 'guess') return resolveGuess(s, ctx, null);
    if (key === REVEAL_NEXT && s.phase === 'result') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'role') return openClue(s, ctx);
    if (s.phase === 'clue') return openVote(s, ctx);
    if (s.phase === 'vote') return resolveVote(s, ctx);
    if (s.phase === 'guess') return resolveGuess(s, ctx, null);
    if (s.phase === 'result') return advance(s, ctx);
    return s;
  },

  calculateScores(s) {
    return rankEntries(s.players, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  getPublicState(s) {
    const base = {
      phase: s.phase,
      round: s.round,
      total: s.settings.rounds,
      playerCount: s.order.length,
      ranking: rankEntries(s.players, s.points),
    };

    if (s.phase === 'ready' || s.phase === 'final') {
      return { ...base, mode: null, modeLabel: null, modeHint: null, category: null };
    }

    const round = s.rounds[s.round]!;
    const info = IMPOSTEUR_MODE_INFO[round.mode];
    const common = {
      ...base,
      mode: round.mode,
      modeLabel: info.label,
      modeHint: info.hint,
      category: round.category,
      endsAt: s.endsAt,
    };

    // Les phrases n’apparaissent qu’à partir du vote, avec leurs auteurs : on vote contre une personne.
    const clues = s.order.map((id) => ({ id, name: s.players[id] ?? '?', text: s.clues[id] ?? '…' }));

    if (s.phase === 'role') {
      return { ...common, durationMs: ROLE_SECONDS * 1000, ackCount: s.acks.length };
    }
    if (s.phase === 'clue') {
      return {
        ...common,
        durationMs: s.settings.clueSeconds * 1000,
        clueCount: Object.keys(s.clues).length,
      };
    }
    if (s.phase === 'vote') {
      return {
        ...common,
        durationMs: VOTE_SECONDS * 1000,
        clues,
        voteCount: Object.keys(s.votes).length,
      };
    }
    if (s.phase === 'guess') {
      return {
        ...common,
        durationMs: GUESS_SECONDS * 1000,
        clues,
        ejectedName: s.ejected ? (s.players[s.ejected] ?? '?') : null,
      };
    }

    // result : rôle, mot et votes deviennent publics.
    return {
      ...common,
      clues,
      word: round.word,
      impostorName: s.players[round.impostor] ?? '?',
      ejectedName: s.ejected ? (s.players[s.ejected] ?? '?') : null,
      guessText: s.guess,
      outcome: s.outcome,
      votes: Object.entries(s.votes).map(([voter, target]) => ({
        voter: s.players[voter] ?? '?',
        target: s.players[target] ?? '?',
      })),
      gains: Object.entries(s.gains).map(([id, points]) => ({ name: s.players[id] ?? '?', points })),
    };
  },

  getPlayerState(s, playerId) {
    const round = s.rounds[s.round];
    const isImpostor = round?.impostor === playerId;
    const seesRole = s.phase !== 'ready' && s.phase !== 'final' && round !== undefined;
    const role =
      seesRole && round
        ? {
            isImpostor,
            // L’imposteur ne voit que ce que son mode lui laisse. Les autres voient le mot et sa règle.
            view: isImpostor ? round.impostorView : null,
            word: isImpostor ? null : round.word,
            category: round.category,
            forbidden: !isImpostor && round.mode === 'mot-interdit' ? round.word : null,
          }
        : null;
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      role,
      myClue: s.clues[playerId] ?? null,
      myVote: s.votes[playerId] ?? null,
      answered:
        s.phase === 'role'
          ? s.acks.includes(playerId)
          : s.phase === 'clue'
            ? playerId in s.clues
            : s.phase === 'vote'
              ? playerId in s.votes
              : s.phase === 'guess'
                ? !isImpostor || s.guess !== null
                : false,
      canGuess: s.phase === 'guess' && isImpostor && s.guess === null,
      gained: s.phase === 'result' ? (s.gains[playerId] ?? 0) : null,
      outcome: s.phase === 'result' ? s.outcome : null,
      wasImpostor: s.phase === 'result' ? isImpostor : null,
    };
  },

  getHostState(s) {
    const pendingIds =
      s.phase === 'role'
        ? s.order.filter((id) => !s.acks.includes(id))
        : s.phase === 'clue'
          ? s.order.filter((id) => !(id in s.clues))
          : s.phase === 'vote'
            ? s.order.filter((id) => !(id in s.votes))
            : s.phase === 'guess' && s.rounds[s.round]
              ? s.guess === null
                ? [s.rounds[s.round]!.impostor]
                : []
              : [];
    return { pending: pendingIds.map((id) => s.players[id] ?? '?') };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    const round = s.rounds[s.round];
    if (!round) return null;
    if (s.phase === 'role' && !s.acks.includes(playerId)) {
      return { type: 'ack', payload: {}, key: `a${s.round}` };
    }
    if (s.phase === 'clue' && !(playerId in s.clues)) {
      const text = pick(BOT_CLUES, random);
      return { type: 'clue', payload: { text }, key: `c${s.round}` };
    }
    if (s.phase === 'vote' && !(playerId in s.votes)) {
      const choices = s.order.filter((id) => id !== playerId);
      if (choices.length === 0) return null;
      return { type: 'vote', payload: { target: pick(choices, random) }, key: `v${s.round}` };
    }
    if (s.phase === 'guess' && playerId === round.impostor && s.guess === null) {
      return { type: 'guess', payload: { text: pick(BOT_GUESSES, random) }, key: `g${s.round}` };
    }
    return null;
  },
};
