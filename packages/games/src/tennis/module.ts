import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, fail, ok, rankEntries } from '../common/engine.js';
import { SIDES } from './rules.js';

/**
 * Tennis party : chaque joueur défend un côté du terrain avec sa raquette, pilotée par l’inclinaison de son
 * téléphone. L’écran principal fait jouer la balle (voir `rules.ts`) et signale chaque coup réussi et chaque balle
 * perdue. Le serveur tient les vies et les points, et ne croit une balle perdue ou un coup que s’il vise un côté
 * occupé par un joueur vivant.
 *
 * Une partie s’arrête quand un seul joueur reste debout, ou au bout de `MATCH_MS`. Tous les survivants gagnent
 * cinq points par vie restante, et le dernier debout gagne une prime.
 */

export const tennisSettingsSchema = z.object({
  /** Vies de chaque joueur : une balle perdue en coûte une. */
  lives: z.number().int().min(1).max(5).default(3),
});

export type TennisSettings = z.infer<typeof tennisSettingsSchema>;

/** Points : un coup réussi, une vie restante en fin de partie, la prime du dernier debout. */
export const HIT_POINTS = 10;
const LIFE_POINTS = 5;
const SURVIVOR_POINTS = 50;
/** Durée maximale d’une partie. */
export const MATCH_MS = 150_000;
const MATCH_END = 'match-end';
/** Écart minimal entre deux coups comptés sur un même côté : évite qu’un rebond compte deux fois. */
const HIT_GAP_MS = 60;

export type TennisPhase = 'ready' | 'play' | 'final';

export interface TennisState {
  phase: TennisPhase;
  settings: TennisSettings;
  players: Record<string, string>;
  points: Record<string, number>;
  /** Joueur de chaque côté (bas, haut, gauche, droite), ou null si le côté est libre. */
  seats: (string | null)[];
  lives: Record<string, number>;
  /** Ordre d’élimination, du premier éliminé au dernier. */
  eliminated: string[];
  /** Instant du dernier coup compté, par côté. */
  lastHitAt: number[];
  endsAt: number;
}

const sideSchema = z.object({ side: z.number().int().min(0).max(3) });

function isAlive(s: TennisState, id: string | null): boolean {
  return id !== null && (s.lives[id] ?? 0) > 0;
}

function aliveIds(s: TennisState): string[] {
  return s.seats.filter((id): id is string => isAlive(s, id));
}

/** Clôt la partie : bonus de vies restantes pour les survivants, prime pour le dernier debout. */
function finish(s: TennisState, ctx: GameContext): TennisState {
  ctx.cancel(MATCH_END);
  const survivors = aliveIds(s);
  let points = s.points;
  for (const id of survivors) points = addPoints(points, id, (s.lives[id] ?? 0) * LIFE_POINTS);
  if (survivors.length === 1 && survivors[0]) points = addPoints(points, survivors[0], SURVIVOR_POINTS);
  return { ...s, phase: 'final', points, endsAt: 0 };
}

