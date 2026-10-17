import { z } from 'zod';
import {
  resolveRules,
  resolveScreen,
  type GameContext,
  type GameModule,
  type JobOutcome,
  type PlayerRef,
  type RecipeDefinition,
  type RecipePhase,
  type RecipeRules,
} from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { consigneJob, consignesFromOutcome, runConsignesJob } from './ai.js';

/**
 * Recette « vote sur consigne » : chacun écrit le premier mot qui lui vient pour une consigne, puis tout le
 * monde vote, sans savoir qui a écrit quoi. Chaque vote rapporte des points à l'auteur du mot. Les consignes,
 * les règles et les écrans viennent du paquet ; l'IA peut écrire les consignes, avec repli obligatoire.
 */

const REVEAL_MS = 9000;
const WRITE_TIMEOUT = 'write-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const REVEAL_NEXT = 'reveal-next';

const BOT_WORDS = ['Pizza', 'Fantôme', 'Chaussette', 'Tartiflette', 'Canard', 'Vacances', 'Brocoli', 'Licorne'];

export const voteSettingsSchema = z.object({});
export type VoteSettings = z.infer<typeof voteSettingsSchema>;

export interface RecipeState {
  phase: RecipePhase;
  definition: RecipeDefinition;
  rules: RecipeRules;
  /** Consignes du paquet : repli quand l'IA ne répond pas. */
  consignes: string[];
  /** Consignes tirées pour cette partie. */
  rounds: string[];
  round: number;
  /** Explication affichée quand les consignes viennent du paquet et non de l'IA. */
  notice: string | null;
  /** Identifiant du travail IA en cours ; un résultat tardif d'un autre travail est ignoré. */
  jobId: string | null;
  players: Record<string, string>;
  points: Record<string, number>;
  /** auteur -> mot proposé pendant la manche en cours. */
  words: Record<string, string>;
  /** Auteurs dans l'ordre d'affichage anonyme. */
  options: string[];
  /** votant -> index de l'option choisie. */
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

function openWriting(s: RecipeState, ctx: GameContext): RecipeState {
  clearRoundTimers(ctx);
  const ms = s.rules.ecriture * 1000;
  ctx.schedule(WRITE_TIMEOUT, ms);
  return { ...s, phase: 'ecriture', words: {}, options: [], votes: {}, gains: {}, endsAt: ctx.now() + ms };
}

function openVote(s: RecipeState, ctx: GameContext): RecipeState {
  ctx.cancel(WRITE_TIMEOUT);
  const options = shuffle(Object.keys(s.words), ctx.random);
  // Sans au moins deux mots, il n'y a rien à départager : on passe directement à la révélation.
  if (options.length < 2) return reveal({ ...s, options }, ctx);
  const ms = s.rules.vote * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', options, votes: {}, endsAt: ctx.now() + ms };
}

function reveal(s: RecipeState, ctx: GameContext): RecipeState {
  ctx.cancel(WRITE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);

  const gains: Record<string, number> = {};
  for (const option of Object.values(s.votes)) {
    const author = s.options[option];
    if (author) gains[author] = (gains[author] ?? 0) + s.rules.pointsParVote;
  }

  const points = { ...s.points };
  for (const [id, gained] of Object.entries(gains)) {
    points[id] = (points[id] ?? 0) + gained;
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'resultat', points, gains, endsAt: ctx.now() + REVEAL_MS };
}

function advance(s: RecipeState, ctx: GameContext): RecipeState {
  ctx.cancel(REVEAL_NEXT);
  if (s.round + 1 < s.rounds.length) {
    return openWriting({ ...s, round: s.round + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: RecipeState, ctx: GameContext): RecipeState {
  clearRoundTimers(ctx);
  return { ...s, phase: 'final' };
}

/** Démarre les manches avec les consignes données (liste du paquet, ou liste écrite par l'IA). */
function startRounds(s: RecipeState, consignes: string[], notice: string | null, ctx: GameContext): RecipeState {
  const rounds = shuffle(consignes, ctx.random).slice(0, s.rules.manches);
  return openWriting({ ...s, rounds, round: 0, notice, jobId: null }, ctx);
}

/** Nombre de minutes approximatif pour la fiche du jeu. */
function durationOf(rules: RecipeRules): number {
  return Math.max(1, Math.round((rules.manches * (rules.ecriture + rules.vote + REVEAL_MS / 1000)) / 60));
}

export function createVoteSurConsigne(
  definition: RecipeDefinition,
  options: { id: string },
): GameModule<RecipeState, VoteSettings> {
  const rules = resolveRules(definition);
  const wordSchema = z.object({ word: z.string().trim().min(1).max(rules.motMax) });
  const voteSchema = z.object({ option: z.number().int().min(0).max(39) });

  return {
    manifest: {
      id: options.id,
      category: 'quiz',
      name: definition.name,
      description: definition.description || 'Une consigne, des mots, et un vote pour le plus drôle.',
      icon: definition.icon,
      version: '1.0.0',
      apiVersion: 1,
      minPlayers: 2,
      maxPlayers: 12,
      durationMin: durationOf(rules),
      notice: {
        goal: definition.description || 'Trouver le mot le plus drôle pour une consigne, et recueillir des votes.',
        steps: [
          'Lisez la consigne sur l’écran.',
          `Écrivez sur votre téléphone le premier mot qui vous vient (${rules.motMax} caractères au plus).`,
          'Votez pour le mot le plus drôle, sans savoir qui l’a écrit.',
          `Chaque vote reçu rapporte ${rules.pointsParVote} points à l’auteur du mot.`,
        ],
        tips: ['Vous ne pouvez pas voter pour votre propre mot.', 'Il faut au moins deux mots pour passer au vote.'],
      },
      ai: definition.ai !== undefined,
    },
    settingsSchema: voteSettingsSchema,
    defaultSettings: {},

    actions: {
      word: wordSchema,
      vote: voteSchema,
    },

    initialize(_settings, players: PlayerRef[]) {
      return {
        phase: 'pret',
        definition,
        rules,
        consignes: definition.consignes,
        rounds: [],
        round: 0,
        notice: null,
        jobId: null,
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
      if (s.phase !== 'pret') return s;
      return {
        ...s,
        players: { ...s.players, [p.id]: p.name },
        points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
      };
    },

    onPlayerLeave(s, p: PlayerRef) {
      if (s.phase !== 'pret') return s;
      const players = { ...s.players };
      const points = { ...s.points };
      delete players[p.id];
      delete points[p.id];
      return { ...s, players, points };
    },

    start(s, ctx) {
      if (s.phase !== 'pret') return fail('La partie a déjà commencé');
      if (s.consignes.length === 0) return fail('Aucune consigne disponible');
      if (definition.ai) {
        // L'IA écrit les consignes d'abord ; le travail est exécuté par la salle, sans bloquer les autres.
        const jobId = `c${Math.floor(ctx.random() * 1e9)}`;
        return ok({ ...s, phase: 'generation', jobId, notice: null });
      }
      return ok(startRounds(s, s.consignes, null, ctx));
    },

    handleAction(s, p, type, payload, ctx) {
      if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');

      if (type === 'word') {
        if (s.phase !== 'ecriture') return fail('Les mots ne sont pas attendus maintenant');
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
      if (key === WRITE_TIMEOUT && s.phase === 'ecriture') return openVote(s, ctx);
      if (key === VOTE_TIMEOUT && s.phase === 'vote') return reveal(s, ctx);
      if (key === REVEAL_NEXT && s.phase === 'resultat') return advance(s, ctx);
      return s;
    },

    nextRound(s, ctx) {
      if (s.phase === 'ecriture') return openVote(s, ctx);
      if (s.phase === 'vote') return reveal(s, ctx);
      if (s.phase === 'resultat') return advance(s, ctx);
      return s;
    },

    calculateScores(s) {
      return rankEntries(s.players, s.points);
    },

    end(s, ctx) {
      return finish(s, ctx);
    },

    pendingJob(s) {
      if (s.phase !== 'generation' || !s.jobId) return null;
      return consigneJob(s.jobId, s.definition);
    },

    runJob: (job, ctx, signal) => runConsignesJob(job, ctx, signal),

    completeJob(s, jobId, outcome: JobOutcome, ctx) {
      if (s.phase !== 'generation' || s.jobId !== jobId || !definition.ai) return s;
      const picked = consignesFromOutcome(outcome, s.consignes, ctx.random, definition.ai.nombre);
      return startRounds(s, picked.consignes, picked.notice, ctx);
    },

    getPublicState(s) {
      const base = {
        title: s.definition.name,
        phase: s.phase,
        round: s.round,
        total: s.rounds.length,
        playerCount: Object.keys(s.players).length,
        ranking: rankEntries(s.players, s.points),
        motMax: s.rules.motMax,
        notice: s.notice,
        layout: {
          tv: resolveScreen(s.definition, 'tv', s.phase),
          joueur: resolveScreen(s.definition, 'joueur', s.phase),
        },
      };

      if (s.phase === 'pret' || s.phase === 'generation' || s.phase === 'final') {
        return { ...base, prompt: null };
      }

      const prompt = s.rounds[s.round] ?? null;

      if (s.phase === 'ecriture') {
        return {
          ...base,
          prompt,
          endsAt: s.endsAt,
          durationMs: s.rules.ecriture * 1000,
          writtenCount: Object.keys(s.words).length,
        };
      }

      if (s.phase === 'vote') {
        return {
          ...base,
          prompt,
          endsAt: s.endsAt,
          durationMs: s.rules.vote * 1000,
          // Anonymat : on montre les mots, jamais leurs auteurs.
          options: s.options.map((id) => s.words[id] ?? ''),
          voteCount: Object.keys(s.votes).length,
        };
      }

      // resultat : les auteurs et les votes deviennent publics.
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
        answered: s.phase === 'ecriture' ? playerId in s.words : s.phase === 'vote' ? playerId in s.votes : false,
        gained: s.phase === 'resultat' ? (s.gains[playerId] ?? 0) : null,
      };
    },

    getHostState(s) {
      const missing =
        s.phase === 'ecriture'
          ? Object.keys(s.players).filter((id) => !(id in s.words))
          : s.phase === 'vote'
            ? Object.keys(s.players).filter((id) => !(id in s.votes))
            : [];
      return { pending: missing.map((id) => s.players[id] ?? '?') };
    },

    isFinished(s) {
      return s.phase === 'final';
    },

    suggest(s, playerId, random) {
      if (s.phase === 'ecriture' && !(playerId in s.words)) {
        const word = BOT_WORDS[Math.floor(random() * BOT_WORDS.length)]!.slice(0, s.rules.motMax);
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
}
