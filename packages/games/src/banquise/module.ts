import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef } from '@partyhub/shared';
import { addPoints, fail, ok, rankEntries } from '../common/engine.js';
import {
  TICK_MS,
  COLS,
  ROWS,
  ICE,
  cellCenter,
  erode,
  holeCount,
  iceAt,
  jump,
  makeIce,
  newBody,
  push,
  separate,
  setInput,
  spawnCells,
  stepBody,
  windAccel,
  type Body,
  type Dir,
  type Wind,
  type WindPhase,
} from './physics.js';

/**
 * Banquise : trois niveaux sur un îlot de glace qui fond. Chaque joueur contrôle son personnage
 * (marche dans les quatre directions, saut, poussée). Le dernier resté sur la glace gagne le niveau. Règles et valeurs :
 * docs/JEU-BANQUISE.md. Toute la logique est sur le serveur ; le navigateur n’envoie que des intentions.
 */

export const banquiseSettingsSchema = z.object({});
export type BanquiseSettings = z.infer<typeof banquiseSettingsSchema>;

export const LEVEL_COUNT = 3;
export const COUNTDOWN_MS = 3000;
export const LEVEL_OVER_MS = 4000;
export const POINTS_PER_LEVEL = 100;
const TICK = 'tick';

interface LevelRule {
  name: string;
  hint: string;
  holes: boolean;
  wind: boolean;
  /** Délai avant la première case fondue, depuis le départ du niveau. */
  erodeDelayMs: number;
  /** Délai entre deux cases fondues. */
  erodeEveryMs: number;
}

export const LEVEL_RULES: LevelRule[] = [
  {
    name: 'La fonte',
    hint: 'La glace fond par les bords. Restez au centre et poussez vos adversaires.',
    holes: false,
    wind: false,
    erodeDelayMs: 3000,
    erodeEveryMs: 1600,
  },
  {
    name: 'Les crevasses',
    hint: 'Des trous dans la glace : sautez-les ou contournez-les.',
    holes: true,
    wind: false,
    erodeDelayMs: 45_000,
    erodeEveryMs: 1600,
  },
  {
    name: 'La tempête',
    hint: 'Crevasses et rafales : le vent vous pousse quand vous restez immobile.',
    holes: true,
    wind: true,
    erodeDelayMs: 45_000,
    erodeEveryMs: 1600,
  },
];

export type BanquisePhase = 'ready' | 'countdown' | 'play' | 'level-over' | 'final';

export interface BanquiseState {
  phase: BanquisePhase;
  /** Niveau en cours, ou dernier niveau joué (1 à 3). */
  level: number;
  /** Une lettre par case, ligne par ligne : `i` glace, `.` eau. Vide avant la première manche. */
  ice: string;
  bodies: Record<string, Body>;
  names: Record<string, string>;
  points: Record<string, number>;
  wind: Wind | null;
  /** Instant de la prochaine case fondue, ou null si la fonte n’a pas commencé. */
  erodeAt: number | null;
  /** Fin du compte à rebours ou de l’annonce de fin de niveau. */
  phaseEndsAt: number;
  /** Horloge du dernier pas de simulation. */
  lastTickAt: number;
  /** Joueurs tombés pendant le niveau en cours, dans l’ordre de chute. */
  fallen: string[];
  /** Gagnants du niveau en cours (renseigné à la fin du niveau). */
  winners: string[];
  /** Gagnants de chaque niveau déjà joué. */
  history: Array<{ level: number; winners: string[] }>;
  /** Compteur d’événements : clé stable pour les robots et les effets. */
  seq: number;
}

const DIR_SCHEMA = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
const inputSchema = z.object({ dx: DIR_SCHEMA, dz: DIR_SCHEMA });

function alivePlayers(s: BanquiseState): string[] {
  return Object.keys(s.bodies)
    .filter((id) => s.bodies[id]?.alive)
    .sort();
}