export const tennisParty: GameModule<TennisState, TennisSettings> = {
  manifest: {
    id: 'tennis-party',
    category: 'plateau',
    name: 'Tennis party',
    description: 'Défendez votre côté du court : penchez le téléphone pour renvoyer la balle.',
    icon: '🎾',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 4,
    durationMin: 3,
    notice: {
      goal: 'Renvoyer la balle le plus souvent possible, et garder ses vies jusqu’au bout.',
      steps: [
        'Chaque joueur défend un côté du court, sur l’écran principal. Deux joueurs se font face, bas contre haut.',
        'Penchez le téléphone pour glisser votre raquette le long de votre côté. Les boutons de l’écran font la même chose.',
        'Renvoyez la balle : chaque coup rapporte des points. Une balle que vous ne touchez pas vous coûte une vie.',
        'Le dernier joueur debout gagne une prime. La partie dure au plus deux minutes et demie.',
      ],
      tips: [
        'L’inclinaison demande HTTPS sur le réseau local (voir la page « Test des appareils »).',
        'Tenez le téléphone comme au départ : « Recentrer » reprend cette pose. Sans capteur, les boutons suffisent.',
        'Un joueur sans téléphone, ou un robot, est joué par l’écran principal.',
      ],
    },
  },

  settingsSchema: tennisSettingsSchema,
  defaultSettings: tennisSettingsSchema.parse({}),

  // Les joueurs ne déclenchent aucune action : leur raquette passe par le relais des capteurs.
  actions: {},

  initialize(settings, players) {
    const parsed = tennisSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      seats: SIDES.map(() => null),
      lives: {},
      eliminated: [],
      lastHitAt: SIDES.map(() => 0),
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
    const ids = Object.keys(s.players);
    if (ids.length < 2) return fail('Il faut au moins deux joueurs');
    // Les premiers joueurs prennent les côtés dans l’ordre : deux joueurs se font face (bas, haut).
    const seats: (string | null)[] = SIDES.map((_, i) => ids[i] ?? null);
    const lives = Object.fromEntries(ids.map((id) => [id, s.settings.lives]));
    ctx.schedule(MATCH_END, MATCH_MS);
    return ok({ ...s, phase: 'play', seats, lives, endsAt: ctx.now() + MATCH_MS });
  },

  handleAction(_s, _p, type) {
    return fail(`Action inconnue : ${type}`);
  },

  hostActions: {
    hit: sideSchema,
    lost: sideSchema,
  },

  handleHostAction(s, type, payload, ctx) {
    if (type !== 'hit' && type !== 'lost') return fail('Action inconnue');
    const parsed = sideSchema.safeParse(payload);
    if (!parsed.success) return fail('Côté invalide');
    const side = parsed.data.side;
    // Un événement arrivé après la fin de la partie, ou pour un côté libre ou éliminé, ne change rien.
    if (s.phase !== 'play') return ok(s);
    const id = s.seats[side] ?? null;
    if (!isAlive(s, id) || id === null) return ok(s);

    if (type === 'hit') {
      const now = ctx.now();
      if (now - (s.lastHitAt[side] ?? 0) < HIT_GAP_MS) return ok(s);
      const lastHitAt = s.lastHitAt.map((t, i) => (i === side ? now : t));
      return ok({
        ...s,
        points: addPoints(s.points, id, HIT_POINTS),
        lastHitAt,
      });
    }

    const remaining = (s.lives[id] ?? 0) - 1;
    const lives = { ...s.lives, [id]: remaining };
    const next: TennisState = {
      ...s,
      lives,
      eliminated: remaining === 0 ? [...s.eliminated, id] : s.eliminated,
    };
    return ok(aliveIds(next).length <= 1 ? finish(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === MATCH_END && s.phase === 'play') return finish(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    return s.phase === 'play' ? finish(s, ctx) : s;
  },

  calculateScores(s) {
    return rankEntries(s.players, s.points);
  },

  end(s, ctx) {
    return s.phase === 'final' ? s : finish(s, ctx);
  },

  getPublicState(s) {
    return {
      phase: s.phase,
      lives: s.settings.lives,
      matchMs: MATCH_MS,
      endsAt: s.endsAt,
      seats: SIDES.map((side) => {
        const id = s.seats[side] ?? null;
        return {
          side,
          playerId: id,
          name: id ? (s.players[id] ?? '?') : null,
          lives: id ? (s.lives[id] ?? 0) : 0,
          points: id ? (s.points[id] ?? 0) : 0,
          alive: isAlive(s, id),
        };
      }),
      ranking: rankEntries(s.players, s.points),
    };
  },

  getPlayerState(s, playerId) {
    const index = s.seats.indexOf(playerId);
    return {
      side: index >= 0 ? index : null,
      alive: isAlive(s, playerId),
      lives: s.lives[playerId] ?? 0,
      points: s.points[playerId] ?? 0,
    };
  },

  getHostState() {
    return {};
  },

  isFinished(s) {
    return s.phase === 'final';
  },
};
