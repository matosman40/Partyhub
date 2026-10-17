import { z } from 'zod';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, everyConnectedDone, fail, ok, rankEntries } from '../common/engine.js';

/**
 * Réflexe : l’écran passe au rouge (« attendez »), puis au vert au bout d’un
 * délai aléatoire. Le premier à toucher son téléphone marque le plus de points.
 * Toucher pendant le rouge = faux départ : aucun point pour cette manche.
 * Les temps de réaction sont mesurés par le serveur, jamais par le navigateur.
 */

export const reflexeSettingsSchema = z.object({
  rounds: z.number().int().min(1).max(15).default(5),
});

export type ReflexeSettings = z.infer<typeof reflexeSettingsSchema>;

const WAIT_MIN_MS = 2000;
const WAIT_SPREAD_MS = 3000;
const GO_MS = 5000;
const REVEAL_MS = 3500;
/** Points selon le classement de la manche : 1er, 2e, 3e… */
const PLACE_POINTS = [100, 70, 50, 30, 20, 10];

const SIGNAL = 'signal';
const GO_TIMEOUT = 'go-timeout';
const REVEAL_NEXT = 'reveal-next';

export type ReflexePhase = 'ready' | 'wait' | 'go' | 'reveal' | 'final';

export interface ReflexeState {
  phase: ReflexePhase;
  settings: ReflexeSettings;
  round: number;
  total: number;
  players: Record<string, string>;
  points: Record<string, number>;
  /** Temps de réaction en ms depuis le signal vert, par joueur. */
  reactions: Record<string, number>;
  falseStarts: string[];
  greenAt: number;
  gains: Record<string, number>;
  endsAt: number;
}

function hasActed(s: ReflexeState, id: string): boolean {
  return id in s.reactions || s.falseStarts.includes(id);
}

function openWait(s: ReflexeState, ctx: GameContext): ReflexeState {
  ctx.cancel(GO_TIMEOUT);
  ctx.cancel(REVEAL_NEXT);
  ctx.schedule(SIGNAL, WAIT_MIN_MS + Math.floor(ctx.random() * WAIT_SPREAD_MS));
  return {
    ...s,
    phase: 'wait',
    reactions: {},
    falseStarts: [],
    gains: {},
    greenAt: 0,
    endsAt: 0,
  };
}

function goSignal(s: ReflexeState, ctx: GameContext): ReflexeState {
  if (s.phase !== 'wait') return s;
  ctx.cancel(SIGNAL);
  ctx.schedule(GO_TIMEOUT, GO_MS);
  const now = ctx.now();
  return { ...s, phase: 'go', greenAt: now, endsAt: now + GO_MS };
}

function reveal(s: ReflexeState, ctx: GameContext): ReflexeState {
  ctx.cancel(SIGNAL);
  ctx.cancel(GO_TIMEOUT);

  const order = Object.entries(s.reactions).sort((a, b) => a[1] - b[1]);
  const gains: Record<string, number> = {};
  order.forEach(([id], place) => {
    gains[id] = PLACE_POINTS[place] ?? 0;
  });

  let points = s.points;
  for (const [id, gained] of Object.entries(gains)) {
    points = addPoints(points, id, gained);
  }

  ctx.schedule(REVEAL_NEXT, REVEAL_MS);
  return { ...s, phase: 'reveal', points, gains, endsAt: ctx.now() + REVEAL_MS };
}

function advance(s: ReflexeState, ctx: GameContext): ReflexeState {
  ctx.cancel(REVEAL_NEXT);
  if (s.round + 1 < s.total) return openWait({ ...s, round: s.round + 1 }, ctx);
  return finish(s, ctx);
}

function finish(s: ReflexeState, ctx: GameContext): ReflexeState {
  for (const key of [SIGNAL, GO_TIMEOUT, REVEAL_NEXT]) ctx.cancel(key);
  return { ...s, phase: 'final' };
}

