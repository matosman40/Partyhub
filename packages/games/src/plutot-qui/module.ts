import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import rawPrompts from './prompts.fr.json' with { type: 'json' };

/**
 * Plutôt qui ? : une question du type « Qui ... ? » est posée. Chacun vote
 * en secret pour un joueur (soi-même compris). Les votants qui ont suivi
 * la majorité (ceux qui ont voté pour un joueur ayant reçu le plus de voix)
 * gagnent des points : on récompense l’intuition collective.
 */

const PROMPTS: string[] = z.array(z.string().min(1)).min(1).parse(rawPrompts);

export const plutotQuiSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(15).default(6),
  voteSeconds: z.number().int().min(10).max(90).default(25),
});

export type PlutotQuiSettings = z.infer<typeof plutotQuiSettingsSchema>;

const CROWD_POINTS = 100;
const REVEAL_MS = 8000;
const VOTE_TIMEOUT = 'vote-timeout';
const REVEAL_NEXT = 'reveal-next';

const voteSchema = z.object({ target: z.string().min(1).max(64) });

export type PlutotQuiPhase = 'ready' | 'vote' | 'reveal' | 'final';

export interface PlutotQuiState {
  phase: PlutotQuiPhase;
  settings: PlutotQuiSettings;
  prompts: string[];
  round: number;
  players: Record<string, string>;
  points: Record<string, number>;
  /** votant -> identifiant du joueur désigné. */
  votes: Record<string, string>;
  gains: Record<string, number>;
  endsAt: number;
}

/** Joueurs qui ont reçu le plus de voix (plusieurs si égalité, aucun si personne n’a voté). */
function topTargets(votes: Record<string, string>): string[] {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) {
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  if (max === 0) return [];
  return [...counts.entries()].filter(([, n]) => n === max).map(([id]) => id);
}

function openVote(s: PlutotQuiState, ctx: GameContext): PlutotQuiState {
  ctx.cancel(REVEAL_NEXT);
  const ms = s.settings.voteSeconds * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', votes: {}, gains: {}, endsAt: ctx.now() + ms };
}

function reveal(s: PlutotQuiState, ctx: GameContext): PlutotQuiState {
  ctx.cancel(VOTE_TIMEOUT);
  const winners = new Set(topTargets(s.votes));
  const gains: Record<string, number> = {};

  for (const [voter, target] of Object.entries(s.votes)) {
    if (winners.has(target)) gains[voter] = CROWD_POINTS;
  }

  let points = s.points;
  for (const [id, gained] of Object.entries(gains)) {
    points = addPoints(points, id, gained);
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'reveal', points, gains, endsAt: ctx.now() + REVEAL_MS };
}

function advance(s: PlutotQuiState, ctx: GameContext): PlutotQuiState {
  ctx.cancel(REVEAL_NEXT);
  if (s.round + 1 < s.prompts.length) {
    return openVote({ ...s, round: s.round + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: PlutotQuiState, ctx: GameContext): PlutotQuiState {
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  return { ...s, phase: 'final' };
}

export const plutotQui: GameModule<PlutotQuiState, PlutotQuiSettings> = {
  manifest: {
    id: 'plutot-qui',
    category: 'quiz',
    name: 'Plutôt qui ?',
    description: 'Qui est le plus susceptible de… ? Votez en secret et suivez la majorité.',
    icon: '👉',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 12,
    durationMin: 10,
    notice: {
      goal: 'Voter comme la majorité, sur des questions du type « Qui… ? ».',
      steps: [
        'Une question « Qui… ? » s’affiche sur l’écran.',
        'Votez en secret pour la personne qui correspond le mieux (vous pouvez vous désigner).',
        'Les votants qui ont choisi la personne la plus désignée gagnent 100 points.',
        'En cas d’égalité, chaque personne en tête compte.',
      ],
      tips: [
        'Les votes restent cachés jusqu’à la révélation.',
        'Fonctionne à deux, mais s’anime vraiment à partir de quatre joueurs.',
      ],
    },
  },

  settingsSchema: plutotQuiSettingsSchema,
  defaultSettings: plutotQuiSettingsSchema.parse({}),

  actions: {
    vote: voteSchema,
  },

  initialize(settings, players, ctx) {
    const parsed = plutotQuiSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      prompts: shuffle(PROMPTS, ctx.random).slice(0, parsed.rounds),
      round: 0,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
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
    if (s.prompts.length === 0) return fail('Aucune question disponible');
    return ok(openVote(s, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (type !== 'vote') return fail('Action inconnue');
    if (s.phase !== 'vote') return fail('Pas de vote en cours');
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (p.id in s.votes) return fail('Vote déjà enregistré');

    const parsed = voteSchema.safeParse(payload);
    if (!parsed.success) return fail('Vote invalide');
    const target = parsed.data.target;
    if (!(target in s.players)) return fail('Joueur inconnu');

    const next = { ...s, votes: { ...s.votes, [p.id]: target } };
    const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.votes);
    return ok(done ? reveal(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
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
      ranking: rankEntries(s.players, s.points),
      candidates: Object.entries(s.players).map(([id, name]) => ({ id, name })),
    };

    if (s.phase === 'ready' || s.phase === 'final') return { ...base, prompt: null };

    const prompt = s.prompts[s.round] ?? null;

    if (s.phase === 'vote') {
      return {
        ...base,
        prompt,
        endsAt: s.endsAt,
        durationMs: s.settings.voteSeconds * 1000,
        voteCount: Object.keys(s.votes).length,
      };
    }

    // reveal : décompte public et votants désignés.
    const tally = Object.keys(s.players)
      .map((id) => {
        const voters = Object.entries(s.votes)
          .filter(([, target]) => target === id)
          .map(([voter]) => s.players[voter] ?? '?');
        return { playerId: id, name: s.players[id] ?? '?', votes: voters.length, voters };
      })
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'fr'));

    const winners = topTargets(s.votes).map((id) => s.players[id] ?? '?');
    return { ...base, prompt, endsAt: s.endsAt, tally, winners };
  },

  getPlayerState(s, playerId) {
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      myVote: s.votes[playerId] ?? null,
      answered: s.phase === 'vote' ? playerId in s.votes : false,
      gained: s.phase === 'reveal' ? (s.gains[playerId] ?? 0) : null,
    };
  },

  getHostState(s) {
    const pending = s.phase === 'vote' ? Object.keys(s.players).filter((id) => !(id in s.votes)) : [];
    return { pending: pending.map((id) => s.players[id] ?? '?') };
  },

  isFinished(s) {
    return s.phase === 'final';
  },
  suggest(s, playerId, random) {
    if (s.phase !== 'vote' || playerId in s.votes) return null;
    const ids = Object.keys(s.players);
    const target = ids[Math.floor(random() * ids.length)];
    if (!target) return null;
    return { type: 'vote', payload: { target }, key: `v${s.round}` };
  },
};
