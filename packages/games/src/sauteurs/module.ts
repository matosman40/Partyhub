import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { directory, fail, ok, rankEntries } from '../common/engine.js';
import { DEATH_TICKS, MAX_RUN_SPEED, PLAYER_HALF_WIDTH, TICKS_PER_SECOND } from './engine.js';
import { LEVELS, LEVEL_MAX_COINS } from './levels.js';

/**
 * Course des sauteurs : un jeu de plateforme où tous les joueurs courent en parallèle (fantômes les uns pour les
 * autres). Les téléphones envoient leurs commandes à l’écran principal ; c’est l’ÉCRAN PRINCIPAL qui fait tourner le
 * moteur (`engine.ts`) et qui déclare ensuite les RÉSULTATS au serveur par l’action d’hôte `level-result`.
 *
 * Le serveur ne simule rien : il VALIDE. Il refuse un joueur inconnu, un autre niveau que le niveau courant, une
 * arrivée plus rapide que la vitesse maximale du moteur le permet (ou plus rapide que le temps réellement écoulé),
 * une arrivée après la limite de temps, trop de pièces, un nombre de morts absurde, et un second envoi pour le même
 * joueur et le même niveau. Si l’hôte ne répond pas, `onTimer` clôt le niveau : les joueurs sans résultat n’arrivent pas.
 *
 * Déroulement : ready -> playing (compte à rebours de 3 s, puis course) -> between (bilan) -> … -> final.
 */

export const sauteursSettingsSchema = z.object({
  /** Nombre de niveaux joués à la suite (1 à 3). */
  levelCount: z.number().int().min(1).max(LEVELS.length).default(LEVELS.length),
  /** Niveau joué quand on n’en joue qu’un (1 à 3). Sans effet si plusieurs niveaux sont joués. */
  singleLevel: z.number().int().min(1).max(LEVELS.length).default(1),
});

export type SauteursSettings = z.infer<typeof sauteursSettingsSchema>;

/** Compte à rebours avant le départ, en millisecondes. */
export const COUNTDOWN_MS = 3000;
/** Marge accordée à l’hôte, après la limite du niveau, pour envoyer ses résultats. */
export const GRACE_MS = 10_000;
/** Pause sur le bilan d’un niveau. */
export const BETWEEN_MS = 7000;
/** Marge de latence : une arrivée peut précéder de ce délai le temps serveur écoulé (horloge de l’écran, réseau). */
export const ELAPSED_SLACK_MS = 3000;

/** Points selon l’ordre d’arrivée : 1er, 2e, 3e, 4e ; les suivants prennent la dernière valeur. */
export const PLACE_POINTS: readonly number[] = [100, 70, 50, 35];
export const FINISH_POINTS_DEFAULT = 20;
export const COIN_POINTS = 5;
export const DEATH_PENALTY = 10;

const LEVEL_END = 'level-end';
const BETWEEN_END = 'between-end';

export type SauteursPhase = 'ready' | 'playing' | 'between' | 'final';

export interface LevelEntry {
  finishTick: number | null;
  coins: number;
  deaths: number;
}

export interface LevelScore extends LevelEntry {
  /** Rang d’arrivée (1 = premier, ex æquo possibles), ou null pour qui n’est pas arrivé. */
  rank: number | null;
  /** Points du niveau, jamais sous 0. */
  points: number;
}

export interface SauteursState {
  phase: SauteursPhase;
  settings: SauteursSettings;
  players: Record<string, string>;
  /** Joueurs partis en cours de partie : ils gardent leurs points mais n’attendent plus rien. */
  left: string[];
  /** Indices (dans `LEVELS`) des niveaux joués, dans l’ordre. */
  sequence: number[];
  /** Position dans `sequence`. */
  step: number;
  /** Joueurs qui courent dans le niveau en cours (ceux présents à son départ). */
  expected: string[];
  /** Instant du départ (fin du compte à rebours), horloge serveur (ms epoch). 0 hors course. */
  startedAt: number;
  /** Instant où le garde-fou clôt le niveau. 0 hors course. */
  endsAt: number;
  betweenEndsAt: number;
  /** Résultats déclarés par l’hôte pour le niveau en cours. */
  submissions: Record<string, LevelEntry>;
  /** Résultats chiffrés, par niveau terminé (même ordre que `sequence`). */
  history: Record<string, LevelScore>[];
  points: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------
// Règles pures
// ---------------------------------------------------------------------------------------------

/**
 * Plus petit temps d’arrivée possible, en pas, pour un niveau : la distance entre le départ le plus à droite et
 * le premier fanion, à la vitesse maximale du moteur. Aucun joueur ne court plus vite : un temps inférieur est refusé.
 */
export function minFinishTicks(levelIndex: number): number {
  const level = LEVELS[levelIndex];
  if (!level) return 0;
  let flagCol = Infinity;
  let startMax = -Infinity;
  level.tiles.forEach((row) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === 'S') {
        startMax = Math.max(startMax, c + 0.5);
      }
      if (row[c] === 'F') flagCol = Math.min(flagCol, c);
    }
  });
  if (!Number.isFinite(startMax) || !Number.isFinite(flagCol)) return 0;
  const distance = Math.max(0, flagCol - PLAYER_HALF_WIDTH - startMax);
  return Math.max(1, Math.floor(distance / MAX_RUN_SPEED) - 1);
}

