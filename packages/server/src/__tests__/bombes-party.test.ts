import { describe, expect, it } from 'vitest';
import { bombesParty, type BombesPartyState } from '@partyhub/games';
import type { GameContext, PlayerRef } from '@partyhub/shared';

/**
 * Bombes party : règles pilotées à la main (horloge et minuteurs simulés),
 * puis une partie complète jouée uniquement par des robots, sur plusieurs graines.
 */

const A: PlayerRef = { id: 'a', name: 'Alice' };
const B: PlayerRef = { id: 'b', name: 'Bob' };

function makeCtx(connected: string[]) {
  const clock = { t: 1_000_000 };
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random: () => 0.42,
    connectedPlayerIds: () => connected,
  };
  return { ctx, clock, timers };
}

/** Grille vide : bordure et piliers, sol partout ailleurs. */
function emptyGrid(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 11; y++) {
    let row = '';
    for (let x = 0; x < 13; x++) {
      const border = x === 0 || y === 0 || x === 12 || y === 10;
      const pillar = x % 2 === 0 && y % 2 === 0;
      row += border || pillar ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

function setCell(grid: string[], x: number, y: number, ch: string): string[] {
  const out = [...grid];
  const row = out[y]!;
  out[y] = row.slice(0, x) + ch + row.slice(x + 1);
  return out;
}

function started(players: PlayerRef[], rounds = 1) {
  const h = makeCtx(players.map((p) => p.id));
  const init = bombesParty.initialize(bombesParty.settingsSchema.parse({ rounds }), players, h.ctx);
  const res = bombesParty.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  return { ...h, state: res.state };
}

describe('Bombes party : règles', () => {
  it('démarre avec chaque joueur sur son coin, sans bombe ni explosion', () => {
    const { state } = started([A, B]);
    expect(state.phase).toBe('play');
    expect(state.grid).toHaveLength(11);
    expect(state.grid.every((row) => row.length === 13)).toBe(true);
    expect(state.units.a).toMatchObject({ x: 1, y: 1, alive: true });
    expect(state.units.b).toMatchObject({ x: 11, y: 1, alive: true });
    expect(state.bombs).toEqual([]);
  });

  it('refuse de marcher sur un mur et respecte le délai entre deux pas', () => {
    const { state, ctx, clock } = started([A, B]);
    const grid = emptyGrid();
    let s: BombesPartyState = { ...state, grid };

    // (1,1) -> gauche = bordure : rien ne change.
    let res = bombesParty.handleAction(s, A, 'move', { dir: 'left' }, ctx);
    expect(res.ok && res.state.units.a).toMatchObject({ x: 1, y: 1 });

    res = bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx);
    expect(res.ok && res.state.units.a).toMatchObject({ x: 2, y: 1 });
    s = res.ok ? res.state : s;

    // Pas trop rapide : ignoré sans erreur.
    res = bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx);
    expect(res.ok && res.state.units.a).toMatchObject({ x: 2, y: 1 });
    s = res.ok ? res.state : s;

    clock.t += 200;
    res = bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx);
    expect(res.ok && res.state.units.a).toMatchObject({ x: 3, y: 1 });
  });

  it('pose une bombe par case et par bombe disponible', () => {
    const { state, ctx, timers } = started([A, B]);
    const res = bombesParty.handleAction(state, A, 'bomb', undefined, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.bombs).toHaveLength(1);
    expect(timers.has(`bomb:${res.state.bombs[0]!.id}`)).toBe(true);

    const again = bombesParty.handleAction(res.state, A, 'bomb', undefined, ctx);
    expect(again.ok).toBe(false);
  });

  it('une explosion détruit la caisse touchée, s’arrête dessus et élimine le poseur', () => {
    const { state, ctx } = started([A, B]);
    let grid = emptyGrid();
    grid = setCell(grid, 2, 1, 'x');
    grid = setCell(grid, 3, 1, 'x');
    let s: BombesPartyState = { ...state, grid };

    const placed = bombesParty.handleAction(s, A, 'bomb', undefined, ctx);
    if (!placed.ok) throw new Error(placed.error);
    s = placed.state;
    const bombId = s.bombs[0]!.id;

    s = bombesParty.onTimer(s, `bomb:${bombId}`, ctx);
    expect(s.grid[1]!.charAt(2)).toBe('.');
    expect(s.grid[1]!.charAt(3)).toBe('x');
    expect(s.units.a?.alive).toBe(false);
    expect(s.phase).toBe('round-over');
    expect(s.winnerId).toBe('b');
    expect(s.points.b).toBe(100);
    expect(s.points.a).toBe(0);
  });

  it('une bombe fait exploser la bombe voisine en chaîne', () => {
    const { state, ctx, timers } = started([A, B]);
    const grid = emptyGrid();
    let s: BombesPartyState = {
      ...state,
      grid,
      units: { ...state.units, a: { ...state.units.a!, maxBombs: 2 } },
    };
    const ok = (res: ReturnType<typeof bombesParty.handleAction>) => {
      if (!res.ok) throw new Error(res.error);
      return res.state;
    };

    // Alice pose une bombe sur sa case, avance d'une case (encore dans son souffle) et en pose une seconde.
    s = ok(bombesParty.handleAction(s, A, 'bomb', undefined, ctx));
    const firstId = s.bombs[0]!.id;
    s = ok(bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx));
    s = ok(bombesParty.handleAction(s, A, 'bomb', undefined, ctx));
    expect(s.bombs).toHaveLength(2);
    const secondId = s.bombs[1]!.id;
    expect(timers.has(`bomb:${secondId}`)).toBe(true);

    s = bombesParty.onTimer(s, `bomb:${firstId}`, ctx);
    expect(s.bombs).toHaveLength(0);
    expect(timers.has(`bomb:${secondId}`)).toBe(false);
  });

  it('un bonus de portée est ramassé en marchant dessus', () => {
    const { state, ctx } = started([A, B]);
    const s: BombesPartyState = {
      ...state,
      grid: emptyGrid(),
      powerups: [{ x: 2, y: 1, kind: 'flame' }],
    };
    const res = bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.units.a?.range).toBe(3);
    expect(res.state.powerups).toHaveLength(0);
  });
});

