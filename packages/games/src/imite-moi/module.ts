import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { MODE_INSTRUCTION, MODE_LABEL, PROMPTS, artUrl, type ArtKey, type Mode, type PromptDef } from './prompts.js';

/**
 * Imite-moi : une consigne apparaît sur l'écran principal (une illustration à imiter, ou un son).
 * Chaque joueur envoie sa réponse depuis son téléphone : une photo de la galerie ou prise avec la caméra,
 * ou un enregistrement de 3 secondes au micro. Puis tout le monde vote pour la plus réussie, sans savoir qui
 * l'a envoyée. Chaque vote reçu rapporte 100 points à son auteur.
 *
 * Les photos et les sons vivent uniquement dans l'état de la partie, en mémoire : ils ne sont ni enregistrés
 * en base, ni journalisés, et disparaissent avec la partie.
 */

const GAME_NAME = 'Imite-moi !';
const GAME_ICON = '🎭';

export const LEVELS = ['galerie', 'grimace', 'cri', 'melange'] as const;
export type Level = (typeof LEVELS)[number];

const LEVEL_MODES: Record<Level, Mode[]> = {
  galerie: ['galerie'],
  grimace: ['grimace'],
  cri: ['cri'],
  melange: ['galerie', 'grimace', 'cri'],
};

/**
 * Taille maximale d'une réponse encodée, en caractères. Une action Socket.IO est limitée à 64 Ko côté serveur :
 * le téléphone réduit donc sa photo (ou son enregistrement) sous cette taille avant de l'envoyer.
 */
