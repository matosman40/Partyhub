import { z } from 'zod';
import type { GameContext, GameModule, GameResult, PlayerRef } from '@partyhub/shared';
import { addPoints, directory, fail, ok, rankEntries } from '../common/engine.js';

/**
 * Bombes party : chaque joueur contrôle un personnage sur une grille. Il pose
 * des bombes pour détruire les caisses et éliminer les autres. Une bombe
 * explose après un court délai, dans les quatre directions, et peut en faire
 * exploser d'autres. Les caisses détruites laissent parfois un bonus.
 * Le dernier survivant gagne la manche. Toute la logique est sur le serveur.
 */

export const bombesPartySettingsSchema = z.object({
  rounds: z.number().int().min(1).max(5).default(3),
});

export type BombesPartySettings = z.infer<typeof bombesPartySettingsSchema>;

export type Dir = 'up' | 'down' | 'left' | 'right';

const DIRS: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const DIR_NAMES = Object.keys(DIRS) as Dir[];
const moveSchema = z.object({ dir: z.enum(['up', 'down', 'left', 'right']) });

export const WIDTH = 13;
export const HEIGHT = 11;

const WALL = '#';
const CRATE = 'x';
const FLOOR = '.';

const START_RANGE = 2;
const START_BOMBS = 1;
const MAX_RANGE = 6;
const MAX_BOMBS = 5;
const MOVE_COOLDOWN_MS = 150;
const FUSE_MS = 2500;
const FIRE_MS = 700;
const ROUND_LIMIT_MS = 120_000;
const ROUND_OVER_MS = 3500;
const WIN_POINTS = 100;
const CRATE_RATIO = 0.7;
const DROP_RATIO = 0.35;
const SPEED_MAX = 2;
/** Répartition des bonus tirés d'une caisse détruite. */
const DROP_TABLE: Array<[PowerKind, number]> = [
  ['bomb', 30],
  ['flame', 30],
  ['speed', 15],
  ['kangaroo', 12],
  ['dino', 13],
];

function dropKind(random: () => number): PowerKind {
  const total = DROP_TABLE.reduce((n, [, w]) => n + w, 0);
  let r = random() * total;
  for (const [kind, w] of DROP_TABLE) {
    r -= w;
    if (r < 0) return kind;
  }
  return 'bomb';
}

/** Délai minimal entre deux pas : la vitesse et le dino le réduisent. */
function cooldownOf(u: Unit): number {
  return Math.max(85, MOVE_COOLDOWN_MS - u.speed * 22 - (u.mount === 'dino' ? 20 : 0));
}

/** Coins de départ (cases libres aux angles, sur les positions impaires). */
const SPAWNS: Array<[number, number]> = [
  [1, 1],
  [WIDTH - 2, 1],
  [1, HEIGHT - 2],
  [WIDTH - 2, HEIGHT - 2],
];

const ROUND_LIMIT = 'round-limit';
const NEXT_ROUND = 'next-round';
const FIRE_KEY = 'fire-clear';
const bombKey = (id: string) => `bomb:${id}`;

export type BombesPartyPhase = 'ready' | 'play' | 'round-over' | 'final';

/** Animaux montables : le kangourou pousse les bombes, le dino est plus rapide. Un animal encaisse un coup. */
export type Mount = 'kangaroo' | 'dino';
export type PowerKind = 'bomb' | 'flame' | 'speed' | 'kangaroo' | 'dino';

export interface Unit {
  x: number;
  y: number;
  alive: boolean;
  range: number;
  maxBombs: number;
  /** Niveau de vitesse (0 à 2). */
  speed: number;
  mount: Mount | null;
  facing: Dir;
  lastMoveAt: number;
}

export interface Bomb {
  id: string;
  x: number;
  y: number;
  owner: string;
  range: number;
  endsAt: number;
}

export interface Flame {
  x: number;
  y: number;
  until: number;
}

export interface Powerup {
  x: number;
  y: number;
  kind: PowerKind;
}

export interface Pt {
  x: number;
  y: number;
}

export interface BombesPartyState {
  phase: BombesPartyPhase;
  settings: BombesPartySettings;
  round: number;
  total: number;
  /** Grille : '#' mur, 'x' caisse, '.' sol. Vide avant la première manche. */
  grid: string[];
  players: Record<string, string>;
  points: Record<string, number>;
  units: Record<string, Unit>;
  bombs: Bomb[];
  flames: Flame[];
  powerups: Powerup[];
  winnerId: string | null;
  endsAt: number;
  /** Compteur d'événements : sert de clé stable pour les robots. */
  seq: number;
}