/** Lance un niveau : glace, placement des personnages, compte à rebours. */
function beginLevel(s: BanquiseState, level: number, ctx: GameContext): BanquiseState {
  const rule = LEVEL_RULES[level - 1]!;
  const now = ctx.now();
  const ice = makeIce(rule.holes, ctx.random);
  const ids = Object.keys(s.names);
  const cells = spawnCells(ice, ids.length);
  const bodies: Record<string, Body> = {};
  ids.forEach((id, i) => {
    const idx = cells[i] ?? 0;
    const c = cellCenter(idx % COLS, Math.floor(idx / COLS));
    bodies[id] = newBody(c.x, c.z, c.x < COLS / 2 ? 1 : -1);
  });
  return {
    ...s,
    phase: 'countdown',
    level,
    ice,
    bodies,
    wind: null,
    erodeAt: null,
    phaseEndsAt: now + COUNTDOWN_MS,
    lastTickAt: now,
    fallen: [],
    winners: [],
    seq: s.seq + 1,
  };
}

function startPlay(s: BanquiseState, now: number, ctx: GameContext): BanquiseState {
  const rule = LEVEL_RULES[s.level - 1]!;
  const wind: Wind | null = rule.wind
    ? { phase: 'calm', dir: ctx.random() < 0.5 ? -1 : 1, strength: 0, until: now + 3000 + ctx.random() * 2000 }
    : null;
  return { ...s, phase: 'play', erodeAt: now + rule.erodeDelayMs, wind, seq: s.seq + 1 };
}

/** Fin de niveau : les gagnants reçoivent leurs points. Les personnages en l’air atterrissent d’abord. */
function endLevel(s: BanquiseState, now: number, winners: string[]): BanquiseState {
  const bodies = { ...s.bodies };
  // Les personnages encore en l’air finissent leur saut sur la glace, sans commande, vent ni fonte.
  for (const id of Object.keys(bodies)) {
    let b = { ...bodies[id]!, dirX: 0 as Dir, dirZ: 0 as Dir };
    for (let i = 0; i < 20 && b.alive && !b.grounded; i++) b = stepBody(b, s.ice, now, TICK_MS / 1000, 0);
    bodies[id] = b;
  }
  const points = winners.reduce((p, id) => addPoints(p, id, POINTS_PER_LEVEL), s.points);
  return {
    ...s,
    phase: 'level-over',
    bodies,
    points,
    winners,
    wind: null,
    erodeAt: null,
    phaseEndsAt: now + LEVEL_OVER_MS,
    history: [...s.history, { level: s.level, winners }],
    seq: s.seq + 1,
  };
}

/** Vérifie la fin du niveau après une chute : un seul joueur debout, ou plus personne. */
function checkLevelEnd(s: BanquiseState, now: number, fellNow: string[]): BanquiseState {
  if (s.phase !== 'play') return s;
  const alive = alivePlayers(s);
  if (alive.length > 1) return s;
  const winners = alive.length === 1 ? alive : fellNow;
  return endLevel(s, now, winners);
}

function advanceWind(wind: Wind, now: number, ctx: GameContext): Wind {
  if (now < wind.until) return wind;
  const next = (phase: WindPhase, extra: Partial<Wind>): Wind => ({
    phase,
    dir: wind.dir,
    strength: wind.strength,
    until: now,
    ...extra,
  });
  if (wind.phase === 'calm') {
    return next('warning', {
      dir: ctx.random() < 0.5 ? -1 : 1,
      strength: 0.6 + ctx.random() * 0.4,
      until: now + 1400,
    });
  }
  if (wind.phase === 'warning') return next('gust', { until: now + 1800 + ctx.random() * 800 });
  return next('calm', { strength: 0, until: now + 3000 + ctx.random() * 2000 });
}

