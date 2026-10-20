import { z } from 'zod';
import type { GameContext, GameJob, GameModule, JobOutcome, PlayerRef } from '@partyhub/shared';
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
/** Recherches et vérifications YouTube par passage : plafond, pour ménager le quota de l’API. */
const LOOKUPS_PER_TURN = 8;

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

/** Recherche de chanson : deux caractères au moins, 80 au plus (comme la zone de saisie). */
const searchSchema = z.object({ query: z.string().trim().min(2).max(80) });
const checkSchema = z.object({ videoId: z.string().regex(VIDEO_ID) });

/** Le chanteur arrête son passage (micro perdu, vidéo qui ne se lance pas) : aucun contenu à lire. */
const abandonSchema = z.object({}).strict();

export type KaraokePhase = 'ready' | 'pick' | 'sing' | 'replay' | 'vote' | 'reveal' | 'final';

export interface KaraokeSong {
  videoId: string;
  title: string;
  channel: string;
  startSec: number;
}

/** Résultat d’une recherche ou d’une vérification YouTube. Le serveur répond toujours, sans lever d’erreur. */
export type KaraokeLookup<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export interface KaraokeHit {
  videoId: string;
  title: string;
  channel: string;
}

export interface KaraokeVideo extends KaraokeHit {
  /** Durée en secondes ; null quand le serveur ne vérifie pas les vidéos (pas de clé). */
  durationSec: number | null;
}

/** Accès à YouTube, branché par le serveur : la clé reste chez lui. */
export interface KaraokeYoutube {
  search(query: string): Promise<KaraokeLookup<KaraokeHit[]>>;
  video(videoId: string): Promise<KaraokeLookup<KaraokeVideo>>;
}

let provider: KaraokeYoutube | null = null;

/** Le serveur branche ici son accès YouTube. Sans fournisseur, les recherches répondent « désactivé ». */
export function setKaraokeYoutube(next: KaraokeYoutube | null): void {
  provider = next;
}

/** Recherche ou vérification en attente, pour le chanteur d’un passage. */
interface KaraokeRequest {
  id: string;
  kind: 'youtube-search' | 'youtube-check';
  playerId: string;
  /** Passage où la demande a été faite : une réponse qui arrive après ce passage est ignorée. */
  turn: number;
  query: string | null;
  videoId: string | null;
}

/** Dernière réponse à un joueur : résultats, vidéo vérifiée (ou non vérifiée), ou erreur à afficher. */
export type KaraokeAnswer =
  | { kind: 'search'; hits: KaraokeHit[] }
  | { kind: 'check'; video: KaraokeVideo; unverified: boolean }
  | { kind: 'error'; message: string };

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
  /** Recherches et vérifications en attente, dans l’ordre : le serveur les traite une à une. */
  requests: KaraokeRequest[];
  /** Dernière réponse à chaque joueur. */
  answers: Record<string, KaraokeAnswer>;
  /** Recherches et vérifications faites pendant le passage en cours. */
  lookups: number;
  /** Numéro de la prochaine demande : identifiant unique dans la salle. */
  nextJob: number;
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
    requests: [],
    answers: {},
    lookups: 0,
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

/** Ajoute une demande à la file, et retire la réponse précédente de ce joueur. */
function queueLookup(s: KaraokeState, request: Omit<KaraokeRequest, 'id' | 'turn'>): KaraokeState {
  const answers = { ...s.answers };
  delete answers[request.playerId];
  return {
    ...s,
    nextJob: s.nextJob + 1,
    lookups: s.lookups + 1,
    requests: [...s.requests, { ...request, id: `yt-${s.nextJob}`, turn: s.index }],
    answers,
  };
}

/** Recherche ou vérification en cours pour ce joueur, s’il en a une. */
function pendingLookupOf(s: KaraokeState, playerId: string): 'search' | 'check' | null {
  const request = s.requests.find((r) => r.playerId === playerId);
  if (!request) return null;
  return request.kind === 'youtube-search' ? 'search' : 'check';
}

