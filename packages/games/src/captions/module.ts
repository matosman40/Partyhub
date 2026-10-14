import { z } from 'zod';
import {
  mediaQuizDefinitionSchema,
  type GameContext,
  type GameModule,
  type MediaItem,
  type MediaKind,
  type MediaQuizDefinition,
  type PlayerRef,
} from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { hostMediaOf } from '../media-quiz/host-media.js';

/**
 * Sous-titres (« use your word ») : l'écran principal joue une scène en langue étrangère.
 * Chacun écrit la réplique qu'il imagine, puis tout le monde vote, sans savoir qui a écrit
 * quoi. Chaque vote reçu rapporte des points à l'auteur. La traduction de référence,
 * si l'administrateur l'a fournie, est révélée à la fin.
 */

export const captionSettingsSchema = z.object({
  questionCount: z.number().int().min(1).max(30).default(6),
  answerSeconds: z.number().int().min(15).max(120).default(45),
});

export type CaptionSettings = z.infer<typeof captionSettingsSchema>;

const CAPTION_MAX = 120;
const VOTE_SECONDS = 25;
const VOTE_POINTS = 100;
const REVEAL_MS = 9000;

const WRITE_TIMEOUT = 'write-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const REVEAL_NEXT = 'reveal-next';

const captionSchema = z.object({ text: z.string().trim().min(1).max(CAPTION_MAX) });
const voteSchema = z.object({ option: z.number().int().min(0).max(19) });

export type CaptionPhase = 'ready' | 'write' | 'vote' | 'reveal' | 'final';

export interface CaptionState {
  name: string;
  icon: string;
  kind: MediaKind;
  settings: CaptionSettings;
  /** Scènes tirées pour cette partie, dans l'ordre de jeu. */
  questions: MediaItem[];
  phase: CaptionPhase;
  index: number;
  endsAt: number;
  players: Record<string, string>;
  points: Record<string, number>;
  /** auteur -> réplique écrite pendant la scène en cours. */
  captions: Record<string, string>;
  /** Auteurs dans l'ordre d'affichage anonyme. */
  options: string[];
  /** votant -> index de l'option choisie. */
  votes: Record<string, number>;
  /** Points gagnés pendant la scène, révélés à la fin du vote. */
  gains: Record<string, number>;
}