export const MEDIA_MAX_CHARS = 60_000;
const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const SOUND_URL = /^data:audio\/(webm|ogg|mp4)(;codecs=[A-Za-z0-9.,-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/;

export const imiteSettingsSchema = z.object({
  level: z.enum(LEVELS).default('melange'),
  rounds: z.number().int().min(1).max(10).default(4),
  answerSeconds: z.number().int().min(15).max(120).default(40),
});

export type ImiteSettings = z.infer<typeof imiteSettingsSchema>;

const photoSchema = z.object({ dataUrl: z.string().max(MEDIA_MAX_CHARS).regex(IMAGE_URL, 'Image invalide') });
const soundSchema = z.object({ dataUrl: z.string().max(MEDIA_MAX_CHARS).regex(SOUND_URL, 'Son invalide') });
const voteSchema = z.object({ option: z.number().int().min(0).max(11) });

const VOTE_SECONDS = 25;
const VOTE_POINTS = 100;
const REVEAL_MS = 9000;

const WRITE_TIMEOUT = 'write-timeout';
const VOTE_TIMEOUT = 'vote-timeout';
const REVEAL_NEXT = 'reveal-next';

export type ImitePhase = 'ready' | 'submit' | 'vote' | 'reveal' | 'final';
export type EntryKind = 'photo' | 'sound';

export interface Round {
  mode: Mode;
  title: string;
  art: ArtKey | null;
}

export interface Entry {
  kind: EntryKind;
  dataUrl: string;
}

export interface ImiteState {
  settings: ImiteSettings;
  /** Manches tirées pour cette partie, dans l'ordre de jeu. */
  plan: Round[];
  phase: ImitePhase;
  index: number;
  endsAt: number;
  players: Record<string, string>;
  points: Record<string, number>;
  /** joueur -> réponse envoyée pendant la manche en cours. */
  entries: Record<string, Entry>;
  /** Auteurs dans l'ordre d'affichage anonyme du vote. */
  options: string[];
  /** votant -> index de l'option choisie. */
  votes: Record<string, number>;
  /** Points gagnés pendant la manche, révélés à la fin du vote. */
  gains: Record<string, number>;
}

function kindOf(mode: Mode): EntryKind {
  return mode === 'cri' ? 'sound' : 'photo';
}

/** Consignes tirées au sort, mode par mode. Une consigne ne revient qu'après les autres de son mode. */
function planRounds(level: Level, count: number, random: () => number): Round[] {
  const modes = LEVEL_MODES[level];
  const pools: Record<Mode, PromptDef[]> = {
    galerie: shuffle(PROMPTS.galerie, random),
    grimace: shuffle(PROMPTS.grimace, random),
    cri: shuffle(PROMPTS.cri, random),
  };
  const used: Record<Mode, number> = { galerie: 0, grimace: 0, cri: 0 };
  return Array.from({ length: count }, (_, i) => {
    const mode = modes[i % modes.length]!;
    const pool = pools[mode];
    const prompt = pool[used[mode] % pool.length]!;
    used[mode] += 1;
    return { mode, title: prompt.title, art: prompt.art ?? null };
  });
}

function currentRound(s: ImiteState): Round | undefined {
  return s.plan[s.index];
}

function clearSceneTimers(ctx: GameContext): void {
  ctx.cancel(WRITE_TIMEOUT);
  ctx.cancel(VOTE_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
}

function openSubmit(s: ImiteState, ctx: GameContext): ImiteState {
  clearSceneTimers(ctx);
  const ms = s.settings.answerSeconds * 1000;
  ctx.schedule(WRITE_TIMEOUT, ms);
  return { ...s, phase: 'submit', entries: {}, options: [], votes: {}, gains: {}, endsAt: ctx.now() + ms };
}

function openVote(s: ImiteState, ctx: GameContext): ImiteState {
  ctx.cancel(WRITE_TIMEOUT);
  const options = shuffle(Object.keys(s.entries), ctx.random);
  // Il faut au moins deux réponses pour avoir quelque chose à départager.
  if (options.length < 2) return reveal({ ...s, options }, ctx);
  const ms = VOTE_SECONDS * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', options, votes: {}, endsAt: ctx.now() + ms };
}

function reveal(s: ImiteState, ctx: GameContext): ImiteState {
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

function advance(s: ImiteState, ctx: GameContext): ImiteState {
  ctx.cancel(REVEAL_NEXT);
  if (s.index + 1 < s.plan.length) return openSubmit({ ...s, index: s.index + 1 }, ctx);
  return finish(s, ctx);
}

/** Fin de partie : les photos et les sons envoyés ne sont plus conservés. */
function finish(s: ImiteState, ctx: GameContext): ImiteState {
  clearSceneTimers(ctx);
  return { ...s, phase: 'final', entries: {}, options: [], votes: {} };
}

/** Un petit PNG valide, utilisé par les robots du mode test. */
const BOT_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function entryView(s: ImiteState, id: string) {
  const entry = s.entries[id];
  return { kind: entry?.kind ?? 'photo', dataUrl: entry?.dataUrl ?? '' };
}

function publicView(s: ImiteState) {
  const round = currentRound(s);
  const base = {
    mode: 'imite-moi' as const,
    phase: s.phase,
    name: GAME_NAME,
    icon: GAME_ICON,
    level: s.settings.level,
    index: s.index,
    total: s.plan.length,
    playerCount: Object.keys(s.players).length,
    ranking: rankEntries(s.players, s.points),
  };
  if (!round || s.phase === 'ready' || s.phase === 'final') return base;

  const info = {
    mode: round.mode,
    modeLabel: MODE_LABEL[round.mode],
    kind: kindOf(round.mode),
    title: round.title,
    instruction: MODE_INSTRUCTION[round.mode],
    art: round.art ? artUrl(round.art) : null,
  };

  if (s.phase === 'submit') {
    return {
      ...base,
      ...info,
      endsAt: s.endsAt,
      durationMs: s.settings.answerSeconds * 1000,
      submittedCount: Object.keys(s.entries).length,
    };
  }

  if (s.phase === 'vote') {
    return {
      ...base,
      ...info,
      endsAt: s.endsAt,
      durationMs: VOTE_SECONDS * 1000,
      // Anonymat : on montre les réponses, jamais leurs auteurs.
      entries: s.options.map((id) => entryView(s, id)),
      voteCount: Object.keys(s.votes).length,
    };
  }

  // Révélation : auteurs et votes deviennent publics.
  const results = s.options
    .map((id, i) => ({
      ...entryView(s, id),
      author: s.players[id] ?? '?',
      votes: Object.values(s.votes).filter((v) => v === i).length,
      gained: s.gains[id] ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes || a.author.localeCompare(b.author, 'fr'));
  return { ...base, ...info, endsAt: s.endsAt, results };
}

function noticeFor() {
  return {
    goal: 'Imiter, photographier ou enregistrer la scène proposée, puis voter pour la plus réussie.',
    steps: [
      'La consigne apparaît sur l’écran principal.',
      'Envoyez votre réponse depuis votre téléphone : une photo de la galerie, une photo prise avec la caméra, ou 3 secondes de son.',
      'Votez pour la réponse la plus réussie, sans savoir qui l’a envoyée.',
      'Chaque vote reçu rapporte 100 points à son auteur.',
    ],
    tips: [
      'Votre photo ou votre son est montré aux autres joueurs pendant le vote, puis effacé à la fin de la partie.',
      'Sans caméra ou micro autorisés, la galerie du téléphone reste disponible.',
      'Vous ne pouvez pas voter pour votre propre envoi.',
    ],
  };
}

export const imiteMoi: GameModule<ImiteState, ImiteSettings> = {
  manifest: {
    id: 'imite-moi',
    name: GAME_NAME,
    description: 'Imitez une scène, photographiez-la ou enregistrez-la : les autres votent pour la meilleure.',
    icon: GAME_ICON,
    category: 'quiz',
    version: '1.0.0',
    apiVersion: 1,
    // Il faut au moins deux joueurs : on ne vote pas pour sa propre réponse.
    minPlayers: 2,
    maxPlayers: 12,
    durationMin: 6,
    notice: noticeFor(),
  },

  settingsSchema: imiteSettingsSchema,
  defaultSettings: imiteSettingsSchema.parse({}),

  actions: {
    photo: photoSchema,
    sound: soundSchema,
    vote: voteSchema,
  },

  initialize(settings, players, ctx) {
    const parsed = imiteSettingsSchema.parse(settings);
    return {
      settings: parsed,
      plan: planRounds(parsed.level, parsed.rounds, ctx.random),
      phase: 'ready',
      index: 0,
      endsAt: 0,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      entries: {},
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
    if (s.plan.length === 0) return fail('Aucune consigne disponible');
    return ok(openSubmit(s, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');

    if (type === 'photo' || type === 'sound') {
      if (s.phase !== 'submit') return fail('Les réponses ne sont pas attendues maintenant');
      const round = currentRound(s);
      if (!round) return fail('Aucune consigne en cours');
      const wanted = kindOf(round.mode);
      if (type !== wanted) {
        return fail(
          wanted === 'sound'
            ? 'Cette manche demande un son, pas une photo'
            : 'Cette manche demande une photo, pas un son',
        );
      }
      if (p.id in s.entries) return fail('Réponse déjà envoyée');
      const { dataUrl } = payload as { dataUrl: string };
      const next = { ...s, entries: { ...s.entries, [p.id]: { kind: wanted, dataUrl } } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.entries);
      return ok(done ? openVote(next, ctx) : next);
    }

    if (type === 'vote') {
      if (s.phase !== 'vote') return fail('Pas de vote en cours');
      if (p.id in s.votes) return fail('Vote déjà enregistré');
      const { option } = payload as { option: number };
      if (option >= s.options.length) return fail('Choix invalide');
      if (s.options[option] === p.id) return fail('Vous ne pouvez pas voter pour votre propre réponse');
      const next = { ...s, votes: { ...s.votes, [p.id]: option } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.votes);
      return ok(done ? reveal(next, ctx) : next);
    }

    return fail('Action inconnue');
  },

  onTimer(s, key, ctx) {
    if (key === WRITE_TIMEOUT && s.phase === 'submit') return openVote(s, ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'submit') return openVote(s, ctx);
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
    const option = s.options.indexOf(playerId);
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    const answered = s.phase === 'submit' ? playerId in s.entries : s.phase === 'vote' ? playerId in s.votes : false;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      mode: currentRound(s)?.mode ?? null,
      answered,
      myOption: option >= 0 ? option : null,
      myVote: s.votes[playerId] ?? null,
      gained: s.phase === 'reveal' ? (s.gains[playerId] ?? 0) : null,
    };
  },

  getHostState(s) {
    const waiting =
      s.phase === 'submit'
        ? Object.keys(s.players).filter((id) => !(id in s.entries))
        : s.phase === 'vote'
          ? Object.keys(s.players).filter((id) => !(id in s.votes))
          : [];
    return { pending: waiting.map((id) => s.players[id]!) };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    if (s.phase === 'submit' && !(playerId in s.entries)) {
      const round = currentRound(s);
      // Les robots ne peuvent ni prendre de photo ni enregistrer de son : ils restent passifs sur les manches « cri ».
      if (!round || round.mode === 'cri') return null;
      return { type: 'photo', payload: { dataUrl: BOT_IMAGE }, key: `p${s.index}` };
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
