import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import rawPrompts from './prompts.fr.json' with { type: 'json' };

/**
 * Association express : chacun écrit le premier mot qui lui vient à l’esprit
 * pour un mot donné, puis tout le monde vote (anonymement) pour le plus drôle.
 * Chaque vote reçu rapporte des points à l’auteur du mot.
 */

const PROMPTS: string[] = z.array(z.string().min(1)).min(1).parse(rawPrompts);

export const associationSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(4),
  writeSeconds: z.number().int().min(10).max(120).default(40),
});

export type AssociationSettings = z.infer<typeof associationSettingsSchema>;

const VOTE_SECONDS = 25;
const VOTE_POINTS = 100;
const REVEAL_MS = 9000;

const WRITE_TIMEOUT = 'write-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const REVEAL_NEXT = 'reveal-next';

const wordSchema = z.object({ word: z.string().trim().min(1).max(24) });
const voteSchema = z.object({ option: z.number().int().min(0).max(19) });

export type AssociationPhase = 'ready' | 'write' | 'vote' | 'reveal' | 'final';

export interface AssociationState {
  phase: AssociationPhase;
  settings: AssociationSettings;
  prompts: string[];
  round: number;
  players: Record<string, string>;
  points: Record<string, number>;
  /** auteur -> mot proposé pendant la manche en cours. */
  words: Record<string, string>;
  /** Auteurs dans l’ordre d’affichage anonyme : seuls les mots sont montrés pendant le vote. */
  options: string[];
  /** votant -> index de l’option choisie. */
  votes: Record<string, number>;
  /** Points gagnés pendant la manche, révélés à la fin du vote. */
  gains: Record<string, number>;
  endsAt: number;
}