/** Un pas de simulation (tick de 50 ms) pendant le jeu. */
function stepPlay(s: BanquiseState, now: number, dt: number, ctx: GameContext): BanquiseState {
  const rule = LEVEL_RULES[s.level - 1]!;
  let ice = s.ice;
  let erodeAt = s.erodeAt;
  let wind = s.wind;

  if (wind) wind = advanceWind(wind, now, ctx);
  if (erodeAt !== null && now >= erodeAt) {
    ice = erode(ice, ctx.random);
    erodeAt = now + rule.erodeEveryMs;
  }

  const ids = Object.keys(s.bodies).sort();
  const accel = windAccel(wind);
  const stepped = ids.map((id) => stepBody(s.bodies[id]!, ice, now, dt, accel));
  const separated = separate(stepped);
  const bodies: Record<string, Body> = {};
  ids.forEach((id, i) => {
    bodies[id] = separated[i]!;
  });

  const fellNow = ids.filter((id) => s.bodies[id]!.alive && !bodies[id]!.alive);
  const next: BanquiseState = {
    ...s,
    ice,
    bodies,
    wind,
    erodeAt,
    fallen: [...s.fallen, ...fellNow],
    seq: s.seq + 1,
  };
  return checkLevelEnd(next, now, fellNow);
}

function tick(s: BanquiseState, ctx: GameContext): BanquiseState {
  const now = ctx.now();
  const dt = Math.min(0.1, Math.max(0, (now - s.lastTickAt) / 1000));
  let next: BanquiseState = { ...s, lastTickAt: now, seq: s.seq + 1 };

  if (next.phase === 'countdown' && now >= next.phaseEndsAt) {
    next = startPlay(next, now, ctx);
  } else if (next.phase === 'level-over' && now >= next.phaseEndsAt) {
    next = next.level < LEVEL_COUNT ? beginLevel(next, next.level + 1, ctx) : finish(next, ctx);
  } else if (next.phase === 'play') {
    next = stepPlay(next, now, dt, ctx);
  }

  if (next.phase !== 'final') ctx.schedule(TICK, TICK_MS);
  return next;
}

function finish(s: BanquiseState, ctx: GameContext): BanquiseState {
  ctx.cancel(TICK);
  return { ...s, phase: 'final', wind: null, erodeAt: null, seq: s.seq + 1 };
}

/** Un joueur qui quitte pendant le jeu tombe : il ne peut plus être sur la glace. */
function eliminate(s: BanquiseState, id: string, ctx: GameContext): BanquiseState {
  const b = s.bodies[id];
  if (!b?.alive) return s;
  const now = ctx.now();
  const dead: Body = { ...b, alive: false, diedAt: now };
  const next: BanquiseState = {
    ...s,
    bodies: { ...s.bodies, [id]: dead },
    fallen: [...s.fallen, id],
    seq: s.seq + 1,
  };
  return checkLevelEnd(next, now, [id]);
}

/** Vrai si de l’eau se trouve juste devant le personnage, dans le sens de son mouvement. */
function waterAhead(ice: string, b: Body): boolean {
  if (b.dirX === 0 && b.dirZ === 0) return false;
  // À une case devant soi : le moment où un saut au-dessus d’un trou de deux cases réussit.
  return !iceAt(ice, b.x + b.dirX, b.z + b.dirZ);
}

/** Centre de l’îlot : moyenne des centres des cases de glace. */
function iceCenter(ice: string): { cx: number; cz: number } | null {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i < ice.length; i++) {
    if (ice[i] !== ICE) continue;
    const c = cellCenter(i % COLS, Math.floor(i / COLS));
    sx += c.x;
    sz += c.z;
    n++;
  }
  return n === 0 ? null : { cx: sx / n, cz: sz / n };
}