/** Limite de temps d’un niveau, en pas. */
export function maxFinishTicks(levelIndex: number): number {
  return Math.round((LEVELS[levelIndex]?.timeLimit ?? 0) * TICKS_PER_SECOND);
}

/** Nombre de morts au-delà duquel un résultat est absurde : une mort dure au moins `DEATH_TICKS` pas. */
export function maxDeaths(levelIndex: number): number {
  return Math.floor(maxFinishTicks(levelIndex) / DEATH_TICKS);
}

function placePoints(rank: number): number {
  return PLACE_POINTS[rank - 1] ?? FINISH_POINTS_DEFAULT;
}

/**
 * Points d’un niveau pour les joueurs donnés. Les arrivées sont classées par temps ; deux temps identiques
 * partagent le même rang (et les points de ce rang), le suivant saute d’autant (classement « en compétition »).
 */
export function scoreLevel(ids: string[], entries: Record<string, LevelEntry>): Record<string, LevelScore> {
  const out: Record<string, LevelScore> = {};
  const finishers = ids
    .filter((id) => entries[id]?.finishTick != null)
    .map((id) => ({ id, tick: entries[id]!.finishTick as number }))
    .sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  const rankOf = new Map<string, number>();
  for (const f of finishers) rankOf.set(f.id, 1 + finishers.filter((o) => o.tick < f.tick).length);
  for (const id of ids) {
    const e = entries[id] ?? { finishTick: null, coins: 0, deaths: 0 };
    const rank = rankOf.get(id) ?? null;
    const base = rank === null ? 0 : placePoints(rank);
    out[id] = { ...e, rank, points: Math.max(0, base + COIN_POINTS * e.coins - DEATH_PENALTY * e.deaths) };
  }
  return out;
}

const entrySchema = z.object({
  playerId: z.string().min(1).max(64),
  finishTick: z.number().int().nullable(),
  coins: z.number().int(),
  deaths: z.number().int(),
});

const levelResultSchema = z.object({
  levelIndex: z.number().int(),
  results: z.array(entrySchema).min(1).max(32),
});

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------

const activeIds = (s: SauteursState): string[] => s.expected.filter((id) => !s.left.includes(id));

const pendingIds = (s: SauteursState): string[] =>
  s.phase === 'playing' ? activeIds(s).filter((id) => !(id in s.submissions)) : [];

function levelIndexOf(s: SauteursState): number {
  return s.sequence[s.step] ?? 0;
}

function beginLevel(s: SauteursState, step: number, ctx: GameContext): SauteursState {
  ctx.cancel(BETWEEN_END);
  const levelIndex = s.sequence[step] ?? 0;
  const limitMs = (LEVELS[levelIndex]?.timeLimit ?? 0) * 1000;
  ctx.schedule(LEVEL_END, COUNTDOWN_MS + limitMs + GRACE_MS);
  const now = ctx.now();
  return {
    ...s,
    phase: 'playing',
    step,
    expected: Object.keys(s.players).filter((id) => !s.left.includes(id)),
    submissions: {},
    startedAt: now + COUNTDOWN_MS,
    endsAt: now + COUNTDOWN_MS + limitMs + GRACE_MS,
    betweenEndsAt: 0,
  };
}

/** Clôt le niveau : les joueurs sans résultat comptent comme non arrivés, puis le bilan s’affiche. */
function closeLevel(s: SauteursState, ctx: GameContext): SauteursState {
  ctx.cancel(LEVEL_END);
  ctx.schedule(BETWEEN_END, BETWEEN_MS);
  const scores = scoreLevel(s.expected, s.submissions);
  let points = s.points;
  for (const id of s.expected) points = { ...points, [id]: (points[id] ?? 0) + (scores[id]?.points ?? 0) };
  return {
    ...s,
    phase: 'between',
    points,
    history: [...s.history, scores],
    startedAt: 0,
    endsAt: 0,
    betweenEndsAt: ctx.now() + BETWEEN_MS,
  };
}

