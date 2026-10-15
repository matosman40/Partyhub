import { describe, expect, it } from 'vitest';
import {
  banquise,
  banquiseErode,
  banquiseIceAt,
  banquiseInMask,
  banquiseJump,
  banquisePush,
  banquiseSeparate,
  banquiseSetInput,
  banquiseSpawnCells,
  banquiseStepBody,
  banquiseSupported,
  BANQUISE_COLS,
  BANQUISE_LEVELS,
  BANQUISE_ROWS,
  holeCount,
  makeIce,
  newBody,
  type BanquiseBody,
  type BanquiseState,
} from '@partyhub/games';
import type { GameContext, PlayerRef } from '@partyhub/shared';

/**
 * Banquise : physique et règles pilotées à la main (horloge simulée, graine fixe),
 * puis des parties complètes jouées uniquement par des robots, sur plusieurs graines.
 * Le plan est un îlot arrondi en 2D : les personnages marchent dans les quatre directions.
 * Valeurs de référence : docs/JEU-BANQUISE.md.
 */

const TICK = 50;
const A: PlayerRef = { id: 'a', name: 'Alice' };
const B: PlayerRef = { id: 'b', name: 'Bob' };
const C: PlayerRef = { id: 'c', name: 'Chloé' };
const D: PlayerRef = { id: 'd', name: 'Dan' };

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Harness {
  ctx: GameContext;
  clock: { t: number };
}

function harness(seed: number, connected: PlayerRef[]): Harness {
  const clock = { t: 1_000_000 };
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: () => undefined,
    cancel: () => undefined,
    random: rng(seed),
    connectedPlayerIds: () => connected.map((p) => p.id),
  };
  return { ctx, clock };
}

/** Partie lancée : phase « countdown » du premier niveau. */
function begin(players: PlayerRef[], seed = 1): { h: Harness; state: BanquiseState } {
  const h = harness(seed, players);
  const init = banquise.initialize({}, players, h.ctx);
  const res = banquise.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  return { h, state: res.state };
}

/** Avance l'horloge et fait tourner le tick du serveur, `ms` millisecondes durant. */
function advance(h: Harness, state: BanquiseState, ms: number): BanquiseState {
  let s = state;
  for (let t = 0; t < ms; t += TICK) {
    h.clock.t += TICK;
    s = banquise.onTimer(s, 'tick', h.ctx);
  }
  return s;
}

/** Passe le compte à rebours : la partie est en phase « play ». */
function toPlay(h: Harness, state: BanquiseState): BanquiseState {
  return advance(h, state, 3000 + TICK);
}

/** Place les personnages à des positions choisies, sur une glace donnée. */
function place(
  state: BanquiseState,
  ice: string,
  positions: Record<string, { x: number; z: number; facing: -1 | 1 }>,
): BanquiseState {
  const bodies: BanquiseState['bodies'] = {};
  for (const [id, pos] of Object.entries(positions)) bodies[id] = newBody(pos.x, pos.z, pos.facing);
  return { ...state, ice, bodies };
}

/** Glace pleine de l'îlot (niveau 1, sans trou). */
function island(): string {
  return makeIce(false, rng(1));
}

/** Nombre de cases de l'îlot : les cases dans le contour arrondi. */
function islandCells(): number {
  let n = 0;
  for (let row = 0; row < BANQUISE_ROWS; row++) {
    for (let col = 0; col < BANQUISE_COLS; col++) if (banquiseInMask(col, row)) n++;
  }
  return n;
}

/** Vrai si toutes les cases de glace forment un seul morceau. */
function connected(ice: string): boolean {
  const cells: number[] = [];
  for (let i = 0; i < ice.length; i++) if (ice[i] === 'i') cells.push(i);
  if (cells.length === 0) return true;
  const seen = new Set<number>([cells[0]!]);
  const stack = [cells[0]!];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const col = cur % BANQUISE_COLS;
    const row = Math.floor(cur / BANQUISE_COLS);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= BANQUISE_COLS || r < 0 || r >= BANQUISE_ROWS) continue;
      const j = r * BANQUISE_COLS + c;
      if (ice[j] === 'i' && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === cells.length;
}