function clearRoundTimers(ctx: GameContext): void {
  ctx.cancel(WRITE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
}

function openWriting(s: AssociationState, ctx: GameContext): AssociationState {
  clearRoundTimers(ctx);
  const ms = s.settings.writeSeconds * 1000;
  ctx.schedule(WRITE_TIMEOUT, ms);
  return {
    ...s,
    phase: 'write',
    words: {},
    options: [],
    votes: {},
    gains: {},
    endsAt: ctx.now() + ms,
  };
}

function openVote(s: AssociationState, ctx: GameContext): AssociationState {
  ctx.cancel(WRITE_TIMEOUT);
  const options = shuffle(Object.keys(s.words), ctx.random);
  // Sans au moins deux mots, il n’y a rien à départager : on passe directement à la révélation.
  if (options.length < 2) return reveal({ ...s, options }, ctx);
  const ms = VOTE_SECONDS * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', options, votes: {}, endsAt: ctx.now() + ms };
}

function reveal(s: AssociationState, ctx: GameContext): AssociationState {
  ctx.cancel(WRITE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);

  const gains: Record<string, number> = {};
  for (const option of Object.values(s.votes)) {
    const author = s.options[option];
    if (author) gains[author] = (gains[author] ?? 0) + VOTE_POINTS;
  }

  const points = { ...s.points };
  for (const [id, gained] of Object.entries(gains)) {
    points[id] = (points[id] ?? 0) + gained;
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'reveal', points, gains, endsAt: ctx.now() + REVEAL_MS };
}

function advance(s: AssociationState, ctx: GameContext): AssociationState {
  ctx.cancel(REVEAL_NEXT);
  if (s.round + 1 < s.prompts.length) {
    return openWriting({ ...s, round: s.round + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: AssociationState, ctx: GameContext): AssociationState {
  clearRoundTimers(ctx);
  return { ...s, phase: 'final' };
}

const BOT_WORDS = ['Pizza', 'Fantôme', 'Chaussette', 'Tartiflette', 'Canard', 'Vacances', 'Brocoli', 'Licorne'];

/** Joueurs que la salle attend encore (mots ou votes). */
function pendingOf(s: AssociationState): string[] {
  const missing =
    s.phase === 'write'
      ? Object.keys(s.players).filter((id) => !(id in s.words))
      : s.phase === 'vote'
        ? Object.keys(s.players).filter((id) => !(id in s.votes))
        : [];
  return missing.map((id) => s.players[id] ?? '?');
}

export const association: GameModule<AssociationState, AssociationSettings> = {
  manifest: {
    id: 'association',
    category: 'quiz',
    name: 'Association express',
    description: 'Écrivez le premier mot qui vous vient, puis votez pour le plus drôle.',
    icon: '💭',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 12,
    durationMin: 12,
    notice: {
      goal: 'Trouver le mot le plus drôle pour une consigne, et recueillir des votes.',
      steps: [
        'Lisez le mot de la manche sur l’écran.',
        'Écrivez sur votre téléphone le premier mot qui vous vient (24 caractères maximum).',
        'Votez pour le mot le plus drôle, sans savoir qui l’a écrit.',
        'Chaque vote reçu rapporte 100 points à l’auteur du mot.',
      ],
      tips: ['Vous ne pouvez pas voter pour votre propre mot.', 'Il faut au moins deux mots pour passer au vote.'],
    },
  },

  settingsSchema: associationSettingsSchema,
  defaultSettings: associationSettingsSchema.parse({}),

  actions: {
    word: wordSchema,
    vote: voteSchema,
  },

  initialize(settings, players, ctx) {
    const parsed = associationSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      prompts: shuffle(PROMPTS, ctx.random).slice(0, parsed.rounds),
      round: 0,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      words: {},
      options: [],
      votes: {},
      gains: {},
      endsAt: 0,
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return {
      ...s,
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
    return { ...s, players, points };
  },

  start(s, ctx) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (s.prompts.length === 0) return fail('Aucun mot disponible');
    return ok(openWriting(s, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');

    if (type === 'word') {
      if (s.phase !== 'write') return fail('Les mots ne sont pas attendus maintenant');
      if (p.id in s.words) return fail('Mot déjà envoyé');
      const parsed = wordSchema.safeParse(payload);
      if (!parsed.success) return fail('Mot invalide');
      const next = { ...s, words: { ...s.words, [p.id]: parsed.data.word } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.words);
      return ok(done ? openVote(next, ctx) : next);
    }

    if (type === 'vote') {
      if (s.phase !== 'vote') return fail('Pas de vote en cours');
      if (p.id in s.votes) return fail('Vote déjà enregistré');
      const parsed = voteSchema.safeParse(payload);
      if (!parsed.success) return fail('Vote invalide');
      const { option } = parsed.data;
      if (option >= s.options.length) return fail('Choix invalide');
      if (s.options[option] === p.id) return fail('Vous ne pouvez pas voter pour votre propre mot');
      const next = { ...s, votes: { ...s.votes, [p.id]: option } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.votes);
      return ok(done ? reveal(next, ctx) : next);
    }

    return fail('Action inconnue');
  },

  onTimer(s, key, ctx) {
    if (key === WRITE_TIMEOUT && s.phase === 'write') return openVote(s, ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'write') return openVote(s, ctx);
    if (s.phase === 'vote') return reveal(s, ctx);
    if (s.phase === 'reveal') return advance(s, ctx);
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
      total: s.prompts.length,
      playerCount: Object.keys(s.players).length,
      ranking: rankEntries(s.players, s.points),
      pending: pendingOf(s),
    };

    if (s.phase === 'ready' || s.phase === 'final') {
      return { ...base, prompt: null };
    }

    const prompt = s.prompts[s.round] ?? null;

    if (s.phase === 'write') {
      return {
        ...base,
        prompt,
        endsAt: s.endsAt,
        durationMs: s.settings.writeSeconds * 1000,
        writtenCount: Object.keys(s.words).length,
      };
    }

    if (s.phase === 'vote') {
      return {
        ...base,
        prompt,
        endsAt: s.endsAt,
        durationMs: VOTE_SECONDS * 1000,
        // Anonymat : on montre les mots, jamais leurs auteurs.
        options: s.options.map((id) => s.words[id] ?? ''),
        voteCount: Object.keys(s.votes).length,
      };
    }

    // reveal : les auteurs et les votes deviennent publics.
    const results = s.options
      .map((id, i) => ({
        word: s.words[id] ?? '',
        author: s.players[id] ?? '?',
        votes: Object.values(s.votes).filter((v) => v === i).length,
        gained: s.gains[id] ?? 0,
      }))
      .sort((a, b) => b.votes - a.votes || a.author.localeCompare(b.author, 'fr'));

    return { ...base, prompt, endsAt: s.endsAt, results };
  },

  getPlayerState(s, playerId) {
    const myOption = s.options.indexOf(playerId);
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      myWord: s.words[playerId] ?? null,
      myOption: myOption >= 0 ? myOption : null,
      myVote: s.votes[playerId] ?? null,
      answered: s.phase === 'write' ? playerId in s.words : s.phase === 'vote' ? playerId in s.votes : false,
      gained: s.phase === 'reveal' ? (s.gains[playerId] ?? 0) : null,
    };
  },

  getHostState(s) {
    return { pending: pendingOf(s) };
  },

  isFinished(s) {
    return s.phase === 'final';
  },
  suggest(s, playerId, random) {
    if (s.phase === 'write' && !(playerId in s.words)) {
      const word = BOT_WORDS[Math.floor(random() * BOT_WORDS.length)]!;
      return { type: 'word', payload: { word }, key: `w${s.round}` };
    }
    if (s.phase === 'vote' && !(playerId in s.votes)) {
      const mine = s.options.indexOf(playerId);
      const choices = s.options.map((_, i) => i).filter((i) => i !== mine);
      const option = choices[Math.floor(random() * choices.length)];
      if (option === undefined) return null;
      return { type: 'vote', payload: { option }, key: `v${s.round}` };
    }
    return null;
  },
};