/** Transforme le résultat du serveur en réponse pour le joueur. Un résultat illisible devient une erreur. */
function answerOf(request: KaraokeRequest, outcome: JobOutcome): KaraokeAnswer {
  const unreachable: KaraokeAnswer = {
    kind: 'error',
    message: 'YouTube ne répond pas pour le moment. Réessayez dans un instant.',
  };
  if (!outcome.ok) return unreachable;
  const result = outcome.value as { ok?: unknown; value?: unknown; code?: unknown; message?: unknown } | null;
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') return unreachable;
  if (!result.ok) {
    // Pas de clé sur le serveur : un lien collé reste utilisable, sans durée connue (comme avant).
    if (request.kind === 'youtube-check' && request.videoId !== null && result.code === 'disabled') {
      const video: KaraokeVideo = {
        videoId: request.videoId,
        title: `Vidéo ${request.videoId}`,
        channel: '',
        durationSec: null,
      };
      return { kind: 'check', video, unverified: true };
    }
    return { kind: 'error', message: typeof result.message === 'string' ? result.message : 'La recherche a échoué.' };
  }
  if (request.kind === 'youtube-search') {
    return { kind: 'search', hits: Array.isArray(result.value) ? (result.value as KaraokeHit[]) : [] };
  }
  if (!result.value || typeof result.value !== 'object') return unreachable;
  return { kind: 'check', video: result.value as KaraokeVideo, unverified: false };
}

/** Travail YouTube de la salle : la recherche ou la vérification, faites par le serveur (clé incluse). */
export async function runKaraokeJob(job: GameJob): Promise<KaraokeLookup<unknown>> {
  if (!provider) {
    return {
      ok: false,
      code: 'disabled',
      message: 'YouTube n’est pas activé sur ce serveur. Demandez à l’administrateur.',
    };
  }
  const input = (job.input ?? {}) as { query?: unknown; videoId?: unknown };
  if (job.kind === 'youtube-search') return provider.search(String(input.query ?? ''));
  if (job.kind === 'youtube-check') return provider.video(String(input.videoId ?? ''));
  return { ok: false, code: 'unknown', message: 'Travail inconnu.' };
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
    search: searchSchema,
    check: checkSchema,
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
      requests: [],
      answers: {},
      lookups: 0,
      nextJob: 1,
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

    // Recherche et vérification YouTube : le chanteur seul, pendant le choix, une demande à la fois.
    if (type === 'search' || type === 'check') {
      if (s.phase !== 'pick') return fail('La recherche se fait pendant le choix de la chanson');
      if (p.id !== singer) return fail('Seul le chanteur cherche une chanson');
      if (s.requests.some((r) => r.playerId === p.id)) return fail('Une recherche est déjà en cours');
      if (s.lookups >= LOOKUPS_PER_TURN) {
        return fail('Trop de recherches pour ce passage. Choisissez parmi les résultats.');
      }
      if (type === 'search') {
        const parsed = searchSchema.safeParse(payload);
        if (!parsed.success) return fail('Tapez au moins deux caractères.');
        return ok(queueLookup(s, { kind: 'youtube-search', playerId: p.id, query: parsed.data.query, videoId: null }));
      }
      const parsed = checkSchema.safeParse(payload);
      if (!parsed.success) return fail('Ce lien ne correspond à aucune vidéo YouTube.');
      return ok(queueLookup(s, { kind: 'youtube-check', playerId: p.id, query: null, videoId: parsed.data.videoId }));
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

  pendingJob(s) {
    const request = s.requests[0];
    if (!request) return null;
    return {
      id: request.id,
      kind: request.kind,
      input: request.kind === 'youtube-search' ? { query: request.query } : { videoId: request.videoId },
    };
  },

  runJob: runKaraokeJob,

  completeJob(s, jobId: string, outcome: JobOutcome) {
    const request = s.requests.find((r) => r.id === jobId);
    if (!request) return s;
    const next: KaraokeState = { ...s, requests: s.requests.filter((r) => r.id !== jobId) };
    // Réponse tardive : le passage a changé, ou le choix est terminé.
    if (request.turn !== s.index || s.phase !== 'pick') return next;
    return { ...next, answers: { ...next.answers, [request.playerId]: answerOf(request, outcome) } };
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
      // Recherche ou vérification du chanteur : son téléphone attend la réponse, puis l’affiche.
      lookup: { pending: pendingLookupOf(s, playerId), answer: s.answers[playerId] ?? null },
    };
  },

  getHostState(s) {
    return hostView(s);
  },

  isFinished(s) {
    return s.phase === 'final';
  },
};
