import { z } from 'zod';
import type {
  GameContext,
  GameManifest,
  GameModule,
  GameNotice,
  GameResult,
  PlayerRef,
  ScoreEntry,
} from '@partyhub/shared';
import { directory, everyConnectedDone, fail, ok, rankEntries } from '../common/engine.js';
import { seedFrom } from './rng.js';

/**
 * Jeux solo : chacun joue sa propre grille sur son téléphone ou sa tablette, et l’écran
 * principal affiche la progression et le classement en direct. Tous les joueurs reçoivent
 * la même grille (même graine), et le classement se fait sur le temps de résolution.
 *
 * Un jeu solo ne fournit que ses règles, via une `SoloEngine` : création de la grille,
 * coup, progression, victoire. Le reste (temps, classement, minuteur) est commun.
 */

export interface SoloEngine<B> {
  /** Réglages propres au jeu, ajoutés au temps limite commun. */
  extraSettings: z.ZodRawShape;
  /** Schéma d’un coup envoyé par le joueur. */
  playSchema: z.ZodTypeAny;
  create(seed: number, settings: Record<string, unknown>): B;
  play(board: B, payload: any): GameResult<B>;
  progress(board: B): number;
  solved(board: B): boolean;
  /** Vue du joueur : ce qu’il voit sur son écran, sans la solution. */
  view(board: B): unknown;
}

export interface SoloOptions<B> {
  id: string;
  name: string;
  icon: string;
  description: string;
  durationMin: number;
  notice: GameNotice;
  engine: SoloEngine<B>;
}

export interface SoloState<B = any> {
  id: string;
  name: string;
  icon: string;
  phase: 'ready' | 'play' | 'final';
  seed: number;
  settings: Record<string, unknown> & { timeLimitSec: number };
  startedAt: number;
  endsAt: number;
  players: Record<string, string>;
  boards: Record<string, B>;
  /** Temps de résolution, en millisecondes, pour les joueurs qui ont fini. */
  doneMs: Record<string, number>;
  moves: Record<string, number>;
}

const LIMIT_TIMER = 'solo-limit';
const MAX_POINTS = 100;
const MIN_POINTS = 20;

function pointsFor(rankAmongFinished: number): number {
  return Math.max(MIN_POINTS, MAX_POINTS - (rankAmongFinished - 1) * 10);
}

