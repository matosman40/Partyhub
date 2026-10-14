import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import {
  addPoints,
  directory,
  everyConnectedDone,
  fail,
  normalizeText,
  ok,
  rankEntries,
  shuffle,
} from '../common/engine.js';
import rawContent from './content.fr.json' with { type: 'json' };

/**
 * L'Imposteur : chaque manche, un joueur tiré au sort ne connaît pas le mot
 * secret (il ne voit que la catégorie). Chacun donne un indice, puis tout le
 * monde vote pour démasquer l'imposteur. Si l'imposteur est démasqué, il peut
 * tenter de deviner le mot pour marquer des points.
 */

const contentSchema = z
  .array(
    z.object({
      category: z.string().min(1),
      words: z.array(z.string().min(1)).min(2),
    }),
  )
  .min(1);

interface Secret {
  category: string;
  word: string;
}

const SECRETS: Secret[] = contentSchema
  .parse(rawContent)
  .flatMap((c) => c.words.map((word) => ({ category: c.category, word })));

export const imposteurSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(8).default(3),
});

export type ImposteurSettings = z.infer<typeof imposteurSettingsSchema>;

const CLUE_SECONDS = 60;
const VOTE_SECONDS = 30;
const GUESS_SECONDS = 25;
const REVEAL_MS = 10000;

const CREW_POINTS = 100;
const ESCAPE_POINTS = 300;
const GUESS_POINTS = 150;

const CLUE_TIMEOUT = 'clue-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const GUESS_TIMEOUT = 'guess-timeout';
const REVEAL_NEXT = 'reveal-next';

const clueSchema = z.object({ text: z.string().trim().min(1).max(24) });
const voteSchema = z.object({ target: z.string().min(1).max(64) });
const guessSchema = z.object({ word: z.string().trim().min(1).max(40) });

export type ImposteurPhase = 'ready' | 'clues' | 'vote' | 'guess' | 'reveal' | 'final';

export interface ImposteurState {
  phase: ImposteurPhase;
  settings: ImposteurSettings;
  secrets: Secret[];
  round: number;
  impostorId: string | null;
  players: Record<string, string>;
  points: Record<string, number>;
  /** joueur -> indice écrit pendant la manche (ordre d'arrivée conservé). */
  clues: Record<string, string>;
  /** votant -> joueur désigné comme imposteur. */
  votes: Record<string, string>;
  /** Joueur majoritairement désigné, ou null en cas d'égalité ou sans vote. */
  accused: string | null;
  guess: string | null;
  guessed: boolean;
  gains: Record<string, number>;
  endsAt: number;
}

function current(s: ImposteurState): Secret | undefined {
  return s.secrets[s.round];
}