const k = (x: number, y: number): string => `${x},${y}`;

function isBorder(x: number, y: number): boolean {
  return x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
}

function isPillar(x: number, y: number): boolean {
  return x % 2 === 0 && y % 2 === 0;
}

function nearSpawn(x: number, y: number): boolean {
  return SPAWNS.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) <= 2);
}

function buildGrid(random: () => number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < WIDTH; x++) {
      if (isBorder(x, y) || isPillar(x, y)) row += WALL;
      else if (nearSpawn(x, y)) row += FLOOR;
      else row += random() < CRATE_RATIO ? CRATE : FLOOR;
    }
    rows.push(row);
  }
  return rows;
}

function cellAt(grid: string[], x: number, y: number): string {
  const row = grid[y];
  if (row === undefined || x < 0 || x >= row.length) return WALL;
  return row[x] ?? WALL;
}

function withCell(grid: string[], x: number, y: number, ch: string): string[] {
  const out = [...grid];
  const row = out[y] ?? '';
  out[y] = row.slice(0, x) + ch + row.slice(x + 1);
  return out;
}

interface Blast {
  cells: Pt[];
  crates: Pt[];
  chained: Pt[];
}

/** Cases touchées par un souffle : s'arrête sur un mur, une caisse ou une autre bombe. */
function blastFrom(
  grid: string[],
  x: number,
  y: number,
  range: number,
  isBomb: (x: number, y: number) => boolean,
): Blast {
  const cells: Pt[] = [{ x, y }];
  const crates: Pt[] = [];
  const chained: Pt[] = [];
  for (const dir of DIR_NAMES) {
    const [dx, dy] = DIRS[dir];
    for (let i = 1; i <= range; i++) {
      const cx = x + dx * i;
      const cy = y + dy * i;
      const c = cellAt(grid, cx, cy);
      if (c === WALL) break;
      cells.push({ x: cx, y: cy });
      if (c === CRATE) {
        crates.push({ x: cx, y: cy });
        break;
      }
      if (isBomb(cx, cy)) {
        chained.push({ x: cx, y: cy });
        break;
      }
    }
  }
  return { cells, crates, chained };
}

function passable(s: BombesPartyState, x: number, y: number): boolean {
  if (cellAt(s.grid, x, y) !== FLOOR) return false;
  if (s.bombs.some((b) => b.x === x && b.y === y)) return false;
  return !s.flames.some((f) => f.x === x && f.y === y);
}

/** Toutes les cases où une explosion en cours ou future (chaînes comprises) frapperait. */
function dangerCells(s: BombesPartyState): Set<string> {
  const danger = new Set<string>();
  const isBomb = (x: number, y: number) => s.bombs.some((b) => b.x === x && b.y === y);
  for (const bomb of s.bombs) {
    const seen = new Set<string>([bomb.id]);
    const queue: Bomb[] = [bomb];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const blast = blastFrom(s.grid, cur.x, cur.y, cur.range, isBomb);
      for (const c of blast.cells) danger.add(k(c.x, c.y));
      for (const c of blast.chained) {
        const next = s.bombs.find((b) => b.x === c.x && b.y === c.y);
        if (next && !seen.has(next.id)) {
          seen.add(next.id);
          queue.push(next);
        }
      }
    }
  }
  for (const f of s.flames) danger.add(k(f.x, f.y));
  return danger;
}

/** Premier pas d'un plus court chemin vers une case satisfaisant `goal` (robots uniquement). */
function firstStep(
  s: BombesPartyState,
  sx: number,
  sy: number,
  goal: (x: number, y: number) => boolean,
  maxDepth: number,
): Dir | null {
  interface Node {
    x: number;
    y: number;
    first: Dir | null;
    depth: number;
  }
  const queue: Node[] = [{ x: sx, y: sy, first: null, depth: 0 }];
  const seen = new Set<string>([k(sx, sy)]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.first !== null && goal(cur.x, cur.y)) return cur.first;
    if (cur.depth >= maxDepth) continue;
    for (const dir of DIR_NAMES) {
      const [dx, dy] = DIRS[dir];
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = k(nx, ny);
      if (seen.has(key) || !passable(s, nx, ny)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny, first: cur.first ?? dir, depth: cur.depth + 1 });
    }
  }
  return null;
}