export function createSoloGame<B>(opts: SoloOptions<B>): GameModule<SoloState<B>, Record<string, unknown>> {
  const { engine } = opts;
  const settingsSchema = z.object({
    timeLimitSec: z.number().int().min(0).max(3600).default(0),
    ...engine.extraSettings,
  });
  type Settings = z.infer<typeof settingsSchema>;

  const manifest: GameManifest = {
    id: opts.id,
    category: 'solo',
    name: opts.name,
    description: opts.description,
    icon: opts.icon,
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 8,
    durationMin: opts.durationMin,
    notice: opts.notice,
  };

  function standings(s: SoloState<B>) {
    const rows = Object.keys(s.players).map((id) => {
      const board = s.boards[id];
      const done = id in s.doneMs;
      return {
        playerId: id,
        name: s.players[id] ?? '?',
        percent: board ? Math.round(engine.progress(board) * 100) : 0,
        done,
        elapsedMs: done ? s.doneMs[id]! : null,
        moves: s.moves[id] ?? 0,
      };
    });
    rows.sort((a, b) => {
      if (a.done !== b.done) return a.done ? -1 : 1;
      if (a.done && b.done) return a.elapsedMs! - b.elapsedMs!;
      return b.percent - a.percent || a.name.localeCompare(b.name, 'fr');
    });
    return rows;
  }

  function scores(s: SoloState<B>): ScoreEntry[] {
    const finished = Object.keys(s.doneMs).sort((a, b) => s.doneMs[a]! - s.doneMs[b]!);
    const points: Record<string, number> = Object.fromEntries(Object.keys(s.players).map((id) => [id, 0]));
    finished.forEach((id, i) => {
      points[id] = pointsFor(i + 1);
    });
    return rankEntries(s.players, points);
  }

  function finish(s: SoloState<B>, ctx: GameContext): SoloState<B> {
    ctx.cancel(LIMIT_TIMER);
    return { ...s, phase: 'final' };
  }

  return {
    manifest,
    settingsSchema,
    defaultSettings: settingsSchema.parse({}),
    actions: {
      play: z.object({}).passthrough(),
    },

    initialize(settings, players: PlayerRef[], ctx) {
      const parsed = settingsSchema.parse(settings) as Settings;
      return {
        id: opts.id,
        name: opts.name,
        icon: opts.icon,
        phase: 'ready',
        seed: seedFrom(ctx.random),
        settings: parsed as SoloState<B>['settings'],
        startedAt: 0,
        endsAt: 0,
        players: directory(players),
        boards: {},
        doneMs: {},
        moves: {},
      };
    },

    onPlayerJoin(s, p: PlayerRef) {
      if (s.phase !== 'ready') return s;
      return { ...s, players: { ...s.players, [p.id]: p.name } };
    },

    onPlayerLeave(s, p: PlayerRef) {
      if (s.phase !== 'ready') return s;
      const players = { ...s.players };
      delete players[p.id];
      return { ...s, players };
    },

    start(s, ctx) {
      if (s.phase !== 'ready') return fail('La partie a déjà commencé');
      if (Object.keys(s.players).length === 0) return fail('Aucun joueur dans la salle');
      const boards: Record<string, B> = {};
      for (const id of Object.keys(s.players)) {
        boards[id] = engine.create(s.seed, s.settings);
      }
      const limitMs = s.settings.timeLimitSec * 1000;
      if (limitMs > 0) ctx.schedule(LIMIT_TIMER, limitMs);
      return ok({
        ...s,
        phase: 'play',
        boards,
        startedAt: ctx.now(),
        endsAt: limitMs > 0 ? ctx.now() + limitMs : 0,
      });
    },

    handleAction(s, p, type, payload, ctx) {
      if (type !== 'play') return fail('Action inconnue');
      if (s.phase !== 'play') return fail('La partie n’est pas en cours');
      const board = s.boards[p.id];
      if (!board) return fail('Joueur inconnu dans cette partie');
      if (p.id in s.doneMs) return fail('Grille déjà résolue');

      const parsed = engine.playSchema.safeParse(payload);
      if (!parsed.success) return fail('Coup invalide');
      const result = engine.play(board, parsed.data);
      if (!result.ok) return fail(result.error);

      const next: SoloState<B> = {
        ...s,
        boards: { ...s.boards, [p.id]: result.state },
        moves: { ...s.moves, [p.id]: (s.moves[p.id] ?? 0) + 1 },
      };
      if (engine.solved(result.state)) {
        next.doneMs = { ...s.doneMs, [p.id]: Math.max(0, ctx.now() - s.startedAt) };
        const everyone = everyConnectedDone(ctx, Object.keys(next.players), (id) => id in next.doneMs);
        if (everyone) return ok(finish(next, ctx));
      }
      return ok(next);
    },

    onTimer(s, key, ctx) {
      if (key === LIMIT_TIMER && s.phase === 'play') return finish(s, ctx);
      return s;
    },

    nextRound(s, ctx) {
      return s.phase === 'play' ? finish(s, ctx) : s;
    },

    calculateScores(s) {
      return scores(s);
    },

    end(s, ctx) {
      return finish(s, ctx);
    },

    getPublicState(s) {
      return {
        game: opts.id,
        name: s.name,
        icon: s.icon,
        phase: s.phase,
        playerCount: Object.keys(s.players).length,
        endsAt: s.endsAt,
        limitMs: s.settings.timeLimitSec * 1000,
        standings: standings(s),
        ranking: scores(s),
      };
    },

    getPlayerState(s, playerId) {
      const board = s.boards[playerId];
      const entry = scores(s).find((e) => e.playerId === playerId);
      return {
        board: board ? engine.view(board) : null,
        percent: board ? Math.round(engine.progress(board) * 100) : 0,
        done: playerId in s.doneMs,
        elapsedMs: s.doneMs[playerId] ?? null,
        moves: s.moves[playerId] ?? 0,
        points: entry?.points ?? 0,
        rank: entry?.rank ?? null,
      };
    },

    getHostState() {
      return {};
    },

    isFinished(s) {
      return s.phase === 'final';
    },
  };
}
