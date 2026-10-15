import { describe, expect, it } from 'vitest';
import {
  banquise,
  banquiseJump,
  banquisePush,
  banquiseSetInput,
  banquiseStepBody,
  banquiseSupported,
  BANQUISE_LEVELS,
  BANQUISE_WIDTH,
  holeWidths,
  makeIce,
  newBody,
  type BanquiseBody,
  type BanquiseState,
} from '@partyhub/games';
import type { GameContext, PlayerRef } from '@partyhub/shared';

/**
 * Banquise : physique et règles pilotées à la main (horloge simulée, graine fixe),
 * puis des parties complètes jouées uniquement par des robots, sur plusieurs graines.
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
  positions: Record<string, { x: number; facing: -1 | 1 }>,
): BanquiseState {
  const bodies: BanquiseState['bodies'] = {};
  for (const [id, pos] of Object.entries(positions)) bodies[id] = newBody(pos.x, pos.facing);
  return { ...state, ice, bodies };
}

describe('Banquise : banquise de chaque niveau', () => {
  it('le niveau 1 est une banquise pleine, sans trou', () => {
    expect(makeIce(false, rng(3))).toBe('i'.repeat(BANQUISE_WIDTH));
    expect(holeWidths('i'.repeat(BANQUISE_WIDTH))).toEqual([]);
  });

  it('les niveaux 2 et 3 ont des trous de 1 ou 2 colonnes, séparés par au moins 2 colonnes de glace', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ice = makeIce(true, rng(seed));
      expect(ice.length).toBe(BANQUISE_WIDTH);
      // Les trois colonnes de chaque bord restent pleines.
      expect(ice.slice(0, 3), `seed ${seed}`).toBe('iii');
      expect(ice.slice(-3), `seed ${seed}`).toBe('iii');
      const widths = holeWidths(ice);
      expect(widths.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      for (const w of widths) expect([1, 2], `seed ${seed}`).toContain(w);
      // Au moins deux colonnes de glace entre deux trous successifs.
      const pieces = ice.split(/\.+/);
      for (const piece of pieces.slice(1, -1)) {
        expect(piece.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('la banquise est la même pour une même graine', () => {
    expect(makeIce(true, rng(42))).toBe(makeIce(true, rng(42)));
  });

  it('les personnages naissent sur la glace, répartis sur la largeur', () => {
    const players = [A, B, C, D, { id: 'e', name: 'Eva' }];
    const { state } = begin(players, 7);
    const bodies = Object.values(state.bodies);
    expect(bodies).toHaveLength(5);
    for (const b of bodies) expect(banquiseSupported(state.ice, b.x)).toBe(true);
    const xs = bodies.map((b) => b.x).sort((p, q) => p - q);
    expect(xs[4]! - xs[0]!).toBeGreaterThanOrEqual(8);
  });
});

describe('Banquise : physique du personnage', () => {
  it('un personnage qui court et saute franchit chaque trou, sur 200 banquises', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const ice = makeIce(true, rng(seed));
      let b: BanquiseBody = newBody(1.5, 1);
      let reached = false;
      for (let t = 0; t < 2400 && b.alive; t++) {
        // Le robot de référence : il court et saute dès qu'un trou est à une colonne devant lui.
        if (b.grounded && !isIceAt(ice, Math.floor(b.x + 1))) b = banquiseJump(b);
        b = banquiseSetInput(b, 1);
        b = banquiseStepBody(b, ice, 0, TICK / 1000, 0);
        if (b.x > BANQUISE_WIDTH - 2) {
          reached = true;
          break;
        }
      }
      expect(reached, `seed ${seed}`).toBe(true);
    }
  });

  it('le saut n’est possible qu’au sol, et un seul à la fois', () => {
    const grounded = newBody(10.5, 1);
    const jumping = banquiseJump(grounded);
    expect(jumping.grounded).toBe(false);
    expect(jumping.vy).toBeGreaterThan(0);
    expect(banquiseJump(jumping)).toBe(jumping);
  });

  it('un personnage qui marche au-dessus de l’eau tombe, puis disparaît sous la surface', () => {
    const ice = 'i'.repeat(3) + '.'.repeat(BANQUISE_WIDTH - 3);
    let b = banquiseSetInput(newBody(2.5, 1), 1);
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
    // Moins d'une seconde et demie entre le premier pas hors de la glace et l'élimination.
    expect((diedTick ?? 0) * TICK).toBeLessThan(1500);
  });

  it('une rafale fait glisser un personnage immobile ; sans rafale, il reste en place', () => {
    const ice = 'i'.repeat(BANQUISE_WIDTH);
    let calm = newBody(10.5, 1);
    let gust = newBody(10.5, 1);
    for (let t = 0; t < 40; t++) {
      calm = banquiseStepBody(calm, ice, 0, TICK / 1000, 0);
      gust = banquiseStepBody(gust, ice, 0, TICK / 1000, 5);
    }
    expect(Math.abs(calm.x - 10.5)).toBeLessThan(0.01);
    expect(gust.x - 10.5).toBeGreaterThan(1);
  });

  it('un personnage qui marche contre le vent avance malgré la rafale', () => {
    const ice = 'i'.repeat(BANQUISE_WIDTH);
    let walker = banquiseSetInput(newBody(10.5, 1), -1);
    for (let t = 0; t < 40; t++) walker = banquiseStepBody(walker, ice, 0, TICK / 1000, 5);
    expect(walker.x).toBeLessThan(10.5);
  });
});

describe('Banquise : poussée et collisions', () => {
  it('pousse le personnage placé devant, avec un délai entre deux poussées', () => {
    const now = 10_000;
    const pusher = newBody(5, 1);
    const target = newBody(5.6, 1);
    const first = banquisePush(pusher, target, now);
    expect(first).not.toBeNull();
    expect(first!.target.vx).toBeGreaterThan(0);
    // Pas de seconde poussée tout de suite.
    expect(banquisePush(first!.pusher, target, now + 100)).toBeNull();
    // Une fois le délai passé, de nouveau possible.
    expect(banquisePush(first!.pusher, target, now + 1300)).not.toBeNull();
  });

  it('ne pousse ni derrière soi ni trop loin', () => {
    const pusher = newBody(5, 1);
    expect(banquisePush(pusher, newBody(4.5, 1), 10_000)).toBeNull();
    expect(banquisePush(pusher, newBody(6.5, 1), 10_000)).toBeNull();
  });

  it('une poussée au bord fait tomber le personnage', () => {
    // La glace s'arrête après la colonne 9 : le personnage poussé est sur le dernier bloc.
    const ice = 'i'.repeat(10) + '.'.repeat(BANQUISE_WIDTH - 10);
    const res = banquisePush(newBody(8.7, 1), newBody(9.6, 1), 0)!;
    let target = res.target;
    for (let t = 0; t < 200 && target.alive; t++) {
      target = banquiseStepBody(target, ice, t * TICK, TICK / 1000, 0);
    }
    expect(target.alive).toBe(false);
  });
});

describe('Banquise : règles de partie', () => {
  it('le saut et la poussée ne changent rien pendant le compte à rebours', () => {
    const { h, state } = begin([A, B]);
    expect(state.phase).toBe('countdown');
    const res = banquise.handleAction(state, A, 'jump', undefined, h.ctx);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.bodies[A.id]!.grounded).toBe(true);
  });

  it('un niveau dure jusqu’au dernier joueur debout, qui gagne 100 points', () => {
    // A est au bord gauche, B au centre : la fonte emporte A en premier.
    const { h, state } = begin([A, B], 5);
    let s = place(state, state.ice, { [A.id]: { x: 0.5, facing: 1 }, [B.id]: { x: 10.5, facing: -1 } });
    s = toPlay(h, s);
    expect(s.phase).toBe('play');
    // Le niveau s'arrête dès la chute de A, bien avant la fin de l'annonce.
    for (let i = 0; i < 600 && s.phase === 'play'; i++) s = advance(h, s, TICK);
    expect(s.phase).toBe('level-over');
    expect(s.winners).toEqual([B.id]);
    expect(s.points[B.id]).toBe(100);
    expect(s.points[A.id]).toBe(0);
    expect(s.history).toEqual([{ level: 1, winners: [B.id] }]);
  });

  it('si tous tombent au même tick, tous ceux qui tombent à cet instant gagnent le niveau', () => {
    const { h, state } = begin([A, B], 9);
    let s = place({ ...state, ice: '.'.repeat(BANQUISE_WIDTH) }, '.'.repeat(BANQUISE_WIDTH), {
      [A.id]: { x: 4.5, facing: 1 },
      [B.id]: { x: 15.5, facing: -1 },
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
    expect(banquise.handleAction(init, A, 'input', { dir: 1 }, h.ctx).ok).toBe(false);
    const begun = banquise.start(init, h.ctx);
    expect(begun.ok).toBe(true);
    if (begun.ok) expect(banquise.start(begun.state, h.ctx).ok).toBe(false);
  });

  it('refuse une direction hors de -1, 0 et 1', () => {
    const { h, state } = begin([A, B], 1);
    const s = toPlay(h, state);
    expect(banquise.handleAction(s, A, 'input', { dir: 2 }, h.ctx).ok).toBe(false);
    expect(banquise.handleAction(s, A, 'input', { dir: -1 }, h.ctx).ok).toBe(true);
  });

  it('la poussée se refuse sans personne devant, et se recharge après un coup', () => {
    const { h, state } = begin([A, B], 4);
    const s = place(toPlay(h, state), 'i'.repeat(BANQUISE_WIDTH), {
      [A.id]: { x: 5.5, facing: 1 },
      [B.id]: { x: 15.5, facing: -1 },
    });
    const none = banquise.handleAction(s, A, 'push', undefined, h.ctx);
    expect(none.ok).toBe(false);

    const close = place(s, s.ice, {
      [A.id]: { x: 5.5, facing: 1 },
      [B.id]: { x: 6.1, facing: -1 },
    });
    const first = banquise.handleAction(close, A, 'push', undefined, h.ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = banquise.handleAction(first.state, A, 'push', undefined, h.ctx);
    expect(again.ok).toBe(false);
  });
});

describe('Banquise : vues', () => {
  it('la vue publique décrit la glace et les personnages, sans rien de caché', () => {
    const { h, state } = begin([A, B], 3);
    const view = banquise.getPublicState(toPlay(h, state)) as Record<string, unknown>;
    expect(view).toMatchObject({ phase: 'play', level: 1, levelCount: 3, width: BANQUISE_WIDTH });
    expect(view).toHaveProperty('ice');
    expect(view).toHaveProperty('bodies');
    expect(JSON.stringify(view)).not.toMatch(/"random"|"clock"/);
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

/** Vrai si la colonne `col` est de la glace. */
function isIceAt(ice: string, col: number): boolean {
  return col >= 0 && col < ice.length && ice[col] === 'i';
}