function clearSceneTimers(ctx: GameContext): void {
  ctx.cancel(WRITE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
}

function openWriting(s: CaptionState, ctx: GameContext): CaptionState {
  clearSceneTimers(ctx);
  const ms = s.settings.answerSeconds * 1000;
  ctx.schedule(WRITE_TIMEOUT, ms);
  return {
    ...s,
    phase: 'write',
    captions: {},
    options: [],
    votes: {},
    gains: {},
    endsAt: ctx.now() + ms,
  };
}

function openVote(s: CaptionState, ctx: GameContext): CaptionState {
  ctx.cancel(WRITE_TIMEOUT);
  const options = shuffle(Object.keys(s.captions), ctx.random);
  // Il faut au moins deux répliques pour avoir quelque chose à départager.
  if (options.length < 2) return reveal({ ...s, options }, ctx);
  const ms = VOTE_SECONDS * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', options, votes: {}, endsAt: ctx.now() + ms };
}

function reveal(s: CaptionState, ctx: GameContext): CaptionState {
  ctx.cancel(WRITE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  const gains: Record<string, number> = {};
  for (const option of Object.values(s.votes)) {
    const author = s.options[option];
    if (author) gains[author] = (gains[author] ?? 0) + VOTE_POINTS;
  }
  const points = { ...s.points };
  for (const [id, gained] of Object.entries(gains)) points[id] = (points[id] ?? 0) + gained;
  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'reveal', points, gains, endsAt: ctx.now() + REVEAL_MS };
}

function advance(s: CaptionState, ctx: GameContext): CaptionState {
  ctx.cancel(REVEAL_NEXT);
  if (s.index + 1 < s.questions.length) {
    return openWriting({ ...s, index: s.index + 1 }, ctx);
  }
  return finish(s, ctx);
}

function finish(s: CaptionState, ctx: GameContext): CaptionState {
  clearSceneTimers(ctx);
  return { ...s, phase: 'final' };
}

const BOT_CAPTIONS = [
  'Je ne sais pas où j’ai mis mes clés.',
  'Non, pas le fromage !',
  'On en reparle au dessert.',
  'Mon chat me juge.',
  'Qui a mangé la dernière part de gâteau ?',
  'C’est encore la faute du réveil.',
  'Ça, c’est une idée de cousin.',
];

function scene(s: CaptionState): MediaItem | undefined {
  return s.questions[s.index];
}

function publicView(s: CaptionState) {
  const q = scene(s);
  const base = {
    mode: 'sous-titres' as const,
    phase: s.phase,
    kind: s.kind,
    kindLabel: 'Sous-titres',
    prompt: 'Écrivez la réplique de cette scène',
    name: s.name,
    icon: s.icon,
    index: s.index,
    total: s.questions.length,
    playerCount: Object.keys(s.players).length,
    ranking: rankEntries(s.players, s.points),
    clipSec: q?.durationSec ?? 0,
    hint: q?.detail ?? '',
  };
  if (!q || s.phase === 'ready' || s.phase === 'final') return base;

  if (s.phase === 'write') {
    return {
      ...base,
      endsAt: s.endsAt,
      durationMs: s.settings.answerSeconds * 1000,
      writtenCount: Object.keys(s.captions).length,
    };
  }

  if (s.phase === 'vote') {
    return {
      ...base,
      endsAt: s.endsAt,
      durationMs: VOTE_SECONDS * 1000,
      // Anonymat : on montre les répliques, jamais leurs auteurs.
      options: s.options.map((id) => s.captions[id] ?? ''),
      voteCount: Object.keys(s.votes).length,
    };
  }

  // Révélation : auteurs, votes, et la traduction de référence deviennent publics.
  const results = s.options
    .map((id, i) => ({
      text: s.captions[id] ?? '',
      author: s.players[id] ?? '?',
      votes: Object.values(s.votes).filter((v) => v === i).length,
      gained: s.gains[id] ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes || a.author.localeCompare(b.author, 'fr'));
  return { ...base, endsAt: s.endsAt, results, answer: q.answer };
}

/** Vue de l'écran principal : le média et la liste des joueurs qu'on attend. */
function hostView(s: CaptionState) {
  const q = scene(s);
  const pending =
    s.phase === 'write'
      ? Object.keys(s.players).filter((id) => !(id in s.captions)).map((id) => s.players[id]!)
      : s.phase === 'vote'
        ? Object.keys(s.players).filter((id) => !(id in s.votes)).map((id) => s.players[id]!)
        : [];
  if (!q || s.phase === 'ready' || s.phase === 'final') return { media: null, pending };
  return { media: hostMediaOf(q, s.index), pending };
}

function noticeFor() {
  return {
    goal: 'Écrire la réplique la plus drôle ou la plus juste pour une scène en langue étrangère.',
    steps: [
      'La scène se joue sur l’écran principal.',
      'Écrivez sur votre téléphone la réplique que vous imaginez (120 caractères au maximum).',
      'Votez pour la réplique la plus drôle, sans savoir qui l’a écrite.',
      'Chaque vote reçu rapporte 100 points à l’auteur de la réplique.',
    ],
    tips: [
      'Vous ne pouvez pas voter pour votre propre réplique.',
      'Il faut au moins deux répliques pour passer au vote.',
    ],
  };
}

/** Crée un jeu de sous-titres à partir d'une définition de médias en mode « sous-titres ». */
export function createCaptionGame(
  definition: MediaQuizDefinition,
  options: { id: string },
): GameModule<CaptionState, CaptionSettings> {
  const def = mediaQuizDefinitionSchema.parse(definition);
  const defaultCount = Math.min(def.rules.questionCount, def.items.length);
  const settingsSchema = captionSettingsSchema.extend({
    questionCount: z.number().int().min(1).max(30).default(defaultCount),
    answerSeconds: z.number().int().min(15).max(120).default(Math.max(15, def.rules.answerSeconds)),
  });
  const description =
    def.description || 'Écrivez la réplique qui manque, puis votez pour la plus drôle.';

  return {
    manifest: {
      id: options.id,
      name: def.name,
      description,
      icon: def.icon || '💬',
      category: 'quiz',
      version: '1.0.0',
      apiVersion: 1,
      // Deux joueurs au moins : on ne vote pas pour sa propre réplique, donc seul, on ne marque rien.
      minPlayers: 2,
      maxPlayers: 12,
      durationMin: Math.max(4, Math.ceil((defaultCount * (def.rules.answerSeconds + VOTE_SECONDS + 9)) / 60)),
      notice: noticeFor(),
    },
    settingsSchema,
    defaultSettings: settingsSchema.parse({}),
    actions: {
      caption: captionSchema,
      vote: voteSchema,
    },

    initialize(settings, players, ctx) {
      const parsed = settingsSchema.parse(settings);
      const count = Math.min(parsed.questionCount, def.items.length);
      return {
        name: def.name,
        icon: def.icon,
        kind: def.kind,
        settings: { questionCount: count, answerSeconds: parsed.answerSeconds },
        questions: shuffle(def.items, ctx.random).slice(0, count),
        phase: 'ready',
        index: 0,
        endsAt: 0,
        players: directory(players),
        points: Object.fromEntries(players.map((p) => [p.id, 0])),
        captions: {},
        options: [],
        votes: {},
        gains: {},
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
      if (Object.keys(s.players).length === 0) return fail('Aucun joueur dans la salle');
      if (s.questions.length === 0) return fail('Aucune scène disponible');
      return ok(openWriting(s, ctx));
    },

    handleAction(s, p, type, payload, ctx) {
      if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');

      if (type === 'caption') {
        if (s.phase !== 'write') return fail('Les répliques ne sont pas attendues maintenant');
        if (p.id in s.captions) return fail('Réplique déjà envoyée');
        const parsed = captionSchema.safeParse(payload);
        if (!parsed.success) return fail('Réplique invalide');
        const next = { ...s, captions: { ...s.captions, [p.id]: parsed.data.text } };
        const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.captions);
        return ok(done ? openVote(next, ctx) : next);
      }

      if (type === 'vote') {
        if (s.phase !== 'vote') return fail('Pas de vote en cours');
        if (p.id in s.votes) return fail('Vote déjà enregistré');
        const parsed = voteSchema.safeParse(payload);
        if (!parsed.success) return fail('Vote invalide');
        const { option } = parsed.data;
        if (option >= s.options.length) return fail('Choix invalide');
        if (s.options[option] === p.id) return fail('Vous ne pouvez pas voter pour votre propre réplique');
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
      return publicView(s);
    },

    getPlayerState(s, playerId) {
      const myOption = s.options.indexOf(playerId);
      const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
      return {
        points: s.points[playerId] ?? 0,
        rank,
        myCaption: s.captions[playerId] ?? null,
        myOption: myOption >= 0 ? myOption : null,
        myVote: s.votes[playerId] ?? null,
        answered:
          s.phase === 'write' ? playerId in s.captions : s.phase === 'vote' ? playerId in s.votes : false,
        gained: s.phase === 'reveal' ? (s.gains[playerId] ?? 0) : null,
      };
    },

    getHostState(s) {
      return hostView(s);
    },

    isFinished(s) {
      return s.phase === 'final';
    },

    suggest(s, playerId, random) {
      if (s.phase === 'write' && !(playerId in s.captions)) {
        const text = BOT_CAPTIONS[Math.floor(random() * BOT_CAPTIONS.length)]!;
        return { type: 'caption', payload: { text }, key: `c${s.index}` };
      }
      if (s.phase === 'vote' && !(playerId in s.votes)) {
        const mine = s.options.indexOf(playerId);
        const choices = s.options.map((_, i) => i).filter((i) => i !== mine);
        const option = choices[Math.floor(random() * choices.length)];
        if (option === undefined) return null;
        return { type: 'vote', payload: { option }, key: `v${s.index}` };
      }
      return null;
    },
  };
}