/** Vrai si une bombe posée ici toucherait une caisse ou un autre joueur. */
function wouldHit(s: BombesPartyState, playerId: string, x: number, y: number, range: number): boolean {
  const blast = blastFrom(s.grid, x, y, range, () => false);
  if (blast.crates.length > 0) return true;
  return Object.entries(s.units).some(
    ([id, u]) => id !== playerId && u.alive && blast.cells.some((c) => c.x === u.x && c.y === u.y),
  );
}

function aliveIds(s: BombesPartyState): string[] {
  return Object.keys(s.units).filter((id) => s.units[id]?.alive);
}

function startRound(s: BombesPartyState, ctx: GameContext, round: number): BombesPartyState {
  const units: Record<string, Unit> = {};
  Object.keys(s.players).forEach((id, i) => {
    const [x, y] = SPAWNS[i % SPAWNS.length] ?? [1, 1];
    units[id] = {
      x,
      y,
      alive: true,
      range: START_RANGE,
      maxBombs: START_BOMBS,
      speed: 0,
      mount: null,
      facing: 'down',
      lastMoveAt: 0,
    };
  });
  ctx.cancel(NEXT_ROUND);
  ctx.schedule(ROUND_LIMIT, ROUND_LIMIT_MS);
  return {
    ...s,
    phase: 'play',
    round,
    grid: buildGrid(ctx.random),
    units,
    bombs: [],
    flames: [],
    powerups: [],
    winnerId: null,
    endsAt: ctx.now() + ROUND_LIMIT_MS,
    seq: s.seq + 1,
  };
}

function endRound(s: BombesPartyState, ctx: GameContext, winnerId: string | null): BombesPartyState {
  ctx.cancel(ROUND_LIMIT);
  for (const b of s.bombs) ctx.cancel(bombKey(b.id));
  ctx.cancel(NEXT_ROUND);
  ctx.schedule(NEXT_ROUND, ROUND_OVER_MS);
  return {
    ...s,
    phase: 'round-over',
    bombs: [],
    points: winnerId ? addPoints(s.points, winnerId, WIN_POINTS) : s.points,
    winnerId,
    endsAt: ctx.now() + ROUND_OVER_MS,
    seq: s.seq + 1,
  };
}

function checkRoundEnd(s: BombesPartyState, ctx: GameContext): BombesPartyState {
  if (s.phase !== 'play') return s;
  const alive = aliveIds(s);
  if (alive.length > 1) return s;
  return endRound(s, ctx, alive[0] ?? null);
}

function finish(s: BombesPartyState, ctx: GameContext): BombesPartyState {
  for (const key of [ROUND_LIMIT, NEXT_ROUND, FIRE_KEY]) ctx.cancel(key);
  for (const b of s.bombs) ctx.cancel(bombKey(b.id));
  return { ...s, phase: 'final', bombs: [], endsAt: 0, seq: s.seq + 1 };
}

function advance(s: BombesPartyState, ctx: GameContext): BombesPartyState {
  ctx.cancel(NEXT_ROUND);
  if (s.round + 1 < s.total) return startRound(s, ctx, s.round + 1);
  return finish(s, ctx);
}

function explode(s: BombesPartyState, startId: string, ctx: GameContext): BombesPartyState {
  const now = ctx.now();
  let grid = s.grid;
  let bombs = [...s.bombs];
  let powerups = [...s.powerups];
  const units: Record<string, Unit> = { ...s.units };
  const flames = s.flames.filter((f) => f.until > now);
  const queue = [startId];
  /** Un joueur ne subit qu'un seul coup par explosion en chaîne. */
  const hitIds = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    const bomb = bombs.find((b) => b.id === id);
    if (!bomb) continue;
    bombs = bombs.filter((b) => b.id !== id);
    ctx.cancel(bombKey(id));

    const blast = blastFrom(grid, bomb.x, bomb.y, bomb.range, (x, y) =>
      bombs.some((b) => b.x === x && b.y === y),
    );

    for (const c of blast.cells) {
      flames.push({ x: c.x, y: c.y, until: now + FIRE_MS });
      powerups = powerups.filter((p) => !(p.x === c.x && p.y === c.y));
      for (const uid of Object.keys(units)) {
        const u = units[uid];
        if (!u || !u.alive || u.x !== c.x || u.y !== c.y || hitIds.has(uid)) continue;
        hitIds.add(uid);
        // L'animal encaisse le premier coup ; sans animal, le joueur est éliminé.
        if (u.mount) units[uid] = { ...u, mount: null };
        else units[uid] = { ...u, alive: false };
      }
    }

    // Les caisses tombent après le souffle : un bonus posé sur la case survit à son explosion.
    for (const c of blast.crates) {
      grid = withCell(grid, c.x, c.y, FLOOR);
      if (ctx.random() < DROP_RATIO) {
        powerups.push({ x: c.x, y: c.y, kind: dropKind(ctx.random) });
      }
    }

    for (const c of blast.chained) {
      const next = bombs.find((b) => b.x === c.x && b.y === c.y);
      if (next) queue.push(next.id);
    }
  }

  ctx.cancel(FIRE_KEY);
  ctx.schedule(FIRE_KEY, FIRE_MS);
  return checkRoundEnd({ ...s, grid, bombs, powerups, units, flames, seq: s.seq + 1 }, ctx);
}

