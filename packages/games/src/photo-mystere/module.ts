import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';
import { addPoints, everyConnectedDone, fail, ok, rankEntries, shuffle } from '../common/engine.js';
import { PHOTOS, type Photo } from './photos.js';

/**
 * Photo mystère : une photo de lieu s’affiche, chaque joueur place un point sur la carte du monde depuis son
 * téléphone. À la révélation, la distance à la bonne place rapporte des points : plus on est proche, plus on gagne.
 * Ce fichier contient les règles ; il est pur, sans accès réseau ni horloge autre que `ctx`.
 */

export const photoSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(10).default(5),
  guessSeconds: z.number().int().min(20).max(180).default(90),
});

export type PhotoSettings = z.infer<typeof photoSettingsSchema>;

export const pinSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export type Pin = z.infer<typeof pinSchema>;

/** Points au maximum (pile sur la bonne place) et échelle de décroissance, en kilomètres. */
export const MAX_POINTS = 5000;
export const SCALE_KM = 1500;

const GUESS_TIMEOUT = 'guess-timeout';
const REVEAL_NEXT = 'reveal-next';
const REVEAL_DELAY_MS = 12_000;

export interface Placement {
  pin: Pin | null;
  /** Distance à la bonne place, arrondie au kilomètre. Null sans pin. */
  km: number | null;
  gained: number;
}

export interface RoundRecord {
  photoId: string;
  placements: Record<string, Placement>;
}

export interface PhotoState {
  settings: PhotoSettings;
  phase: 'ready' | 'guess' | 'reveal' | 'final';
  names: Record<string, string>;
  /** Photos tirées pour cette partie. Elles portent les coordonnées : aucune vue ne les expose avant révélation. */
  photos: Photo[];
  index: number;
  pins: Record<string, Pin>;
  guessEndsAt: number;
  points: Record<string, number>;
  rounds: RoundRecord[];
}

/** Distance du grand cercle entre deux points, en kilomètres (formule de Haversine). */
export function distanceKm(a: Pin, b: Pin): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points d’une manche selon la distance : décroissance exponentielle, 5 000 pile sur la cible. */
export function pointsFor(km: number): number {
  return Math.round(MAX_POINTS * Math.exp(-km / SCALE_KM));
}

function pickPhotos(count: number, random: () => number): Photo[] {
  return shuffle(PHOTOS, random).slice(0, Math.min(count, PHOTOS.length));
}

function beginRound(s: PhotoState, ctx: GameContext): PhotoState {
  const limit = s.settings.guessSeconds * 1000;
  ctx.schedule(GUESS_TIMEOUT, limit);
  return { ...s, phase: 'guess', pins: {}, guessEndsAt: ctx.now() + limit };
}

function reveal(s: PhotoState, ctx: GameContext): PhotoState {
  ctx.cancel(GUESS_TIMEOUT);
  const photo = s.photos[s.index];
  if (!photo) return finish(s, ctx);

  const target: Pin = { lat: photo.lat, lon: photo.lon };
  let points = { ...s.points };
  const placements: Record<string, Placement> = {};
  for (const id of Object.keys(s.names)) {
    const pin = s.pins[id] ?? null;
    if (!pin) {
      placements[id] = { pin: null, km: null, gained: 0 };
      continue;
    }
    const d = distanceKm(pin, target);
    const gained = pointsFor(d);
    placements[id] = { pin, km: Math.round(d), gained };
    points = addPoints(points, id, gained);
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_DELAY_MS);
  return {
    ...s,
    phase: 'reveal',
    points,
    rounds: [...s.rounds, { photoId: photo.id, placements }],
  };
}

function advance(s: PhotoState, ctx: GameContext): PhotoState {
  ctx.cancel(REVEAL_NEXT);
  if (s.index + 1 < s.photos.length) return beginRound({ ...s, index: s.index + 1 }, ctx);
  return finish(s, ctx);
}