describe('Banquise : banquise de chaque niveau', () => {
  it('le niveau 1 est un îlot arrondi plein, sans trou', () => {
    const ice = island();
    expect(ice.length).toBe(BANQUISE_COLS * BANQUISE_ROWS);
    expect(holeCount(ice)).toBe(0);
    expect(ice.split('').filter((c) => c === 'i')).toHaveLength(islandCells());
    // Les coins de la grille restent vides : le contour est arrondi.
    expect(banquiseIceAt(ice, 0.5, 0.5)).toBe(false);
    expect(banquiseIceAt(ice, BANQUISE_COLS / 2, BANQUISE_ROWS / 2)).toBe(true);
  });

  it('les niveaux 2 et 3 ont des trous au centre, et l’îlot reste d’un seul tenant', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ice = makeIce(true, rng(seed));
      expect(ice.length, `seed ${seed}`).toBe(BANQUISE_COLS * BANQUISE_ROWS);
      const holes = holeCount(ice);
      expect(holes, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(holes, `seed ${seed}`).toBeLessThanOrEqual(12);
      expect(connected(ice), `seed ${seed}`).toBe(true);
    }
  });

  it('la banquise est la même pour une même graine', () => {
    expect(makeIce(true, rng(42))).toBe(makeIce(true, rng(42)));
  });

  it('les personnages naissent sur la glace, en anneau autour du centre, à des places différentes', () => {
    const players = [A, B, C, D, { id: 'e', name: 'Eva' }, { id: 'f', name: 'Fred' }, { id: 'g', name: 'Gus' }, { id: 'h', name: 'Hugo' }];
    const { state } = begin(players, 7);
    const bodies = Object.values(state.bodies);
    expect(bodies).toHaveLength(8);
    for (const b of bodies) expect(banquiseSupported(state.ice, b.x, b.z)).toBe(true);
    const spots = new Set(bodies.map((b) => `${Math.floor(b.x)},${Math.floor(b.z)}`));
    expect(spots.size).toBe(8);
    // Les personnages sont espacés : pas deux sur la même case, ni côte à côte.
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const d = Math.hypot(bodies[i]!.x - bodies[j]!.x, bodies[i]!.z - bodies[j]!.z);
        expect(d).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('les points de départ tombent sur la glace, même sur un îlot percé de trous', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const ice = makeIce(true, rng(seed));
      for (const idx of banquiseSpawnCells(ice, 4)) {
        expect(ice[idx], `seed ${seed}`).toBe('i');
      }
    }
  });

  it('l’érosion retire une case du bord ; un morceau coupé du reste tombe aussi, et il ne reste qu’un seul morceau', () => {
    let ice = island();
    const before = ice.split('').filter((c) => c === 'i').length;
    for (let k = 0; k < 15; k++) {
      const next = banquiseErode(ice, rng(k + 1));
      // Au moins une case de moins à chaque fonte.
      expect(next.split('').filter((c) => c === 'i').length).toBeLessThan(ice.split('').filter((c) => c === 'i').length);
      ice = next;
    }
    const after = ice.split('').filter((c) => c === 'i').length;
    expect(after).toBeLessThanOrEqual(before - 15);
    expect(after).toBeGreaterThan(before - 25);
    expect(connected(ice)).toBe(true);
  });
});