function advance(s: SauteursState, ctx: GameContext): SauteursState {
  ctx.cancel(BETWEEN_END);
  if (s.step + 1 < s.sequence.length) return beginLevel(s, s.step + 1, ctx);
  return finish(s, ctx);
}

function finish(s: SauteursState, ctx: GameContext): SauteursState {
  ctx.cancel(LEVEL_END);
  ctx.cancel(BETWEEN_END);
  return { ...s, phase: 'final', startedAt: 0, endsAt: 0, betweenEndsAt: 0 };
}

function sequenceOf(settings: SauteursSettings): number[] {
  if (settings.levelCount <= 1) return [Math.min(settings.singleLevel, LEVELS.length) - 1];
  return Array.from({ length: Math.min(settings.levelCount, LEVELS.length) }, (_, i) => i);
}

// ---------------------------------------------------------------------------------------------
// Vues
// ---------------------------------------------------------------------------------------------

function scoreRows(s: SauteursState, scores: Record<string, LevelScore> | undefined) {
  if (!scores) return [];
  return Object.keys(scores)
    .map((id) => ({ playerId: id, name: s.players[id] ?? '?', ...scores[id]! }))
    .sort(
      (a, b) =>
        (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.points - a.points || a.name.localeCompare(b.name, 'fr'),
    );
}

export const sauteurs: GameModule<SauteursState, SauteursSettings> = {
  manifest: {
    id: 'sauteurs',
    category: 'plateau',
    name: 'Course des sauteurs',
    description:
      'Courez, sautez, évitez les pièges et ramassez des pièces : le premier au drapeau gagne le plus de points.',
    icon: '🏃',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 8,
    durationMin: 6,
    notice: {
      goal: 'Atteindre le drapeau avant les autres, en ramassant des pièces et en évitant les pièges.',
      steps: [
        'Chaque niveau commence par un compte à rebours de trois secondes, puis tous les sauteurs partent en même temps.',
        'Le téléphone sert de manette : glissez à gauche ou à droite pour courir, maintenez le bouton pour sauter plus haut.',
        'Sautez sur les ennemis pour les écraser, évitez les pointes et le vide. Une chute vous ramène au dernier drapeau de contrôle.',
        'Points du niveau : 100 au premier, 70, 50, 35, puis 20 aux suivants, plus 5 par pièce, moins 10 par chute.',
        'Le total des niveaux désigne le vainqueur.',
      ],
      tips: [
        'Les joueurs ne se bloquent pas : courez sans craindre de gêner les autres.',
        'Arriver tard rapporte encore des points ; ne pas arriver ne rapporte que les pièces.',
        'Sur ordinateur, l’écran principal se joue aussi au clavier (flèches et espace).',
      ],
    },
  },

  settingsSchema: sauteursSettingsSchema,
  defaultSettings: sauteursSettingsSchema.parse({}),

  // Aucune action de joueur : les commandes passent par les capteurs, les résultats par l’hôte.
  actions: {},

  hostActions: {
    'level-result': levelResultSchema,
  },

  initialize(settings, players) {
    const parsed = sauteursSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      players: directory(players),
      left: [],
      sequence: sequenceOf(parsed),
      step: 0,
      expected: [],
      startedAt: 0,
      endsAt: 0,
      betweenEndsAt: 0,
      submissions: {},
      history: [],
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    // Un arrivant en cours de partie rejoint à partir du niveau suivant (il n’est pas dans `expected`).
    return {
      ...s,
      left: s.left.filter((id) => id !== p.id),
      players: { ...s.players, [p.id]: p.name },
      points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
    };
  },

  onPlayerLeave(s, p: PlayerRef) {
    if (s.phase === 'ready') {
      const players = { ...s.players };
      const points = { ...s.points };
      delete players[p.id];
      delete points[p.id];
      return { ...s, players, points };
    }
    // En cours de partie : le joueur garde son nom et ses points, mais plus rien n’attend sa réponse.
    if (!(p.id in s.players) || s.left.includes(p.id)) return s;
    return { ...s, left: [...s.left, p.id] };
  },

  start(s, ctx) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    if (Object.keys(s.players).length === 0) return fail('Aucun joueur');
    return ok(beginLevel({ ...s, history: [], step: 0 }, 0, ctx));
  },

  handleAction() {
    return fail('Les sauteurs se pilotent avec le téléphone, sans action à envoyer');
  },

  handleHostAction(s, type, payload, ctx) {
    if (type !== 'level-result') return fail('Action inconnue');
    if (s.phase !== 'playing') return fail('Aucune course en cours');
    const parsed = levelResultSchema.safeParse(payload);
    if (!parsed.success) return fail('Résultats invalides');
    const { levelIndex, results } = parsed.data;
    if (levelIndex !== levelIndexOf(s)) return fail('Ce n’est pas le niveau en cours');

    const elapsedMs = ctx.now() - s.startedAt;
    const minTicks = minFinishTicks(levelIndex);
    const maxTicks = maxFinishTicks(levelIndex);
    const coinsMax = LEVEL_MAX_COINS[levelIndex] ?? 0;
    const deathsMax = maxDeaths(levelIndex);

    const accepted: Record<string, LevelEntry> = {};
    // Tout ou rien par lot : un résultat refusé annule le lot. L’écran principal envoie un lot par joueur.
    for (const r of results) {
      const name = s.players[r.playerId];
      if (name === undefined) return fail('Joueur inconnu dans cette partie');
      if (!s.expected.includes(r.playerId)) return fail(`${name} ne court pas dans ce niveau`);
      if (r.playerId in s.submissions || r.playerId in accepted) {
        return fail(`Le résultat de ${name} a déjà été envoyé pour ce niveau`);
      }
      if (r.finishTick !== null) {
        if (r.finishTick < minTicks) return fail(`Temps d’arrivée de ${name} impossible : trop rapide`);
        if (r.finishTick > maxTicks) return fail(`Temps d’arrivée de ${name} au-delà de la limite du niveau`);
        if ((r.finishTick * 1000) / TICKS_PER_SECOND > elapsedMs + ELAPSED_SLACK_MS) {
          return fail(`Temps d’arrivée de ${name} supérieur au temps écoulé`);
        }
      }
      if (r.coins < 0 || r.coins > coinsMax) return fail(`Nombre de pièces de ${name} impossible`);
      if (r.deaths < 0 || r.deaths > deathsMax) return fail(`Nombre de chutes de ${name} impossible`);
      accepted[r.playerId] = { finishTick: r.finishTick, coins: r.coins, deaths: r.deaths };
    }

    const next: SauteursState = { ...s, submissions: { ...s.submissions, ...accepted } };
    return ok(pendingIds(next).length === 0 ? closeLevel(next, ctx) : next);
  },

  onTimer(s, key, ctx) {
    if (key === LEVEL_END && s.phase === 'playing') return closeLevel(s, ctx);
    if (key === BETWEEN_END && s.phase === 'between') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'playing') return closeLevel(s, ctx);
    if (s.phase === 'between') return advance(s, ctx);
    return s;
  },

  calculateScores(s) {
    return rankEntries(s.players, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  getPublicState(s) {
    const levelIndex = levelIndexOf(s);
    const level = LEVELS[levelIndex];
    const active = s.phase === 'playing' || s.phase === 'between';
    const finishers = Object.entries(s.submissions)
      .filter(([, e]) => e.finishTick !== null)
      .sort((a, b) => (a[1].finishTick as number) - (b[1].finishTick as number) || a[0].localeCompare(b[0]));
    const last = s.history[s.history.length - 1];
    return {
      phase: s.phase,
      step: s.step + 1,
      levelCount: s.sequence.length,
      levelIndex: active ? levelIndex : null,
      level:
        active && level ? { id: level.id, name: level.name, theme: level.theme, timeLimit: level.timeLimit } : null,
      countdownMs: COUNTDOWN_MS,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      betweenEndsAt: s.betweenEndsAt,
      players: Object.entries(s.players).map(([id, name]) => ({ id, name, left: s.left.includes(id) })),
      pending: pendingIds(s).map((id) => s.players[id] ?? '?'),
      submitted: Object.keys(s.submissions),
      // Ordre d’arrivée du niveau en cours (identifiants), du premier au dernier.
      arrivalOrder: finishers.map(([id]) => id),
      // Bilan du dernier niveau terminé, visible pendant la pause.
      levelResults: s.phase === 'between' ? scoreRows(s, last) : null,
      // Points gagnés par niveau : un tableau par niveau terminé.
      levelPoints: s.history.map((scores, i) => ({
        levelIndex: s.sequence[i] ?? 0,
        points: Object.fromEntries(Object.entries(scores).map(([id, sc]) => [id, sc.points])),
      })),
      points: s.points,
      ranking: rankEntries(s.players, s.points),
    };
  },

  getPlayerState(s, playerId) {
    const sub = s.submissions[playerId];
    const last = s.history[s.history.length - 1]?.[playerId];
    return {
      submitted: Boolean(sub),
      mine: s.phase === 'between' ? (last ?? null) : null,
      points: s.points[playerId] ?? 0,
      racing: s.phase === 'playing' && s.expected.includes(playerId) && !s.left.includes(playerId),
    };
  },

  getHostState(s) {
    return {
      pending: pendingIds(s).map((id) => s.players[id] ?? '?'),
      pendingIds: pendingIds(s),
      expected: s.expected,
      levelIndex: levelIndexOf(s),
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },
};