function finish(s: PhotoState, ctx: GameContext): PhotoState {
  ctx.cancel(GUESS_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  return { ...s, phase: 'final' };
}

function currentRound(s: PhotoState): RoundRecord | undefined {
  return s.rounds[s.rounds.length - 1];
}

export const photoMystere: GameModule<PhotoState, PhotoSettings> = {
  manifest: {
    id: 'photo-mystere',
    category: 'quiz',
    name: 'Photo mystère',
    description: 'Une photo, une carte du monde : placez le point où la photo a été prise.',
    icon: '📸',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 10,
    notice: {
      goal: 'Retrouver, sur la carte du monde, le lieu où une photo a été prise.',
      steps: [
        'Regardez la photo dans le viseur, sur l’écran principal et sur votre téléphone.',
        'Touchez la carte à l’endroit où vous pensez que la photo a été prise.',
        'Vous pouvez déplacer votre point jusqu’à la fin du délai.',
        'À la révélation, chacun gagne des points selon la distance : 5 000 points pile sur la bonne place, un peu moins à chaque kilomètre.',
      ],
      tips: [
        'Les lieux sont des monuments, des villes et des paysages connus.',
        'Un point près du bon continent vaut déjà des points.',
      ],
    },
  },

  settingsSchema: photoSettingsSchema,
  defaultSettings: photoSettingsSchema.parse({}),

  actions: {
    place: pinSchema,
  },

  initialize(settings, players, ctx) {
    const parsed = photoSettingsSchema.parse(settings);
    return {
      settings: parsed,
      phase: 'ready',
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      photos: pickPhotos(parsed.rounds, ctx.random),
      index: 0,
      pins: {},
      guessEndsAt: 0,
      points: {},
      rounds: [],
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    return { ...s, names: { ...s.names, [p.id]: p.name } };
  },

  onPlayerLeave(s, p: PlayerRef, ctx) {
    const names = { ...s.names };
    delete names[p.id];
    const next = { ...s, names };
    // Le départ d’un joueur ne doit pas bloquer la manche : si les autres ont tous placé, on révèle.
    if (next.phase === 'guess' && everyConnectedDone(ctx, Object.keys(next.names), (id) => id in next.pins)) {
      return reveal(next, ctx);
    }
    return next;
  },

  start(s, ctx): GameResult<PhotoState> {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (s.photos.length === 0) return fail('Aucune photo disponible');
    return ok(beginRound(s, ctx));
  },

  handleAction(s, p, type, payload, ctx): GameResult<PhotoState> {
    if (type !== 'place') return fail('Action inconnue');
    if (s.phase !== 'guess') return fail('Pas de lieu à deviner pour le moment');
    if (!(p.id in s.names)) return fail('Joueur inconnu');
    const pin = payload as Pin;
    const next: PhotoState = { ...s, pins: { ...s.pins, [p.id]: { lat: pin.lat, lon: pin.lon } } };
    const everyoneDone = everyConnectedDone(ctx, Object.keys(next.names), (id) => id in next.pins);
    return ok(everyoneDone ? reveal(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === GUESS_TIMEOUT && s.phase === 'guess') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'guess') return reveal(s, ctx);
    if (s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  calculateScores(s): ScoreEntry[] {
    return rankEntries(s.names, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  // Vue publique : la photo, l’avancement et, seulement à la révélation, la bonne place et les pins de chacun.
  getPublicState(s) {
    const photo = s.photos[s.index];
    const revealed = s.phase === 'reveal';
    const round = currentRound(s);
    const showPhoto = photo && (s.phase === 'guess' || s.phase === 'reveal');
    return {
      phase: s.phase,
      round: s.index + 1,
      total: s.photos.length,
      guessSeconds: s.settings.guessSeconds,
      endsAt: s.phase === 'guess' ? s.guessEndsAt : undefined,
      photo: showPhoto ? { src: photo.file } : null,
      placedCount: Object.keys(s.pins).length,
      playerCount: Object.keys(s.names).length,
      answer:
        revealed && photo
          ? {
              lat: photo.lat,
              lon: photo.lon,
              place: photo.place,
              country: photo.country,
              credit: photo.credit,
              license: photo.license,
              source: photo.source,
            }
          : null,
      placements:
        revealed && round
          ? Object.keys(s.names).map((id) => ({
              playerId: id,
              name: s.names[id] ?? '?',
              pin: round.placements[id]?.pin ?? null,
              km: round.placements[id]?.km ?? null,
              gained: round.placements[id]?.gained ?? 0,
            }))
          : [],
      ranking: rankEntries(s.names, s.points),
    };
  },

  // Vue privée : le point du joueur, jamais ceux des autres avant la révélation.
  getPlayerState(s, playerId) {
    const round = currentRound(s);
    const mine = s.phase === 'reveal' && round ? round.placements[playerId] : undefined;
    const rank = rankEntries(s.names, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      myPin: s.pins[playerId] ?? null,
      placed: playerId in s.pins,
      points: s.points[playerId] ?? 0,
      rank,
      km: mine ? mine.km : null,
      gained: mine ? mine.gained : null,
    };
  },

  getHostState(s) {
    return {
      pending:
        s.phase === 'guess'
          ? Object.keys(s.names)
              .filter((id) => !(id in s.pins))
              .map((id) => s.names[id])
          : [],
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  // Mode test : un robot pose son point au hasard, après une attente qui laisse le temps de le voir.
  suggest(s, playerId, random) {
    if (s.phase !== 'guess' || playerId in s.pins) return null;
    return {
      type: 'place',
      payload: { lat: -60 + random() * 130, lon: -170 + random() * 340 },
      key: `place-${s.index}-${playerId}`,
      delayMs: 2000 + random() * 4000,
    };
  },
};