export const reflexe: GameModule<ReflexeState, ReflexeSettings> = {
  manifest: {
    id: 'reflexe',
    category: 'plateau',
    name: 'Réflexe',
    description: 'Attendez le vert… puis touchez votre téléphone le plus vite possible !',
    icon: '⚡',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 1,
    maxPlayers: 12,
    durationMin: 5,
    notice: {
      goal: 'Être le premier à toucher son téléphone quand l’écran passe au vert.',
      steps: [
        'L’écran passe au rouge : attendez.',
        'Dès que l’écran devient vert, touchez votre téléphone.',
        'Le plus rapide marque 100 points, puis 70, 50, 30 et ainsi de suite.',
        'Toucher pendant le rouge est un faux départ : aucun point pour cette manche.',
      ],
      tips: [
        'Les temps sont mesurés par le serveur, la latence du réseau compte.',
        'Le signal arrive entre deux et cinq secondes après le début de la manche.',
      ],
    },
  },

  settingsSchema: reflexeSettingsSchema,
  defaultSettings: reflexeSettingsSchema.parse({}),

  actions: {
    // Le geste « toucher » ne porte aucune donnée.
    tap: z.unknown(),
  },

  initialize(settings, players) {
    const parsed = reflexeSettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      round: 0,
      total: parsed.rounds,
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      reactions: {},
      falseStarts: [],
      greenAt: 0,
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
    return ok(openWait({ ...s, total: s.settings.rounds }, ctx));
  },

  handleAction(s, p, type, _payload, ctx) {
    if (type !== 'tap') return fail('Action inconnue');
    if (!(p.id in s.players)) return fail('Joueur inconnu dans cette partie');
    if (hasActed(s, p.id)) return fail('Vous avez déjà touché pour cette manche');

    if (s.phase === 'wait') {
      // Faux départ : le joueur est pénalisé pour cette manche seulement.
      return ok({ ...s, falseStarts: [...s.falseStarts, p.id] });
    }

    if (s.phase === 'go') {
      const reaction = Math.max(0, ctx.now() - s.greenAt);
      const next = { ...s, reactions: { ...s.reactions, [p.id]: reaction } };
      const done = everyConnectedDone(ctx, Object.keys(next.players), (id) => hasActed(next, id));
      return ok(done ? reveal(next, ctx) : next);
    }

    return fail('Rien à toucher pour le moment');
  },

  onTimer(s, key, ctx) {
    if (key === SIGNAL && s.phase === 'wait') return goSignal(s, ctx);
    if (key === GO_TIMEOUT && s.phase === 'go') return reveal(s, ctx);
    if (key === REVEAL_NEXT && s.phase === 'reveal') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'wait') return goSignal(s, ctx);
    if (s.phase === 'go') return reveal(s, ctx);
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
      total: s.total,
      ranking: rankEntries(s.players, s.points),
      endsAt: s.endsAt,
    };

    if (s.phase === 'reveal') {
      const results = Object.keys(s.players)
        .map((id) => ({
          playerId: id,
          name: s.players[id] ?? '?',
          reaction: s.reactions[id] ?? null,
          falseStart: s.falseStarts.includes(id),
          gained: s.gains[id] ?? 0,
        }))
        .sort((a, b) => {
          if (a.reaction === null && b.reaction === null) return a.name.localeCompare(b.name, 'fr');
          if (a.reaction === null) return 1;
          if (b.reaction === null) return -1;
          return a.reaction - b.reaction;
        });
      return { ...base, results };
    }

    if (s.phase === 'go') {
      return {
        ...base,
        durationMs: GO_MS,
        responded: Object.keys(s.reactions).length,
        playerCount: Object.keys(s.players).length,
      };
    }

    return { ...base, results: [] };
  },

  getPlayerState(s, playerId) {
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      acted: hasActed(s, playerId),
      falseStart: s.falseStarts.includes(playerId),
      reaction: s.reactions[playerId] ?? null,
      gained: s.phase === 'reveal' ? (s.gains[playerId] ?? 0) : null,
    };
  },

  getHostState(s) {
    const pending = s.phase === 'go' ? Object.keys(s.players).filter((id) => !hasActed(s, id)) : [];
    return { pending: pending.map((id) => s.players[id] ?? '?') };
  },

  isFinished(s) {
    return s.phase === 'final';
  },
  suggest(s, playerId) {
    if (s.phase !== 'go' || hasActed(s, playerId)) return null;
    return { type: 'tap', key: `t${s.round}` };
  },
};