export const banquise: GameModule<BanquiseState, BanquiseSettings> = {
  manifest: {
    id: 'banquise',
    category: 'plateau',
    name: 'Banquise',
    description: 'Restez sur la glace : trois niveaux, des trous et du vent. Le dernier debout gagne.',
    icon: '🧊',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 8,
    durationMin: 4,
    notice: {
      goal: 'Ne tombez pas à l’eau. Le dernier joueur resté sur la glace gagne chaque niveau.',
      steps: [
        'Niveau 1, La fonte : la banquise fond par les bords. Restez loin des bords.',
        'Niveau 2, Les crevasses : sautez au-dessus des trous ou contournez-les.',
        'Niveau 3, La tempête : des rafales de vent vous poussent, avec une flèche qui annonce la direction.',
        'Poussez un adversaire devant vous pour le faire glisser vers l’eau.',
      ],
      tips: [
        'Vous marchez dans les quatre directions. La poussée part du côté où vous alliez en dernier.',
        'Une glace qui glisse : relâcher la touche ne vous arrête pas tout de suite.',
        'Un saut ne peut pas être annulé en l’air. Visez l’autre côté avant de sauter.',
        'Un pied sur la glace suffit à tenir : un bord partiellement solide reste sûr.',
      ],
    },
  },

  settingsSchema: banquiseSettingsSchema,
  defaultSettings: banquiseSettingsSchema.parse({}),

  actions: {
    input: inputSchema,
    // Saut et poussée ne portent aucune donnée.
    jump: z.unknown(),
    push: z.unknown(),
  },

  initialize(_settings, players, ctx) {
    return {
      phase: 'ready',
      level: 1,
      ice: '',
      bodies: {},
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      wind: null,
      erodeAt: null,
      phaseEndsAt: 0,
      lastTickAt: ctx.now(),
      fallen: [],
      winners: [],
      history: [],
      seq: 0,
    };
  },

  onPlayerJoin(s, p: PlayerRef) {
    if (s.phase !== 'ready') return s;
    return {
      ...s,
      names: { ...s.names, [p.id]: p.name },
      points: { ...s.points, [p.id]: s.points[p.id] ?? 0 },
    };
  },

  onPlayerLeave(s, p: PlayerRef, ctx) {
    if (s.phase === 'ready') {
      const names = { ...s.names };
      const points = { ...s.points };
      delete names[p.id];
      delete points[p.id];
      return { ...s, names, points };
    }
    if (s.phase === 'countdown' || s.phase === 'play') return eliminate(s, p.id, ctx);
    return s;
  },

  start(s, ctx): GameResult<BanquiseState> {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    const begun = beginLevel(s, 1, ctx);
    ctx.schedule(TICK, TICK_MS);
    return ok(begun);
  },

  handleAction(s, p, type, payload, ctx): GameResult<BanquiseState> {
    if (s.phase === 'ready') return fail('La partie n’a pas encore commencé');
    const me = s.bodies[p.id];
    if (!me) return fail('Vous ne jouez pas cette partie');
    if (s.phase !== 'play') return ok(s);
    if (!me.alive) return fail('Vous êtes tombé à l’eau pour ce niveau');

    if (type === 'input') {
      const parsed = inputSchema.safeParse(payload);
      if (!parsed.success) return fail('Direction invalide');
      const dx = parsed.data.dx as Dir;
      const dz = parsed.data.dz as Dir;
      return ok({ ...s, bodies: { ...s.bodies, [p.id]: setInput(me, dx, dz) } });
    }

    if (type === 'jump') {
      if (!me.grounded) return fail('Vous êtes déjà en l’air');
      return ok({ ...s, bodies: { ...s.bodies, [p.id]: jump(me) }, seq: s.seq + 1 });
    }

    if (type === 'push') {
      const now = ctx.now();
      if (now < me.pushReadyAt) return fail('Poussée en recharge');
      for (const id of Object.keys(s.bodies).sort()) {
        if (id === p.id) continue;
        const target = s.bodies[id];
        if (!target) continue;
        const res = push(me, target, now);
        if (res) {
          return ok({
            ...s,
            bodies: { ...s.bodies, [p.id]: res.pusher, [id]: res.target },
            seq: s.seq + 1,
          });
        }
      }
      return fail('Personne à pousser devant vous');
    }

    return fail('Action inconnue');
  },

  onTimer(s, key, ctx) {
    if (key === TICK) return tick(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'play') {
      const alive = alivePlayers(s);
      return endLevel(s, ctx.now(), alive.length === 1 ? alive : []);
    }
    if (s.phase === 'level-over') {
      return s.level < LEVEL_COUNT ? beginLevel(s, s.level + 1, ctx) : finish(s, ctx);
    }
    return s;
  },

  calculateScores(s) {
    return rankEntries(s.names, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  getPublicState(s) {
    const rule = LEVEL_RULES[s.level - 1];
    const order = Object.keys(s.names);
    const nameOf = (id: string) => s.names[id] ?? '?';
    const bodies = order.map((id, i) => {
      const b = s.bodies[id];
      return {
        playerId: id,
        name: nameOf(id),
        color: i,
        x: b?.x ?? null,
        z: b?.z ?? null,
        y: b?.y ?? 0,
        alive: b?.alive ?? false,
        grounded: b?.grounded ?? true,
        facing: b?.facing ?? 1,
        pushing: !!b && s.lastTickAt < b.pushingUntil,
        pushed: !!b && s.lastTickAt < b.pushedUntil,
        won: s.winners.includes(id),
      };
    });
    return {
      phase: s.phase,
      level: s.level,
      levelCount: LEVEL_COUNT,
      levelName: rule?.name ?? '',
      levelHint: rule?.hint ?? '',
      width: COLS,
      height: ROWS,
      ice: s.ice,
      holes: holeCount(s.ice),
      bodies,
      fallen: s.fallen.map((id) => ({ playerId: id, name: nameOf(id) })),
      winners: s.winners.map((id) => ({ playerId: id, name: nameOf(id) })),
      winnerName: s.winners[0] ? nameOf(s.winners[0]) : null,
      wind:
        s.wind && rule?.wind
          ? { phase: s.wind.phase, dir: s.wind.dir, strength: s.wind.strength, until: s.wind.until }
          : null,
      erodeAt: s.erodeAt,
      phaseEndsAt: s.phaseEndsAt,
      endsAt: s.phaseEndsAt,
      durationMs: s.phase === 'countdown' ? COUNTDOWN_MS : s.phase === 'level-over' ? LEVEL_OVER_MS : 0,
      now: s.lastTickAt,
      history: s.history.map((h) => ({
        level: h.level,
        levelName: LEVEL_RULES[h.level - 1]?.name ?? '',
        winnerNames: h.winners.map(nameOf),
      })),
      ranking: rankEntries(s.names, s.points),
      seq: s.seq,
    };
  },

  getPlayerState(s, playerId) {
    const b = s.bodies[playerId];
    const rank = rankEntries(s.names, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    const won = s.winners.includes(playerId);
    return {
      points: s.points[playerId] ?? 0,
      rank,
      level: s.level,
      alive: b?.alive ?? false,
      grounded: b?.grounded ?? false,
      canJump: s.phase === 'play' && !!b?.alive && b.grounded,
      pushReadyIn: b ? Math.max(0, b.pushReadyAt - s.lastTickAt) : 0,
      gained: s.phase === 'level-over' ? (won ? POINTS_PER_LEVEL : 0) : null,
    };
  },

  getHostState(s) {
    return {
      alive: alivePlayers(s).map((id) => s.names[id] ?? '?'),
      fallen: s.fallen.map((id) => s.names[id] ?? '?'),
    };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    if (s.phase !== 'play') return null;
    const me = s.bodies[playerId];
    if (!me || !me.alive) return null;
    const now = s.lastTickAt;
    const key = `s${s.seq}`;

    // 1. Pousser un adversaire placé devant soi.
    if (me.grounded && now >= me.pushReadyAt && random() < 0.35) {
      for (const id of alivePlayers(s)) {
        if (id === playerId) continue;
        const target = s.bodies[id];
        if (target && push(me, target, now)) return { type: 'push', key };
      }
    }

    // 2. Sauter au-dessus d’un trou qui vient, dans le sens de la marche.
    if (me.grounded && waterAhead(s.ice, me)) {
      return { type: 'jump', key: `jump:${s.seq}` };
    }

    // 3. Revenir vers le centre de la glace, à l’écart des bords.
    const center = iceCenter(s.ice);
    if (!center) return null;
    const dx: Dir = Math.abs(me.x - center.cx) < 0.5 ? 0 : me.x < center.cx ? 1 : -1;
    const dz: Dir = Math.abs(me.z - center.cz) < 0.5 ? 0 : me.z < center.cz ? 1 : -1;
    return { type: 'input', payload: { dx, dz }, key: `input:${dx}${dz}` };
  },
};