function pruneFlames(s: BombesPartyState, ctx: GameContext): BombesPartyState {
  const now = ctx.now();
  const flames = s.flames.filter((f) => f.until > now);
  if (flames.length > 0) {
    const wait = Math.max(...flames.map((f) => f.until - now));
    ctx.schedule(FIRE_KEY, Math.max(20, wait));
  }
  return { ...s, flames };
}

function withUnit(s: BombesPartyState, id: string, u: Unit, seq: number): BombesPartyState {
  return { ...s, units: { ...s.units, [id]: u }, seq };
}

function move(s: BombesPartyState, playerId: string, dir: Dir, ctx: GameContext): BombesPartyState {
  const now = ctx.now();
  const unit = s.units[playerId];
  if (!unit) return s;
  const seq = s.seq + 1;

  // Un déplacement trop rapide est ignoré sans erreur.
  if (now - unit.lastMoveAt < cooldownOf(unit)) return { ...s, seq };

  const [dx, dy] = DIRS[dir];
  const tx = unit.x + dx;
  const ty = unit.y + dy;
  if (cellAt(s.grid, tx, ty) !== FLOOR) return withUnit(s, playerId, { ...unit, facing: dir }, seq);

  let bombs = s.bombs;
  const bomb = s.bombs.find((b) => b.x === tx && b.y === ty);
  if (bomb) {
    // Seul le kangourou peut pousser une bombe, d'une case, si la place est libre.
    const bx = tx + dx;
    const by = ty + dy;
    const free = cellAt(s.grid, bx, by) === FLOOR && !s.bombs.some((b) => b.x === bx && b.y === by);
    if (unit.mount !== 'kangaroo' || !free) return withUnit(s, playerId, { ...unit, facing: dir }, seq);
    bombs = s.bombs.map((b) => (b === bomb ? { ...b, x: bx, y: by } : b));
  }

  let next: Unit = { ...unit, x: tx, y: ty, lastMoveAt: now, facing: dir };
  const pick = s.powerups.find((p) => p.x === tx && p.y === ty);
  let powerups = s.powerups;
  if (pick) {
    powerups = s.powerups.filter((p) => p !== pick);
    switch (pick.kind) {
      case 'bomb':
        next = { ...next, maxBombs: Math.min(MAX_BOMBS, next.maxBombs + 1) };
        break;
      case 'flame':
        next = { ...next, range: Math.min(MAX_RANGE, next.range + 1) };
        break;
      case 'speed':
        next = { ...next, speed: Math.min(SPEED_MAX, next.speed + 1) };
        break;
      case 'kangaroo':
      case 'dino':
        next = { ...next, mount: pick.kind };
        break;
    }
  }

  // Marcher dans une flamme : l'animal s'enfuit en premier, sinon c'est fatal.
  if (s.flames.some((f) => f.x === tx && f.y === ty && f.until > now)) {
    next = next.mount ? { ...next, mount: null } : { ...next, alive: false };
  }

  return checkRoundEnd({ ...s, bombs, units: { ...s.units, [playerId]: next }, powerups, seq }, ctx);
}