function openClues(s: ImposteurState, ctx: GameContext): ImposteurState {
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(GUESS_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  const ids = Object.keys(s.players);
  const impostorId = ids[Math.floor(ctx.random() * ids.length)] ?? null;
  const ms = CLUE_SECONDS * 1000;
  ctx.schedule(CLUE_TIMEOUT, ms);
  return {
    ...s,
    phase: 'clues',
    impostorId,
    clues: {},
    votes: {},
    accused: null,
    guess: null,
    guessed: false,
    gains: {},
    endsAt: ctx.now() + ms,
  };
}

function openVote(s: ImposteurState, ctx: GameContext): ImposteurState {
  ctx.cancel(CLUE_TIMEOUT);
  const ms = VOTE_SECONDS * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', endsAt: ctx.now() + ms };
}

/** Clôture du vote : décide si l'imposteur est démasqué, puis passe à la suite. */
function resolveVote(s: ImposteurState, ctx: GameContext): ImposteurState {
  ctx.cancel(VOTE_TIMEOUT);
  const counts = new Map<string, number>();
  for (const target of Object.values(s.votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  const leaders = [...counts.entries()].filter(([, n]) => n === max).map(([id]) => id);
  const accused = max > 0 && leaders.length === 1 ? (leaders[0] ?? null) : null;
  const caught = accused !== null && accused === s.impostorId;

  const withAccused = { ...s, accused };
  const impostorConnected =
    s.impostorId !== null && ctx.connectedPlayerIds().includes(s.impostorId);

  if (caught && impostorConnected) {
    const ms = GUESS_SECONDS * 1000;
    ctx.schedule(GUESS_TIMEOUT, ms);
    return { ...withAccused, phase: 'guess', endsAt: ctx.now() + ms };
  }
  return reveal(withAccused, ctx);
}

function reveal(s: ImposteurState, ctx: GameContext): ImposteurState {
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(GUESS_TIMEOUT);

  const imp = s.impostorId;
  const caught = imp !== null && s.accused === imp;
  const gains: Record<string, number> = {};

  if (imp !== null) {
    if (caught) {
      for (const [voter, target] of Object.entries(s.votes)) {
        if (target === imp && voter !== imp) gains[voter] = CREW_POINTS;
      }
      if (s.guessed) gains[imp] = GUESS_POINTS;
    } else {
      gains[imp] = ESCAPE_POINTS;
    }
  }

  let points = s.points;
  for (const [id, gained] of Object.entries(gains)) {
    points = addPoints(points, id, gained);
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'reveal', points, gains, endsAt: ctx.now() + REVEAL_MS };
}

function advance(s: ImposteurState, ctx: GameContext): ImposteurState {
  ctx.cancel(REVEAL_NEXT);
  if (s.round + 1 < s.secrets.length) {
    return openClues({ ...s, round: s.round + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: ImposteurState, ctx: GameContext): ImposteurState {
  for (const key of [CLUE_TIMEOUT, VOTE_TIMEOUT, GUESS_TIMEOUT, REVEAL_NEXT]) ctx.cancel(key);
  return { ...s, phase: 'final' };
}

const BOT_CLUES = ['Rond', 'Ancien', 'Rapide', 'Sucré', 'Utile', 'Bruyant'];

export const imposteur: GameModule<ImposteurState, ImposteurSettings> = {
  manifest: {
    id: 'imposteur',
    category: 'role',
    name: "L'Imposteur",
    description: 'Un imposteur se cache parmi vous. Donnez des indices, puis démasquez-le.',
    icon: '🕵️',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 3,
    maxPlayers: 10,
    durationMin: 15,
    notice: {
      "goal": "Démasquer l'imposteur, qui ne connaît pas le mot secret.",
      "steps": [
        "Chacun reçoit son rôle sur son téléphone : le mot secret, ou « imposteur » avec la catégorie.",
        "Donnez un indice court, en 24 caractères maximum.",
        "Votez pour désigner l'imposteur.",
        "Si l'imposteur est démasqué, il peut tenter de deviner le mot secret."
      ],
      "tips": [
        "Si l'imposteur n'est pas démasqué, il gagne 300 points.",
        "Les membres de l'équipe gagnent 100 points chacun quand ils désignent le bon joueur."
      ]
    },
  },

  settingsSchema: imposteurSettingsSchema,
  defaultSettings: imposteurSettingsSchema.parse({}),

  actions: {
    clue: clueSchema,
    vote: voteSchema,
    guess: guessSchema,
  },

  initialize(settings, players, ctx) {
    const parsed = imposteurSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      secrets: shuffle(SECRETS, ctx.random).slice(0, parsed.rounds),
      round: 0,
      impostorId: null,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      clues: {},
      votes: {},
      accused: null,
      guess: null,
      guessed: false,
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
    if (s.secrets.length === 0) return fail('Aucun mot disponible');
    return ok(openClues(s, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');

    if (type === 'clue') {
      if (s.phase !== 'clues') return fail('Les indices ne sont pas attendus maintenant');
      if (p.id in s.clues) return fail('Indice déjà envoyé');
      const parsed = clueSchema.safeParse(payload);
      if (!parsed.success) return fail('Indice invalide');
      const next = { ...s, clues: { ...s.clues, [p.id]: parsed.data.text } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.clues);
      return ok(done ? openVote(next, ctx) : next);
    }

    if (type === 'vote') {
      if (s.phase !== 'vote') return fail('Pas de vote en cours');
      if (p.id in s.votes) return fail('Vote déjà enregistré');
      const parsed = voteSchema.safeParse(payload);
      if (!parsed.success) return fail('Vote invalide');
      const target = parsed.data.target;
      if (!(target in s.players)) return fail('Joueur inconnu');
      if (target === p.id) return fail('Vous ne pouvez pas vous désigner vous-même');
      const next = { ...s, votes: { ...s.votes, [p.id]: target } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.votes);
      return ok(done ? resolveVote(next, ctx) : next);
    }

    if (type === 'guess') {
      if (s.phase !== 'guess') return fail('Pas de tentative attendue');
      if (p.id !== s.impostorId) return fail('Seul l’imposteur peut deviner le mot');
      const parsed = guessSchema.safeParse(payload);
      if (!parsed.success) return fail('Proposition invalide');
      const secret = current(s);
      const guessed =
        secret !== undefined && normalizeText(parsed.data.word) === normalizeText(secret.word);
      return ok(reveal({ ...s, guess: parsed.data.word, guessed }, ctx));
    }

    return fail('Action inconnue');
  },

  onTimer(s, key, ctx) {
    if (key === CLUE_TIMEOUT && s.phase === 'clues') return openVote(s, ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return resolveVote(s, ctx);
    if (key === GUESS_TIMEOUT && s.phase === 'guess') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'clues') return openVote(s, ctx);
    if (s.phase === 'vote') return resolveVote(s, ctx);
    if (s.phase === 'guess') return reveal(s, ctx);
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
      total: s.secrets.length,
      ranking: rankEntries(s.players, s.points),
      candidates: Object.entries(s.players).map(([id, name]) => ({ id, name })),
    };

    if (s.phase === 'ready' || s.phase === 'final') {
      return { ...base, category: null, clues: [] };
    }

    const secret = current(s);
    // Indices publics : nom et texte, dans l'ordre d'arrivée.
    const clues = Object.entries(s.clues).map(([id, text]) => ({
      playerId: id,
      name: s.players[id] ?? '?',
      text,
    }));
    const category = secret?.category ?? null;

    if (s.phase === 'clues') {
      return {
        ...base,
        category,
        clues,
        endsAt: s.endsAt,
        durationMs: CLUE_SECONDS * 1000,
        clueCount: clues.length,
      };
    }

    if (s.phase === 'vote') {
      return {
        ...base,
        category,
        clues,
        endsAt: s.endsAt,
        durationMs: VOTE_SECONDS * 1000,
        voteCount: Object.keys(s.votes).length,
      };
    }

    const accusedName = s.accused ? (s.players[s.accused] ?? '?') : null;

    if (s.phase === 'guess') {
      return {
        ...base,
        category,
        clues,
        endsAt: s.endsAt,
        durationMs: GUESS_SECONDS * 1000,
        accusedName,
      };
    }

    // reveal
    const tally = Object.keys(s.players)
      .map((id) => ({
        name: s.players[id] ?? '?',
        votes: Object.values(s.votes).filter((t) => t === id).length,
      }))
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'fr'));

    return {
      ...base,
      category,
      clues,
      endsAt: s.endsAt,
      accusedName,
      impostorName: s.impostorId ? (s.players[s.impostorId] ?? '?') : null,
      word: secret?.word ?? null,
      caught: s.impostorId !== null && s.accused === s.impostorId,
      guess: s.guess,
      guessed: s.guessed,
      tally,
      results: Object.entries(s.gains).map(([id, gained]) => ({
        name: s.players[id] ?? '?',
        gained,
      })),
    };
  },

  getPlayerState(s, playerId) {
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    const secret = current(s);
    const isImpostor = s.impostorId === playerId;
    const inRound = s.phase !== 'ready' && s.phase !== 'final';
    const revealed = s.phase === 'reveal';

    let answered = false;
    if (s.phase === 'clues') answered = playerId in s.clues;
    if (s.phase === 'vote') answered = playerId in s.votes;

    return {
      points: s.points[playerId] ?? 0,
      rank,
      role: inRound && s.impostorId ? (isImpostor ? 'impostor' : 'crew') : null,
      // Le mot secret ne quitte le serveur que pour les membres de l'équipe, et à la révélation.
      word: inRound && secret ? (isImpostor && !revealed ? null : secret.word) : null,
      category: secret && inRound ? secret.category : null,
      myClue: s.clues[playerId] ?? null,
      myVote: s.votes[playerId] ?? null,
      answered,
      canGuess: s.phase === 'guess' && isImpostor,
      gained: revealed ? (s.gains[playerId] ?? 0) : null,
    };
  },

  getHostState(s) {
    const pending =
      s.phase === 'clues'
        ? Object.keys(s.players).filter((id) => !(id in s.clues))
        : s.phase === 'vote'
          ? Object.keys(s.players).filter((id) => !(id in s.votes))
          : [];
    return {
      pending: pending.map((id) => s.players[id] ?? '?'),
      guessing: s.phase === 'guess' && s.impostorId ? (s.players[s.impostorId] ?? '?') : null,
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },
  suggest(s, playerId, random) {
    if (s.phase === 'clues' && !(playerId in s.clues)) {
      const text = BOT_CLUES[Math.floor(random() * BOT_CLUES.length)]!;
      return { type: 'clue', payload: { text }, key: `c${s.round}` };
    }
    if (s.phase === 'vote' && !(playerId in s.votes)) {
      const others = Object.keys(s.players).filter((id) => id !== playerId);
      const target = others[Math.floor(random() * others.length)];
      if (!target) return null;
      return { type: 'vote', payload: { target }, key: `v${s.round}` };
    }
    if (s.phase === 'guess' && s.impostorId === playerId) {
      return { type: 'guess', payload: { word: 'Bidule' }, key: `g${s.round}` };
    }
    return null;
  },
};