/** Joue une partie complète avec des robots uniquement, en simulant les minuteurs. */
function playWithBots(seed: number, rounds: number) {
  const players: PlayerRef[] = [
    { id: 'p1', name: 'Un' },
    { id: 'p2', name: 'Deux' },
    { id: 'p3', name: 'Trois' },
    { id: 'p4', name: 'Quatre' },
  ];
  const ids = players.map((p) => p.id);
  let t = 0;
  let rng = seed;
  const random = () => {
    rng = (rng * 16807) % 2147483647;
    return rng / 2147483647;
  };
  const due = new Map<string, number>();
  const ctx: GameContext = {
    now: () => t,
    schedule: (key, ms) => void due.set(key, t + ms),
    cancel: (key) => void due.delete(key),
    random,
    connectedPlayerIds: () => ids,
  };
  let s = bombesParty.initialize(bombesParty.settingsSchema.parse({ rounds }), players, ctx);
  const started = bombesParty.start(s, ctx);
  if (!started.ok) throw new Error(started.error);
  s = started.state;

  let steps = 0;
  while (!bombesParty.isFinished(s) && steps < 50_000) {
    steps++;
    t += 100;
    for (const [key, at] of [...due]) {
      if (at > t) continue;
      due.delete(key);
      s = bombesParty.onTimer(s, key, ctx);
    }
    for (const p of players) {
      const sug = bombesParty.suggest?.(s, p.id, random);
      if (!sug || random() > 0.35) continue;
      const res = bombesParty.handleAction(s, p, sug.type, sug.payload, ctx);
      if (res.ok) s = res.state;
    }
  }
  return { s, steps };
}

describe('Bombes party : robots', () => {
  for (const seed of [7, 42, 1234, 99991]) {
    it(`une partie de robots se termine proprement (graine ${seed})`, () => {
      const { s, steps } = playWithBots(seed, 2);
      expect(bombesParty.isFinished(s)).toBe(true);
      expect(steps).toBeLessThan(50_000);
      const total = Object.values(s.points).reduce((a, b) => a + b, 0);
      // Au plus un vainqueur par manche : 100 points chacune.
      expect(total).toBeLessThanOrEqual(200);
      expect(total % 100).toBe(0);
    });
  }

  it('les vues publique et privée ne révèlent rien d’interdit', () => {
    const { s } = playWithBots(5, 1);
    const pub = bombesParty.getPublicState(s) as { grid: string[]; ranking: unknown[] };
    expect(pub.grid.length).toBe(11);
    expect(pub.ranking).toHaveLength(4);
    const mine = bombesParty.getPlayerState(s, 'p1') as { alive: boolean };
    expect(typeof mine.alive).toBe('boolean');
  });
});

describe('Bombes party : animaux et vitesse', () => {
  it('le kangourou pousse une bombe d’une case', () => {
    const { state, ctx } = started([A, B]);
    const s: BombesPartyState = {
      ...state,
      grid: emptyGrid(),
      units: { ...state.units, a: { ...state.units.a!, mount: 'kangaroo' } },
      bombs: [{ id: 'k', x: 2, y: 1, owner: 'b', range: 2, endsAt: ctx.now() + 2500 }],
    };
    const res = bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.units.a).toMatchObject({ x: 2, y: 1, mount: 'kangaroo' });
    expect(res.state.bombs[0]).toMatchObject({ x: 3, y: 1 });
  });

  it('sans kangourou, une bombe bloque le passage', () => {
    const { state, ctx } = started([A, B]);
    const s: BombesPartyState = {
      ...state,
      grid: emptyGrid(),
      bombs: [{ id: 'k', x: 2, y: 1, owner: 'b', range: 2, endsAt: ctx.now() + 2500 }],
    };
    const res = bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.units.a).toMatchObject({ x: 1, y: 1 });
  });

  it('l’animal encaisse une explosion avant le joueur', () => {
    const { state, ctx } = started([A, B]);
    const s: BombesPartyState = {
      ...state,
      grid: emptyGrid(),
      units: { ...state.units, a: { ...state.units.a!, mount: 'dino' } },
      bombs: [{ id: 'z', x: 1, y: 1, owner: 'b', range: 2, endsAt: ctx.now() }],
    };
    const next = bombesParty.onTimer(s, 'bomb:z', ctx);
    expect(next.units.a).toMatchObject({ alive: true, mount: null });
    expect(next.phase).toBe('play');
  });

  it('la vitesse raccourcit le délai entre deux pas', () => {
    const { state, ctx, clock } = started([A, B]);
    const s: BombesPartyState = {
      ...state,
      grid: emptyGrid(),
      units: { ...state.units, a: { ...state.units.a!, speed: 2 } },
    };
    clock.t += 120;
    const res = bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.units.a?.x).toBe(2);
  });

  it('un bonus d’animal monte sur le joueur', () => {
    const { state, ctx } = started([A, B]);
    const s: BombesPartyState = { ...state, grid: emptyGrid(), powerups: [{ x: 2, y: 1, kind: 'dino' }] };
    const res = bombesParty.handleAction(s, A, 'move', { dir: 'right' }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.units.a?.mount).toBe('dino');
    expect(res.state.powerups).toHaveLength(0);
  });
});