function placeBomb(s: BombesPartyState, playerId: string, ctx: GameContext): GameResult<BombesPartyState> {
  const unit = s.units[playerId];
  if (!unit) return fail('Joueur inconnu dans cette partie');
  if (s.bombs.filter((b) => b.owner === playerId).length >= unit.maxBombs) {
    return fail('Plus de bombe disponible pour le moment');
  }
  if (s.bombs.some((b) => b.x === unit.x && b.y === unit.y)) {
    return fail('Une bombe est déjà posée ici');
  }
  const id = `b${s.seq}`;
  ctx.schedule(bombKey(id), FUSE_MS);
  return ok({
    ...s,
    bombs: [...s.bombs, { id, x: unit.x, y: unit.y, owner: playerId, range: unit.range, endsAt: ctx.now() + FUSE_MS }],
    seq: s.seq + 1,
  });
}

export const bombesParty: GameModule<BombesPartyState, BombesPartySettings> = {
  manifest: {
    id: 'bombes-party',
    category: 'plateau',
    name: 'Bombes party',
    description: 'Posez vos bombes, détruisez les caisses et soyez le dernier debout !',
    icon: '💣',
    version: '1.0.0',
    apiVersion: 1,
    minPlayers: 2,
    maxPlayers: 4,
    durationMin: 8,
    notice: {
      goal: 'Être le dernier joueur debout : détruisez les caisses et éliminez les autres avec vos bombes.',
      steps: [
        'Déplacez votre personnage avec les flèches de votre téléphone.',
        'Posez une bombe : elle explose après deux secondes et demie, dans les quatre directions.',
        'Une caisse détruite peut laisser tomber un bonus : une bombe de plus ou une portée plus longue.',
        'Le dernier survivant de la manche marque 100 points.',
      ],
      tips: [
        'Le souffle s’arrête sur les murs et sur les caisses.',
        'Une bombe peut en faire exploser une autre : repérez votre sortie avant de poser.',
        'Marcher dans une flamme élimine aussi.',
      ],
    },
  },

  settingsSchema: bombesPartySettingsSchema,
  defaultSettings: bombesPartySettingsSchema.parse({}),

  actions: {
    move: moveSchema,
    // La pose de bombe ne porte aucune donnée.
    bomb: z.unknown(),
  },

  initialize(settings, players) {
    const parsed = bombesPartySettingsSchema.parse(settings);
    return {
      phase: 'ready',
      settings: parsed,
      round: 0,
      total: parsed.rounds,
      grid: [],
      players: directory(players),
      points: Object.fromEntries(players.map((p) => [p.id, 0])),
      units: {},
      bombs: [],
      flames: [],
      powerups: [],
      winnerId: null,
      endsAt: 0,
      seq: 0,
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

  onPlayerLeave(s, p: PlayerRef, ctx) {
    if (s.phase === 'ready') {
      const players = { ...s.players };
      const points = { ...s.points };
      delete players[p.id];
      delete points[p.id];
      return { ...s, players, points };
    }
    // Un joueur qui quitte pendant la manche est éliminé.
    const unit = s.units[p.id];
    if (s.phase === 'play' && unit?.alive) {
      return checkRoundEnd({ ...s, units: { ...s.units, [p.id]: { ...unit, alive: false } }, seq: s.seq + 1 }, ctx);
    }
    return s;
  },

  start(s, ctx) {
    if (s.phase !== 'ready') return fail('La partie a déjà commencé');
    return ok(startRound({ ...s, total: s.settings.rounds }, ctx, 0));
  },

  handleAction(s, p, type, payload, ctx) {
    if (s.phase !== 'play') return fail('Pas de partie en cours');
    const unit = s.units[p.id];
    if (!unit) return fail('Joueur inconnu dans cette partie');
    if (!unit.alive) return fail('Vous êtes éliminé pour cette manche');

    if (type === 'move') {
      const parsed = moveSchema.safeParse(payload);
      if (!parsed.success) return fail('Direction invalide');
      return ok(move(s, p.id, parsed.data.dir, ctx));
    }
    if (type === 'bomb') return placeBomb(s, p.id, ctx);
    return fail('Action inconnue');
  },

  onTimer(s, key, ctx) {
    if (key.startsWith('bomb:') && s.phase === 'play') return explode(s, key.slice('bomb:'.length), ctx);
    if (key === FIRE_KEY) return pruneFlames(s, ctx);
    if (key === ROUND_LIMIT && s.phase === 'play') return endRound(s, ctx, null);
    if (key === NEXT_ROUND && s.phase === 'round-over') return advance(s, ctx);
    return s;
  },

  nextRound(s, ctx) {
    if (s.phase === 'play') {
      const alive = aliveIds(s);
      return endRound(s, ctx, alive.length === 1 ? (alive[0] ?? null) : null);
    }
    if (s.phase === 'round-over') return advance(s, ctx);
    return s;
  },

  calculateScores(s) {
    return rankEntries(s.players, s.points);
  },

  end(s, ctx) {
    return finish(s, ctx);
  },

  getPublicState(s) {
    const order = Object.keys(s.players);
    return {
      phase: s.phase,
      round: s.round,
      total: s.total,
      width: WIDTH,
      height: HEIGHT,
      grid: s.grid,
      units: Object.keys(s.units).map((id) => {
        const u = s.units[id]!;
        return {
          playerId: id,
          name: s.players[id] ?? '?',
          color: order.indexOf(id),
          x: u.x,
          y: u.y,
          alive: u.alive,
          mount: u.mount,
          speed: u.speed,
          facing: u.facing,
        };
      }),
      bombs: s.bombs.map((b) => ({ id: b.id, x: b.x, y: b.y, color: order.indexOf(b.owner), endsAt: b.endsAt })),
      flames: s.flames.map((f) => ({ x: f.x, y: f.y })),
      powerups: s.powerups,
      winnerId: s.winnerId,
      winnerName: s.winnerId ? (s.players[s.winnerId] ?? '?') : null,
      ranking: rankEntries(s.players, s.points),
      endsAt: s.endsAt,
      durationMs: s.phase === 'play' ? ROUND_LIMIT_MS : s.phase === 'round-over' ? ROUND_OVER_MS : 0,
    };
  },

  getPlayerState(s, playerId) {
    const u = s.units[playerId];
    const rank = rankEntries(s.players, s.points).find((e) => e.playerId === playerId)?.rank ?? null;
    return {
      points: s.points[playerId] ?? 0,
      rank,
      alive: u?.alive ?? false,
      x: u?.x ?? null,
      y: u?.y ?? null,
      range: u?.range ?? null,
      maxBombs: u?.maxBombs ?? null,
      speed: u?.speed ?? 0,
      mount: u?.mount ?? null,
      placed: s.bombs.filter((b) => b.owner === playerId).length,
      gained: s.phase === 'round-over' ? (s.winnerId === playerId ? WIN_POINTS : 0) : null,
    };
  },

  getHostState(s) {
    return { alive: aliveIds(s).map((id) => s.players[id] ?? '?') };
  },

  isFinished(s) {
    return s.phase === 'final';
  },

  suggest(s, playerId, random) {
    if (s.phase !== 'play') return null;
    const me = s.units[playerId];
    if (!me || !me.alive) return null;
    const key = `s${s.seq}`;
    const danger = dangerCells(s);

    // 1. Sortir de la zone dangereuse en priorité.
    if (danger.has(k(me.x, me.y))) {
      const dir = firstStep(s, me.x, me.y, (x, y) => !danger.has(k(x, y)), 8);
      return dir ? { type: 'move', payload: { dir }, key } : null;
    }

    // 2. Poser une bombe si elle touche quelque chose et qu'une sortie existe.
    const placed = s.bombs.filter((b) => b.owner === playerId).length;
    const bombHere = s.bombs.some((b) => b.x === me.x && b.y === me.y);
    if (placed < me.maxBombs && !bombHere && wouldHit(s, playerId, me.x, me.y, me.range) && random() < 0.6) {
      const tmp: Bomb = { id: 'tmp', x: me.x, y: me.y, owner: playerId, range: me.range, endsAt: 0 };
      const after: BombesPartyState = { ...s, bombs: [...s.bombs, tmp] };
      const danger2 = dangerCells(after);
      if (firstStep(after, me.x, me.y, (x, y) => !danger2.has(k(x, y)), 2) !== null) {
        return { type: 'bomb', key };
      }
    }

    // 3. Aller vers une caisse, un adversaire ou un bonus.
    const goal = (x: number, y: number) =>
      s.powerups.some((p) => p.x === x && p.y === y) || wouldHit(s, playerId, x, y, me.range);
    const dir = firstStep(s, me.x, me.y, goal, 40);
    if (dir) return { type: 'move', payload: { dir }, key };

    // 4. Sinon, un pas au hasard.
    const options = DIR_NAMES.filter((d) => {
      const [dx, dy] = DIRS[d];
      return passable(s, me.x + dx, me.y + dy);
    });
    if (options.length === 0) return null;
    const pick = options[Math.floor(random() * options.length)] ?? options[0]!;
    return { type: 'move', payload: { dir: pick }, key };
  },
};