describe('Banquise : physique du personnage', () => {
  it('un personnage qui court sur la ligne du milieu saute les trous de deux cases et atteint le bord opposé', () => {
    // Ligne 4 : deux trous de deux cases, aux colonnes 3-4 et 7-8.
    const cells = island().split('');
    for (const col of [3, 4, 7, 8]) cells[4 * BANQUISE_COLS + col] = '.';
    const ice = cells.join('');
    let b: BanquiseBody = newBody(0.5, 4.5, 1);
    let reached = false;
    for (let t = 0; t < 2400 && b.alive; t++) {
      // Le robot de référence saute dès qu'un trou est à une case devant lui.
      if (b.grounded && !banquiseIceAt(ice, b.x + 1, b.z)) b = banquiseJump(b);
      b = banquiseSetInput(b, 1, 0);
      b = banquiseStepBody(b, ice, 0, TICK / 1000, 0);
      if (b.x > BANQUISE_COLS - 1) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
  });

  it('en diagonale, la vitesse de croisière est la même que tout droit', () => {
    const ice = island();
    let straight = banquiseSetInput(newBody(5.5, 4.5, 1), 1, 0);
    let diagonal = banquiseSetInput(newBody(5.5, 4.5, 1), 1, 1);
    // Trois quarts de seconde, assez pour atteindre la vitesse de croisière, sans sortir de l'îlot.
    for (let t = 0; t < 15; t++) {
      straight = banquiseStepBody(straight, ice, 0, TICK / 1000, 0);
      diagonal = banquiseStepBody(diagonal, ice, 0, TICK / 1000, 0);
    }
    const vStraight = Math.hypot(straight.vx, straight.vz);
    const vDiagonal = Math.hypot(diagonal.vx, diagonal.vz);
    expect(vStraight).toBeGreaterThan(4);
    expect(Math.abs(vDiagonal - vStraight)).toBeLessThan(0.05);
  });

  it('le saut n’est possible qu’au sol, et un seul à la fois', () => {
    const grounded = newBody(5.5, 4.5, 1);
    const jumping = banquiseJump(grounded);
    expect(jumping.grounded).toBe(false);
    expect(jumping.vy).toBeGreaterThan(0);
    expect(banquiseJump(jumping)).toBe(jumping);
  });

  it('un personnage qui marche hors de l’îlot tombe, puis disparaît sous la surface', () => {
    const ice = island();
    // Le bord gauche de la ligne du milieu : au-delà, il n'y a plus de glace.
    let b = banquiseSetInput(newBody(0.5, 4.5, -1), -1, 0);
    let diedTick: number | null = null;
    for (let t = 0; t < 200; t++) {
      b = banquiseStepBody(b, ice, t * TICK, TICK / 1000, 0);
      if (!b.alive) {
        diedTick = t;
        break;
      }
    }
    expect(diedTick).not.toBeNull();
    expect(b.diedAt).toBe((diedTick ?? 0) * TICK);
    expect((diedTick ?? 0) * TICK).toBeLessThan(2000);
  });

  it('une rafale fait glisser un personnage immobile sur l’axe x seulement ; sans rafale, il reste en place', () => {
    const ice = island();
    let calm = newBody(5.5, 4.5, 1);
    let gust = newBody(5.5, 4.5, 1);
    for (let t = 0; t < 40; t++) {
      calm = banquiseStepBody(calm, ice, 0, TICK / 1000, 0);
      gust = banquiseStepBody(gust, ice, 0, TICK / 1000, 5);
    }
    expect(Math.abs(calm.x - 5.5)).toBeLessThan(0.01);
    expect(gust.x - 5.5).toBeGreaterThan(1);
    expect(Math.abs(gust.z - 4.5)).toBeLessThan(0.01);
  });

  it('un personnage qui marche contre le vent avance malgré la rafale', () => {
    const ice = island();
    let walker = banquiseSetInput(newBody(5.5, 4.5, 1), -1, 0);
    for (let t = 0; t < 40; t++) walker = banquiseStepBody(walker, ice, 0, TICK / 1000, 5);
    expect(walker.x).toBeLessThan(5.5);
  });
});

describe('Banquise : poussée et collisions', () => {
  it('pousse le personnage placé devant, dans le sens du dernier mouvement, avec un délai entre deux poussées', () => {
    const now = 10_000;
    const pusher = setDir(newBody(5.5, 4.5, 1), 1, 0);
    const target = newBody(6.1, 4.5, 1);
    const first = banquisePush(pusher, target, now);
    expect(first).not.toBeNull();
    expect(first!.target.vx).toBeGreaterThan(0);
    expect(banquisePush(first!.pusher, target, now + 100)).toBeNull();
    expect(banquisePush(first!.pusher, target, now + 1300)).not.toBeNull();
  });

  it('pousse vers le bas (z) quand le dernier mouvement était vers le bas', () => {
    const pusher = setDir(newBody(5.5, 3.5, 1), 0, 1);
    const target = newBody(5.5, 4.1, 1);
    const res = banquisePush(pusher, target, 0);
    expect(res).not.toBeNull();
    expect(res!.target.vz).toBeGreaterThan(0);
    expect(Math.abs(res!.target.vx)).toBeLessThan(0.01);
  });

  it('ne pousse ni derrière soi, ni trop loin, ni trop sur le côté', () => {
    const pusher = setDir(newBody(5.5, 4.5, 1), 1, 0);
    expect(banquisePush(pusher, newBody(5.0, 4.5, 1), 10_000)).toBeNull();
    expect(banquisePush(pusher, newBody(6.8, 4.5, 1), 10_000)).toBeNull();
    // Cible à côté, décalée de 0,7 case : hors du couloir de poussée.
    expect(banquisePush(pusher, newBody(6.0, 5.2, 1), 10_000)).toBeNull();
  });

  it('une poussée en diagonale touche une cible placée dans la bonne diagonale', () => {
    const pusher = setDir(newBody(5.5, 4.5, 1), 1, 1);
    expect(banquisePush(pusher, newBody(6.0, 5.0, 1), 0)).not.toBeNull();
  });

  it('une poussée au bord fait tomber le personnage', () => {
    // La glace s'arrête après la colonne 9 : la cible, poussée vers la droite, tombe.
    const ice = Array.from({ length: BANQUISE_COLS * BANQUISE_ROWS }, (_, i) =>
      i % BANQUISE_COLS <= 9 && banquiseInMask(i % BANQUISE_COLS, Math.floor(i / BANQUISE_COLS)) ? 'i' : '.',
    ).join('');
    const res = banquisePush(setDir(newBody(8.5, 4.5, 1), 1, 0), newBody(9.3, 4.5, 1), 0)!;
    let target = res.target;
    for (let t = 0; t < 200 && target.alive; t++) {
      target = banquiseStepBody(target, ice, t * TICK, TICK / 1000, 0);
    }
    expect(target.alive).toBe(false);
  });

  it('deux personnages qui se heurtent se séparent et partagent leur vitesse', () => {
    const a = { ...newBody(5.5, 4.5, 1), vx: 0 };
    const b = { ...newBody(5.8, 4.5, 1), vx: -2 };
    const [sa, sb] = banquiseSeparate([a, b]) as [BanquiseBody, BanquiseBody];
    expect(Math.hypot(sb!.x - sa!.x, sb!.z - sa!.z)).toBeGreaterThanOrEqual(0.7 - 1e-9);
    expect(sa!.vx).toBeCloseTo(sb!.vx, 6);
  });

  it('deux personnages qui se heurtent de côté se séparent aussi en profondeur', () => {
    const a = newBody(5.5, 4.5, 1);
    const b = newBody(5.5, 4.8, 1);
    const [sa, sb] = banquiseSeparate([a, b]) as [BanquiseBody, BanquiseBody];
    expect(Math.hypot(sb!.x - sa!.x, sb!.z - sa!.z)).toBeGreaterThanOrEqual(0.7 - 1e-9);
  });
});

/** Donne une direction de marche à un personnage (sans le faire bouger). */
function setDir(b: BanquiseBody, dx: -1 | 0 | 1, dz: -1 | 0 | 1): BanquiseBody {
  return banquiseSetInput(b, dx, dz);
}

describe('Banquise : règles de partie', () => {
  it('le saut et la poussée ne changent rien pendant le compte à rebours', () => {
    const { h, state } = begin([A, B]);
    expect(state.phase).toBe('countdown');
    const res = banquise.handleAction(state, A, 'jump', undefined, h.ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.bodies[A.id]!.grounded).toBe(true);
  });

  it('un niveau dure jusqu’au dernier joueur debout, qui gagne 100 points', () => {
    const { h, state } = begin([A, B], 5);
    // A est hors de l'îlot : il tombe au premier pas. B reste au centre.
    let s = place(state, island(), {
      [A.id]: { x: -1.5, z: 4.5, facing: 1 },
      [B.id]: { x: 5.5, z: 4.5, facing: -1 },
    });
    s = toPlay(h, s);
    expect(s.phase).toBe('play');
    for (let i = 0; i < 600 && s.phase === 'play'; i++) s = advance(h, s, TICK);
    expect(s.phase).toBe('level-over');
    expect(s.winners).toEqual([B.id]);
    expect(s.points[B.id]).toBe(100);
    expect(s.points[A.id]).toBe(0);
    expect(s.history).toEqual([{ level: 1, winners: [B.id] }]);
  });

  it('si tous tombent au même tick, tous ceux qui tombent à cet instant gagnent le niveau', () => {
    const { h, state } = begin([A, B], 9);
    let s = place(state, island(), {
      [A.id]: { x: -1.5, z: 2.5, facing: 1 },
      [B.id]: { x: -1.5, z: 6.5, facing: -1 },
    });
    s = toPlay(h, s);
    s = advance(h, s, 1500);
    expect(s.phase).toBe('level-over');
    expect([...s.winners].sort()).toEqual([A.id, B.id]);
    expect(s.points[A.id]).toBe(100);
    expect(s.points[B.id]).toBe(100);
  });

  it('un joueur qui quitte pendant le jeu est éliminé, et peut terminer le niveau', () => {
    const { h, state } = begin([A, B], 11);
    let s = toPlay(h, state);
    s = banquise.onPlayerLeave(s, B, h.ctx);
    expect(s.phase).toBe('level-over');
    expect(s.winners).toEqual([A.id]);
  });

  it('après trois niveaux, la partie est terminée et le classement additionne les points', () => {
    const { h, state: first } = begin([A, B], 21);
    let s = first;
    for (let level = 1; level <= 3; level++) {
      s = toPlay(h, s);
      expect(s.level).toBe(level);
      // B quitte à chaque niveau : A est le dernier debout.
      s = banquise.onPlayerLeave(s, B, h.ctx);
      expect(s.phase).toBe('level-over');
      expect(s.winners).toEqual([A.id]);
      s = advance(h, s, 4000 + TICK);
    }
    expect(s.phase).toBe('final');
    expect(banquise.isFinished(s)).toBe(true);
    const ranking = banquise.calculateScores(s);
    expect(ranking[0]?.playerId).toBe(A.id);
    expect(ranking[0]?.points).toBe(300);
  });

  it('ne démarre qu’une fois, et refuse les actions avant le début', () => {
    const h = harness(2, [A, B]);
    const init = banquise.initialize({}, [A, B], h.ctx);
    expect(banquise.handleAction(init, A, 'input', { dx: 1, dz: 0 }, h.ctx).ok).toBe(false);
    const begun = banquise.start(init, h.ctx);
    expect(begun.ok).toBe(true);
    if (begun.ok) expect(banquise.start(begun.state, h.ctx).ok).toBe(false);
  });

  it('refuse une direction hors de -1, 0 et 1, et accepte les quatre directions', () => {
    const { h, state } = begin([A, B], 1);
    const s = toPlay(h, state);
    expect(banquise.handleAction(s, A, 'input', { dx: 2, dz: 0 }, h.ctx).ok).toBe(false);
    expect(banquise.handleAction(s, A, 'input', { dx: 0, dz: -1 }, h.ctx).ok).toBe(true);
    expect(banquise.handleAction(s, A, 'input', { dx: -1, dz: 0 }, h.ctx).ok).toBe(true);
    expect(banquise.handleAction(s, A, 'input', { dx: 1, dz: 1 }, h.ctx).ok).toBe(true);
  });

  it('la poussée se refuse sans personne devant, et se recharge après un coup', () => {
    const { h, state } = begin([A, B], 4);
    const s = place(toPlay(h, state), island(), {
      [A.id]: { x: 5.5, z: 4.5, facing: 1 },
      [B.id]: { x: 9.5, z: 4.5, facing: -1 },
    });
    const none = banquise.handleAction(s, A, 'push', undefined, h.ctx);
    expect(none.ok).toBe(false);

    const close = place(s, s.ice, {
      [A.id]: { x: 5.5, z: 4.5, facing: 1 },
      [B.id]: { x: 6.1, z: 4.5, facing: -1 },
    });
    const withDir = { ...close, bodies: { ...close.bodies, [A.id]: setDir(close.bodies[A.id]!, 1, 0) } };
    const first = banquise.handleAction(withDir, A, 'push', undefined, h.ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = banquise.handleAction(first.state, A, 'push', undefined, h.ctx);
    expect(again.ok).toBe(false);
  });
});

describe('Banquise : vues', () => {
  it('la vue publique décrit la glace, la taille du plan et les personnages, sans rien de caché', () => {
    const { h, state } = begin([A, B], 3);
    const view = banquise.getPublicState(toPlay(h, state)) as Record<string, unknown>;
    expect(view).toMatchObject({
      phase: 'play',
      level: 1,
      levelCount: 3,
      width: BANQUISE_COLS,
      height: BANQUISE_ROWS,
    });
    expect(view).toHaveProperty('ice');
    expect(view).toHaveProperty('bodies');
    expect(JSON.stringify(view)).not.toMatch(/"random"|"clock"/);
    const bodies = (view as { bodies: Array<{ z: number | null }> }).bodies;
    expect(bodies.every((b) => typeof b.z === 'number')).toBe(true);
  });

  it('la vue privée indique si le joueur peut sauter', () => {
    const { h, state } = begin([A, B], 1);
    const s = toPlay(h, state);
    expect((banquise.getPlayerState(s, A.id) as { canJump: boolean }).canJump).toBe(true);
    const jumped = banquise.handleAction(s, A, 'jump', undefined, h.ctx);
    expect(jumped.ok).toBe(true);
    if (jumped.ok) expect((banquise.getPlayerState(jumped.state, A.id) as { canJump: boolean }).canJump).toBe(false);
  });
});

describe('Banquise : robots', () => {
  it.each([1, 2, 3])('une partie complète jouée par quatre robots se termine (graine %i)', (seed) => {
    const players = [A, B, C, D];
    const { h, state: first } = begin(players, seed);
    let state = first;
    const bot = rng(seed * 97);
    const maxTicks = 60_000; // 3000 s simulées : la fonte garantit la fin bien avant
    let t = 0;
    for (; t < maxTicks && !banquise.isFinished(state); t++) {
      h.clock.t += TICK;
      state = banquise.onTimer(state, 'tick', h.ctx);
      for (const p of players) {
        const sug = banquise.suggest?.(state, p.id, bot);
        if (!sug) continue;
        const res = banquise.handleAction(state, p, sug.type, sug.payload, h.ctx);
        if (res.ok) state = res.state;
      }
    }
    expect(banquise.isFinished(state), `seed ${seed}, ${t} ticks`).toBe(true);
    expect(state.history).toHaveLength(3);
    for (const entry of state.history) expect(entry.winners.length).toBeGreaterThan(0);
    const total = Object.values(state.points).reduce((n, v) => n + v, 0);
    expect(total).toBeGreaterThanOrEqual(300);
  });

  it('les niveaux se suivent : fonte, crevasses, tempête', () => {
    expect(BANQUISE_LEVELS.map((l) => l.name)).toEqual(['La fonte', 'Les crevasses', 'La tempête']);
    expect(BANQUISE_LEVELS.map((l) => [l.holes, l.wind])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
  });
});
