import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';

/**
 * Karaoké : chacun chante à tour de rôle un passage d’une vidéo YouTube, cherchée depuis le téléphone
 * (ou collée en lien). L’écran principal joue le passage avec le son, pendant que le téléphone enregistre
 * la voix. Puis la voix est rejouée sur l’écran, l’image muette. Les autres joueurs notent la prestation
 * de 1 à 5 étoiles. Aucune parole n’est affichée.
 */

export const karaokeSettingsSchema = z.object({
  segmentSeconds: z.number().int().min(6).max(12).default(12),
  pickSeconds: z.number().int().min(20).max(180).default(90),
});

export type KaraokeSettings = z.infer<typeof karaokeSettingsSchema>;

/** Une action Socket.IO fait au plus 64 Ko : 12 secondes de son à faible débit tiennent, 15 ne tiennent pas. */
export const KARAOKE_CLIP_MAX_CHARS = 60_000;
const SOUND_URL = /^data:audio\/(webm|ogg|mp4)(;codecs=[A-Za-z0-9.,-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const VOTE_SECONDS = 20;
/** Marge accordée à l’envoi de l’enregistrement après la fin du passage. */
const SING_GRACE_MS = 8000;
const REPLAY_PAUSE_MS = 400;
const REVEAL_MS = 8000;
const POINTS_PER_STAR = 10;

const PICK_TIMEOUT = 'pick-timeout';
const SING_TIMEOUT = 'sing-timeout';
const REPLAY_NEXT = 'replay-next';
const VOTE_TIMEOUT = 'vote-timeout';
const REVEAL_NEXT = 'reveal-next';
const ALL_TIMERS = [PICK_TIMEOUT, SING_TIMEOUT, REPLAY_NEXT, VOTE_TIMEOUT, REVEAL_NEXT];

const singSchema = z.object({
  videoId: z.string().regex(VIDEO_ID, 'Vidéo invalide'),
  title: z.string().trim().min(1).max(100),
  channel: z.string().trim().max(60).default(''),
  startSec: z.number().int().min(0).max(36_000),
});

const recordingSchema = z.object({
  dataUrl: z.string().max(KARAOKE_CLIP_MAX_CHARS).regex(SOUND_URL, 'Son invalide'),
});

const ratingSchema = z.object({ stars: z.number().int().min(1).max(5) });

/** Le chanteur arrête son passage (micro perdu, vidéo qui ne se lance pas) : aucun contenu à lire. */
const abandonSchema = z.object({}).strict();

export type KaraokePhase = 'ready' | 'pick' | 'sing' | 'replay' | 'vote' | 'reveal' | 'final';

export interface KaraokeSong {
  videoId: string;
  title: string;
  channel: string;
  startSec: number;
}

export interface KaraokeState {
  name: string;
  icon: string;
  settings: KaraokeSettings;
  phase: KaraokePhase;
  /** Ordre de passage, tiré au lancement. Chacun chante une fois. */
  order: string[];
  index: number;
  endsAt: number;
  players: Record<string, string>;
  points: Record<string, number>;
  /** Passage choisi par le chanteur en cours. */
  song: KaraokeSong | null;
  /** Voix du chanteur, rejouée sur l’écran principal. Jamais envoyée aux téléphones. */
  clip: string | null;
  /** auditeur -> nombre d’étoiles (1 à 5). */
  ratings: Record<string, number>;
  /** Points gagnés pendant le passage, révélés à la fin. */
  gains: Record<string, number>;
  /** Moyenne des étoiles du passage, révélée à la fin. */
  average: number | null;
  /** Passage arrêté par le chanteur : aucun vote, aucun point. Remis à faux à chaque nouveau tour. */
  abandoned: boolean;
}

function clearTimers(ctx: GameContext): void {
  for (const key of ALL_TIMERS) ctx.cancel(key);
}

function singerOf(s: KaraokeState): string | undefined {
  return s.order[s.index];
}

function listenersOf(s: KaraokeState): string[] {
  const singer = singerOf(s);
  return Object.keys(s.players).filter((id) => id !== singer);
}

function finish(s: KaraokeState, ctx: GameContext): KaraokeState {
  clearTimers(ctx);
  return { ...s, phase: 'final', endsAt: 0 };
}

function openPick(s: KaraokeState, ctx: GameContext): KaraokeState {
  clearTimers(ctx);
  const singer = singerOf(s);
  if (singer === undefined) return finish(s, ctx);
  // Un chanteur qui n’est plus dans la salle passe son tour.
  if (!(singer in s.players)) return nextSinger(s, ctx);
  const ms = s.settings.pickSeconds * 1000;
  ctx.schedule(PICK_TIMEOUT, ms);
  return {
    ...s,
    phase: 'pick',
    song: null,
    clip: null,
    ratings: {},
    gains: {},
    average: null,
    abandoned: false,
    endsAt: ctx.now() + ms,
  };
}

function nextSinger(s: KaraokeState, ctx: GameContext): KaraokeState {
  clearTimers(ctx);
  if (s.index + 1 < s.order.length) return openPick({ ...s, index: s.index + 1 }, ctx);
  return finish(s, ctx);
}

function openSing(s: KaraokeState, song: KaraokeSong, ctx: GameContext): KaraokeState {
  ctx.cancel(PICK_TIMEOUT);
  const segment = s.settings.segmentSeconds * 1000;
  ctx.schedule(SING_TIMEOUT, segment + SING_GRACE_MS);
  return { ...s, phase: 'sing', song, endsAt: ctx.now() + segment };
}

function openReplay(s: KaraokeState, clip: string, ctx: GameContext): KaraokeState {
  ctx.cancel(SING_TIMEOUT);
  const segment = s.settings.segmentSeconds * 1000;
  ctx.schedule(REPLAY_NEXT, segment + REPLAY_PAUSE_MS);
  return { ...s, phase: 'replay', clip, endsAt: ctx.now() + segment };
}

function openVote(s: KaraokeState, ctx: GameContext): KaraokeState {
  ctx.cancel(SING_TIMEOUT);
  ctx.cancel(REPLAY_NEXT);
  // Seul le chanteur est encore là : personne à qui demander une note.
  if (listenersOf(s).length === 0) return reveal(s, ctx);
  const ms = VOTE_SECONDS * 1000;
  ctx.schedule(VOTE_TIMEOUT, ms);
  return { ...s, phase: 'vote', endsAt: ctx.now() + ms };
}

function reveal(s: KaraokeState, ctx: GameContext): KaraokeState {
  for (const key of [PICK_TIMEOUT, SING_TIMEOUT, REPLAY_NEXT, VOTE_TIMEOUT]) ctx.cancel(key);
  const values = Object.values(s.ratings);
  const average = values.length > 0 ? values.reduce((total, stars) => total + stars, 0) / values.length : null;
  const singer = singerOf(s);
  // Moyenne des étoiles : 10 points par étoile, 50 au maximum. Un passage sans note ne rapporte rien.
  const gained = average !== null && singer !== undefined ? Math.round(average * POINTS_PER_STAR) : 0;
  const gains: Record<string, number> = singer !== undefined && gained > 0 ? { [singer]: gained } : {};
  const points = singer !== undefined && gained > 0 ? addPoints(s.points, singer, gained) : s.points;
  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'reveal', points, gains, average, endsAt: ctx.now() + REVEAL_MS };
}

function noticeFor() {
  return {
    goal: 'Chanter un passage de chanson, à tour de rôle, avec l’écran principal.',
    steps: [
      'Le chanteur cherche une chanson sur YouTube, ou colle un lien, puis choisit le début du passage.',
      'Le passage joue sur l’écran principal : chantez avec.',
      'Le téléphone enregistre votre voix pendant le passage, 12 secondes au maximum.',
      'La voix est rejouée sur l’écran, pendant que le clip est muet. Les autres joueurs notent de 1 à 5 étoiles.',
      'Chaque étoile de moyenne vaut 10 points, soit 50 points au maximum.',
    ],
    tips: [
      'Le micro capte aussi la musique de la salle : tenez le téléphone près de la bouche.',
      'Les enregistrements ne sont pas conservés : chaque voix disparaît au passage suivant.',
      'Si la vidéo ne se lance pas, le passage est perdu. Choisissez une autre vidéo.',
    ],
  };
}

function publicView(s: KaraokeState) {
  const singer = singerOf(s);
  const base = {
    mode: 'karaoke' as const,
    phase: s.phase,
    kindLabel: 'Karaoké',
    prompt: 'Chantez à tour de rôle',
    name: s.name,
    icon: s.icon,
    index: s.index,
    total: s.order.length,
    playerCount: Object.keys(s.players).length,
    ranking: rankEntries(s.players, s.points),
    segmentSeconds: s.settings.segmentSeconds,
    singerName: singer !== undefined ? (s.players[singer] ?? '?') : '',
    song: s.song ? { title: s.song.title, channel: s.song.channel } : null,
    endsAt: s.endsAt,
  };

  if (s.phase === 'vote') {
    return {
      ...base,
      ratedCount: Object.keys(s.ratings).length,
      listenerCount: listenersOf(s).length,
    };
  }

  if (s.phase === 'reveal') {
    return {
      ...base,
      average: s.average,
      abandoned: s.abandoned,
      gained: singer !== undefined ? (s.gains[singer] ?? 0) : 0,
    };
  }

  return base;
}

/** Vue de l’écran principal seulement : la source du passage et la voix à rejouer ne vont jamais aux téléphones. */
function hostView(s: KaraokeState) {
  const singer = singerOf(s);
  const stage = s.phase === 'sing' ? 1 : s.phase === 'replay' ? 2 : 0;
  const pending =
    s.phase === 'pick' && singer !== undefined
      ? [s.players[singer] ?? '?']
      : s.phase === 'vote'
        ? listenersOf(s)
            .filter((id) => !(id in s.ratings))
            .map((id) => s.players[id] ?? '?')
        : [];
  // La clé change à chaque étape : le lecteur repart du début, en sonore puis en muet.
  const media =
    s.song && stage > 0
      ? {
          key: s.index * 3 + stage,
          source: { type: 'youtube' as const, videoId: s.song.videoId },
          startSec: s.song.startSec,
          durationSec: s.settings.segmentSeconds,
        }
      : null;
  return {
    media,
    muted: stage === 2,
    clip: s.phase === 'replay' ? s.clip : null,
    pending,
  };
}

export const karaoke: GameModule<KaraokeState, KaraokeSettings> = {
  manifest: {
    id: 'karaoke',
    name: 'Karaoké',
    description:
      'Cherchez une chanson sur YouTube et chantez un passage : l’écran le joue, votre voix est rejouée, et les autres notent.',
    icon: '🎤',
    category: 'quiz',
    version: '1.0.0',
    apiVersion: 1,
    // Il faut quelqu’un pour chanter et quelqu’un pour noter.
    minPlayers: 2,
    maxPlayers: 12,
    // Environ une minute par passage (choix, chant, rejeu, notes) : une partie à quatre dure à peu près cinq minutes.
    durationMin: 10,
    notice: noticeFor(),
  },

  settingsSchema: karaokeSettingsSchema,
  defaultSettings: karaokeSettingsSchema.parse({}),

  actions: {
    sing: singSchema,
    recording: recordingSchema,
    abandon: abandonSchema,
    rate: ratingSchema,
  },

  initialize(settings, players) {
    return {
      name: 'Karaoké',
      icon: '🎤',
      settings: karaokeSettingsSchema.parse(settings),
      phase: 'ready',
      order: [],
      index: 0,
      endsAt: 0,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      song: null,
      clip: null,
      ratings: {},
      gains: {},
      average: null,
      abandoned: false,
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
    if (Object.keys(s.players).length < 2) return fail('Il faut au moins deux joueurs');
    const order = shuffle(Object.keys(s.players), ctx.random);
    return ok(openPick({ ...s, order, index: 0 }, ctx));
  },

  handleAction(s, p, type, payload, ctx) {
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    const singer = singerOf(s);

    if (type === 'sing') {
      if (s.phase !== 'pick') return fail('Ce n’est pas le moment de choisir une chanson');
      if (p.id !== singer) return fail('Ce n’est pas votre tour de chanter');
      const parsed = singSchema.safeParse(payload);
      if (!parsed.success) return fail('Chanson invalide');
      return ok(openSing(s, parsed.data, ctx));
    }

    if (type === 'recording') {
      if (s.phase !== 'sing') return fail('L’enregistrement n’est pas attendu maintenant');
      if (p.id !== singer) return fail('Seul le chanteur envoie sa voix');
      const parsed = recordingSchema.safeParse(payload);
      if (!parsed.success) return fail('Enregistrement invalide');
      return ok(openReplay(s, parsed.data.dataUrl, ctx));
    }

    if (type === 'abandon') {
      if (s.phase !== 'sing') return fail('Rien à interrompre maintenant');
      if (p.id !== singer) return fail('Seul le chanteur peut passer son tour');
      // Passage interrompu : pas de vote sur une prestation qu’on n’a pas entendue en entier.
      return ok(reveal({ ...s, clip: null, abandoned: true }, ctx));
    }

    if (type === 'rate') {
      if (s.phase !== 'vote') return fail('Pas de note attendue maintenant');
      if (p.id === singer) return fail('Vous ne notez pas votre propre prestation');
      if (p.id in s.ratings) return fail('Note déjà enregistrée');
      const parsed = ratingSchema.safeParse(payload);
      if (!parsed.success) return fail('Note invalide');
      const next = { ...s, ratings: { ...s.ratings, [p.id]: parsed.data.stars } };
      const done = everyConnectedDone(ctx, listenersOf(s), (id) => id in next.ratings);
      return ok(done ? reveal(next, ctx) : next);
    }

    return fail('Action inconnue');
  },

  /** Robot (contrôle de lancement) : le chanteur choisit une chanson et envoie un son court, les autres notent. */
  suggest(s, playerId, random) {
    const singer = singerOf(s);
    if (s.phase === 'pick' && playerId === singer) {
      return {
        key: 'sing',
        type: 'sing',
        payload: { videoId: 'robotTest01', title: 'Chanson du robot', channel: '', startSec: 0 },
      };
    }
    if (s.phase === 'sing' && playerId === singer) {
      return { key: 'recording', type: 'recording', payload: { dataUrl: 'data:audio/webm;base64,AAAA' } };
    }
    if (s.phase === 'vote' && playerId !== singer && !(playerId in s.ratings)) {
      return { key: 'rate', type: 'rate', payload: { stars: 1 + Math.floor(random() * 5) } };
    }
    return null;
  },

  onTimer(s, key, ctx) {
    if (key === PICK_TIMEOUT && s.phase === 'pick') return reveal(s, ctx);
    if (key === SING_TIMEOUT && s.phase === 'sing') return openVote({ ...s, clip: null }, ctx);
    if (key === REPLAY_NEXT && s.phase === 'replay') return openVote(s, ctx);
    if (key === VOTE_TIMEOUT && s.phase === 'vote') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return nextSinger(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'pick') return reveal(s, ctx);
    if (s.phase === 'sing') return openVote({ ...s, clip: null }, ctx);
    if (s.phase === 'replay') return openVote(s, ctx);
    if (s.phase === 'vote') return reveal(s, ctx);
    if (s.phase === 'reveal') return nextSinger(s, ctx);
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
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      isSinger: singerOf(s) === playerId,
      myRating: s.ratings[playerId] ?? null,
      gained: s.phase === 'reveal' ? (s.gains[playerId] ?? 0) : null,
    };
  },

  getHostState(s) {
    return hostView(s);
  },

  isFinished(s) {
    return s.phase === 'final';
  },
};
