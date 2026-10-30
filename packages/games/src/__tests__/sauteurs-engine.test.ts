import { describe, expect, it } from 'vitest';
import {
  COYOTE_STEPS,
  DEATH_TICKS,
  INVULN_TICKS,
  JUMP_BUFFER_STEPS,
  MAX_FALL_SPEED,
  MAX_RUN_SPEED,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  SPRING_SPEED,
  TICKS_PER_SECOND,
  TILE_BONUS,
  TILE_SOLID,
  createWorld,
  step,
  summary,
  validateLevel,
  type Level,
  type PlayerInput,
  type World,
} from '../sauteurs/engine.js';
import { LEVELS, LEVEL_MAX_COINS } from '../sauteurs/levels.js';
import { runBots } from '../sauteurs/bot.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Setter = (col: number, row: number, ch: string) => void;
type Filler = (c0: number, r0: number, c1: number, r1: number, ch: string) => void;

/** Construit un petit niveau d'essai : sol plein à partir de la ligne `floorTop`. */
function build(
  fn: (set: Setter, fill: Filler) => void,
  { width = 40, height = 14, floorTop = 12, timeLimit = 60 } = {},
): Level {
  const g = Array.from({ length: height }, (_, r) => Array.from({ length: width }, () => (r >= floorTop ? '#' : '.')));
  const set: Setter = (c, r, ch) => {
    g[r]![c] = ch;
  };
  const fill: Filler = (c0, r0, c1, r1, ch) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) set(c, r, ch);
  };
  fn(set, fill);
  const tiles = g.map((r) => r.join(''));
  let maxCoins = 0;
  for (const row of tiles) for (const ch of row) if (ch === 'o' || ch === '?') maxCoins++;
  return { id: 'test', name: 'Essai', theme: 'prairie', tiles, width, height, timeLimit, maxCoins };
}

const RIGHT: PlayerInput = { left: false, right: true, jump: false };
const IDLE: PlayerInput = { left: false, right: false, jump: false };
const JUMP: PlayerInput = { left: false, right: false, jump: true };
const RIGHT_JUMP: PlayerInput = { left: false, right: true, jump: true };

function one(level: Level): World {
  return createWorld(level, ['a']);
}
function run(world: World, n: number, input: PlayerInput | ((t: number) => PlayerInput), id = 'a'): void {
  for (let t = 0; t < n; t++) step(world, { [id]: typeof input === 'function' ? input(t) : input });
}
function P(world: World, i = 0) {
  return world.players[i]!;
}

describe('niveaux : forme et contenu', () => {
  it('les trois niveaux sont valides, originaux et dans les bornes demandées', () => {
    expect(LEVELS).toHaveLength(3);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(3);
    expect(new Set(LEVELS.map((l) => l.theme)).size).toBe(3);
    LEVELS.forEach((l, i) => {
      expect(validateLevel(l), l.name).toEqual([]);
      expect(l.width).toBeGreaterThanOrEqual(100);
      expect(l.width).toBeLessThanOrEqual(200);
      expect(l.height).toBeGreaterThanOrEqual(15);
      expect(l.height).toBeLessThanOrEqual(18);
      const flat = l.tiles.join('');
      const count = (ch: string) => [...flat].filter((c) => c === ch).length;
      expect(count('S'), 'départs').toBeGreaterThanOrEqual(8);
      expect(count('C'), 'points de contrôle').toBeGreaterThanOrEqual(2);
      expect(count('e'), 'ennemis').toBeGreaterThanOrEqual(3);
      expect(count('^'), 'pointes').toBeGreaterThanOrEqual(2);
      expect(count('J'), 'ressorts').toBeGreaterThanOrEqual(1);
      expect(count('?'), 'blocs bonus').toBeGreaterThanOrEqual(1);
      expect(count('o')).toBeGreaterThanOrEqual(10);
      expect(LEVEL_MAX_COINS[i]).toBe(l.maxCoins);
      expect(l.maxCoins).toBe(count('o') + count('?'));
      expect(l.timeLimit).toBeGreaterThanOrEqual(60);
      expect(l.timeLimit).toBeLessThanOrEqual(150);
    });
  });

  it('validateLevel refuse les niveaux mal formés', () => {
    const ok = build((set) => {
      set(1, 11, 'S');
      set(30, 11, 'F');
    });
    expect(validateLevel(ok)).toEqual([]);
    expect(validateLevel({ ...ok, tiles: [...ok.tiles.slice(0, 13), ok.tiles[13]!.slice(1)] })).not.toEqual([]);
    expect(validateLevel({ ...ok, tiles: ok.tiles.map((r) => r.replace('F', 'Z')) })).not.toEqual([]);
    expect(validateLevel({ ...ok, tiles: ok.tiles.map((r) => r.replace('S', '.')) })).not.toEqual([]);
    expect(validateLevel({ ...ok, tiles: ok.tiles.map((r) => r.replace('F', '.')) })).not.toEqual([]);
    expect(validateLevel({ ...ok, maxCoins: 3 })).not.toEqual([]);
    const twoFlags = build((set) => {
      set(1, 11, 'S');
      set(30, 11, 'F');
      set(32, 11, 'F');
    });
    expect(validateLevel(twoFlags)).not.toEqual([]);
  });
});

describe('moteur : physique', () => {
  const flat = build((set) => set(2, 11, 'S'));

  it('est déterministe : mêmes entrées, même monde (comparaison profonde)', () => {
    const play = (): World => {
      const w = createWorld(LEVELS[1]!, ['a', 'b', 'c']);
      const rnd = mulberry32(42);
      let held: Record<string, PlayerInput> = {};
      for (let t = 0; t < 1500; t++) {
        if (t % 9 === 0) {
          held = {};
          for (const id of ['a', 'b', 'c']) {
            held[id] = { left: rnd() < 0.15, right: rnd() < 0.8, jump: rnd() < 0.4 };
          }
        }
        step(w, held);
      }
      return w;
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(a.tick).toBe(1500);
  });

  it('applique la gravité, pose le coureur sur le sol et plafonne la chute', () => {
    const w = one(build((set) => set(2, 1, 'S'), { height: 40, floorTop: 38 }));
    let maxVy = 0;
    let airborne = 0;
    for (let t = 0; t < 120 && !P(w).onGround; t++) {
      step(w, {});
      maxVy = Math.max(maxVy, P(w).vy);
      airborne++;
    }
    expect(P(w).onGround).toBe(true);
    expect(P(w).y).toBe(38);
    expect(P(w).vy).toBe(0);
    expect(airborne).toBeGreaterThan(20);
    expect(maxVy).toBeLessThanOrEqual(MAX_FALL_SPEED);
    expect(maxVy).toBeCloseTo(MAX_FALL_SPEED, 6);
    expect(MAX_FALL_SPEED).toBeLessThan(1);
    step(w, {});
    expect(P(w).y).toBe(38);
    expect(P(w).anim).toBe('idle');
  });

  it('court avec accélération et frottement', () => {
    const w = one(flat);
    step(w, { a: RIGHT });
    expect(P(w).vx).toBeGreaterThan(0);
    expect(P(w).vx).toBeLessThan(MAX_RUN_SPEED);
    run(w, 3, RIGHT);
    expect(P(w).vx).toBeLessThan(MAX_RUN_SPEED);
    expect(P(w).anim).toBe('run');
    run(w, 40, RIGHT);
    expect(P(w).vx).toBe(MAX_RUN_SPEED);
    run(w, 30, IDLE);
    expect(P(w).vx).toBe(0);
    expect(P(w).anim).toBe('idle');
    run(w, 40, { left: true, right: false, jump: false });
    expect(P(w).dir).toBe(-1);
    expect(P(w).vx).toBeLessThan(0);
  });

  it('saute à hauteur variable : maxi environ 3,4 cases (3 cases franchissables), relâcher coupe le saut', () => {
    const rise = (heldSteps: number): number => {
      const w = one(flat);
      let minY = P(w).y;
      run(w, 80, (t) => (t < heldSteps ? JUMP : IDLE));
      // run n'expose pas la trajectoire : on la rejoue pas à pas.
      const w2 = one(flat);
      for (let t = 0; t < 80; t++) {
        step(w2, { a: t < heldSteps ? JUMP : IDLE });
        minY = Math.min(minY, P(w2).y);
      }
      return 12 - minY;
    };
    const max = rise(80);
    const min = rise(1);
    const mid = rise(8);
    expect(max).toBeGreaterThan(3.2);
    expect(max).toBeLessThan(3.6);
    expect(min).toBeGreaterThan(0.7);
    expect(min).toBeLessThan(1.3);
    expect(mid).toBeGreaterThan(min);
    expect(mid).toBeLessThan(max);
  });

  it('accorde un temps de grâce après avoir quitté un bord', () => {
    const ledge = build(
      (set, fill) => {
        set(2, 11, 'S');
        fill(10, 12, 39, 13, '.');
      },
      { width: 40 },
    );
    const attempt = (late: number): boolean => {
      const w = one(ledge);
      for (let t = 0; t < 200 && P(w).onGround; t++) step(w, { a: RIGHT });
      expect(P(w).onGround).toBe(false);
      run(w, late, RIGHT);
      step(w, { a: RIGHT_JUMP });
      return P(w).vy < 0;
    };
    expect(attempt(0)).toBe(true);
    expect(attempt(COYOTE_STEPS - 2)).toBe(true);
    expect(attempt(COYOTE_STEPS + 3)).toBe(false);
  });

  it('mémorise un saut demandé juste avant de toucher le sol (tampon)', () => {
    const tall = build((set) => set(2, 3, 'S'), { height: 14, floorTop: 12 });
    const probe = one(tall);
    let landing = 0;
    for (let t = 1; t < 200; t++) {
      step(probe, {});
      if (P(probe).onGround) {
        landing = t;
        break;
      }
    }
    expect(landing).toBeGreaterThan(20);
    const jumpTick = (pressAt: number): number | null => {
      const w = one(tall);
      let found: number | null = null;
      for (let t = 1; t < landing + 20; t++) {
        step(w, { a: t === pressAt ? JUMP : IDLE });
        if (w.events.some((e) => e.type === 'jump')) found = t;
      }
      return found;
    };
    const early = jumpTick(landing - (JUMP_BUFFER_STEPS - 2));
    expect(early).not.toBeNull();
    expect(early!).toBeLessThanOrEqual(landing + 2);
    expect(jumpTick(landing - JUMP_BUFFER_STEPS - 8)).toBeNull();
  });

  it('ne traverse jamais un mur ni un sol, à vitesse maximale, sur 1000 pas aléatoires', () => {
    const rnd = mulberry32(7);
    const arena = build(
      (set, fill) => {
        for (let i = 0; i < 8; i++) set(1 + i, 11, 'S');
        for (let i = 0; i < 90; i++) {
          const c = 6 + Math.floor(rnd() * 48);
          const r = 3 + Math.floor(rnd() * 8);
          set(c, r, rnd() < 0.2 ? '?' : rnd() < 0.5 ? '#' : 'B');
          if (rnd() < 0.4) fill(c, r, c, r + 1 + Math.floor(rnd() * 3), '#');
        }
        fill(30, 12, 31, 13, '.');
      },
      { width: 60, height: 14 },
    );
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const w = createWorld(arena, ids);
    const solid = (c: number, r: number): boolean => {
      if (c < 0 || c >= arena.width) return true;
      if (r < 0 || r >= arena.height) return false;
      const code = w.map[r * arena.width + c];
      return code === TILE_SOLID || code === TILE_BONUS;
    };
    let held: Record<string, PlayerInput> = {};
    let maxSpeedSeen = 0;
    for (let t = 0; t < 1000; t++) {
      if (t % 7 === 0) {
        held = {};
        for (const id of ids) held[id] = { left: rnd() < 0.2, right: rnd() < 0.85, jump: rnd() < 0.5 };
      }
      step(w, held);
      for (const p of w.players) {
        if (p.dead) continue;
        maxSpeedSeen = Math.max(maxSpeedSeen, Math.abs(p.vx));
        expect(Math.abs(p.vx)).toBeLessThanOrEqual(MAX_RUN_SPEED + 1e-9);
        expect(p.vy).toBeLessThanOrEqual(MAX_FALL_SPEED + 1e-9);
        const l = p.x - PLAYER_HALF_WIDTH + 1e-4;
        const r = p.x + PLAYER_HALF_WIDTH - 1e-4;
        const top = p.y - PLAYER_HEIGHT + 1e-4;
        const bottom = p.y - 1e-4;
        for (let row = Math.floor(top); row <= Math.floor(bottom); row++) {
          for (let col = Math.floor(l); col <= Math.floor(r); col++) {
            if (solid(col, row)) throw new Error(`pas ${t} : ${p.id} dans la case ${col},${row} (x=${p.x}, y=${p.y})`);
          }
        }
        expect(p.x).toBeGreaterThanOrEqual(PLAYER_HALF_WIDTH - 1e-6);
        expect(p.x).toBeLessThanOrEqual(arena.width - PLAYER_HALF_WIDTH + 1e-6);
      }
    }
    expect(maxSpeedSeen).toBeCloseTo(MAX_RUN_SPEED, 6);
  });

  it("s'arrête contre un mur à pleine vitesse", () => {
    const w = one(
      build((set, fill) => {
        set(2, 11, 'S');
        fill(15, 5, 15, 11, '#');
      }),
    );
    run(w, 200, RIGHT);
    expect(P(w).x).toBeLessThan(15 - PLAYER_HALF_WIDTH + 1e-9);
    expect(P(w).x).toBeGreaterThan(15 - PLAYER_HALF_WIDTH - 0.01);
    expect(P(w).vx).toBe(0);
  });

  it("traverse une plateforme « = » par dessous mais s'y pose par dessus", () => {
    const level = build((set, fill) => {
      set(10, 11, 'S');
      fill(8, 10, 12, 10, '=');
    });
    const w = one(level);
    run(w, 80, JUMP); // saut maintenu : monte à travers la plateforme puis retombe dessus
    expect(P(w).y).toBe(10);
    expect(P(w).onGround).toBe(true);
    const above = one(
      build((set, fill) => {
        set(10, 3, 'S');
        fill(8, 10, 12, 10, '=');
      }),
    );
    run(above, 120, IDLE);
    expect(P(above).y).toBe(10);
    expect(P(above).onGround).toBe(true);
  });

  it('un bloc bonus frappé par dessous donne une pièce une seule fois et reste solide', () => {
    const level = build((set) => {
      set(10, 11, 'S');
      set(10, 8, '?');
    });
    const w = one(level);
    let blockCoins = 0;
    for (let n = 0; n < 2; n++) {
      for (let t = 0; t < 70; t++) {
        step(w, { a: t < 30 ? JUMP : IDLE });
        blockCoins += w.events.filter((e) => e.type === 'coin' && e.source === 'block').length;
        expect(P(w).y - PLAYER_HEIGHT).toBeGreaterThanOrEqual(9 - 1e-9); // jamais à travers le bloc
      }
    }
    expect(blockCoins).toBe(1);
    expect(P(w).coins).toBe(1);
    expect(P(w).blockHit).toEqual([true]);
    const above = one(
      build((set) => {
        set(10, 3, 'S');
        set(10, 8, '?');
      }),
    );
    run(above, 100, IDLE);
    expect(P(above).y).toBe(8);
  });

  it('un ressort propulse bien plus haut qu’un saut', () => {
    const level = build(
      (set) => {
        set(6, 15, 'S');
        set(10, 15, 'J');
      },
      { height: 20, floorTop: 16 },
    );
    const w = one(level);
    let minY = 99;
    let sprung = false;
    for (let t = 0; t < 120; t++) {
      step(w, { a: t < 40 ? RIGHT : IDLE });
      minY = Math.min(minY, P(w).y);
      if (w.events.some((e) => e.type === 'spring')) sprung = true;
    }
    expect(sprung).toBe(true);
    expect(w.springs[0]!.pressedTick).toBeGreaterThan(0);
    expect(16 - minY).toBeGreaterThan(6);
    expect(SPRING_SPEED).toBeGreaterThan(0.5);
  });

  it('un ennemi écrasé en retombant dessus rebondit, sans perdre de vie', () => {
    const level = build((set, fill) => {
      set(10, 3, 'S');
      set(10, 11, 'e');
      fill(9, 10, 9, 11, '#'); // couloir étroit : l'ennemi reste en place
      fill(11, 10, 11, 11, '#');
    });
    const w = one(level);
    let stomped = false;
    let bounce = 0;
    for (let t = 0; t < 120; t++) {
      step(w, {});
      if (w.events.some((e) => e.type === 'stomp')) {
        stomped = true;
        bounce = P(w).vy;
      }
    }
    expect(stomped).toBe(true);
    expect(bounce).toBeLessThan(0);
    expect(P(w).stomped).toEqual([true]);
    expect(P(w).deaths).toBe(0);
  });

  it('un ennemi touché de côté coûte une vie : retour au départ puis invulnérabilité', () => {
    const level = build((set) => {
      set(2, 11, 'S');
      set(12, 11, 'e');
    });
    const w = one(level);
    let died = -1;
    for (let t = 0; t < 200 && died < 0; t++) {
      step(w, { a: RIGHT });
      if (w.events.some((e) => e.type === 'death' && e.cause === 'enemy')) died = t;
    }
    expect(died).toBeGreaterThan(0);
    expect(P(w).deaths).toBe(1);
    expect(summary(w, 'a').alive).toBe(false);
    expect(P(w).anim).toBe('hurt');
    run(w, DEATH_TICKS, IDLE);
    expect(summary(w, 'a').alive).toBe(true);
    expect(P(w).x).toBe(2.5);
    expect(P(w).y).toBe(12);
    expect(P(w).invuln).toBeGreaterThan(INVULN_TICKS - 5);
    // Invulnérable : l'ennemi ne fait rien ; sinon il tue.
    const e = w.enemies[0]!;
    P(w).x = e.x;
    P(w).y = e.y;
    step(w, {});
    expect(P(w).deaths).toBe(1);
    P(w).invuln = 0;
    step(w, {});
    expect(P(w).deaths).toBe(2);
  });

  it('les pointes tuent, et on peut les sauter', () => {
    const level = build((set) => {
      set(2, 11, 'S');
      set(14, 11, '^');
    });
    const walk = one(level);
    run(walk, 150, RIGHT);
    expect(P(walk).deaths).toBeGreaterThanOrEqual(1);
    const hop = one(level);
    for (let t = 0; t < 150; t++) {
      step(hop, { a: { left: false, right: true, jump: P(hop).x > 11.2 && P(hop).x < 14.5 } });
    }
    expect(P(hop).deaths).toBe(0);
    expect(P(hop).x).toBeGreaterThan(16);
  });

  it('une chute dans le vide est une mort ; retour au départ sans point de contrôle', () => {
    const level = build((set, fill) => {
      set(2, 11, 'S');
      fill(12, 12, 16, 13, '.');
    });
    const w = one(level);
    let cause: string | null = null;
    for (let t = 0; t < 200 && !cause; t++) {
      step(w, { a: RIGHT });
      for (const e of w.events) if (e.type === 'death') cause = e.cause;
    }
    expect(cause).toBe('void');
    run(w, DEATH_TICKS, IDLE);
    expect(P(w).x).toBe(2.5);
    expect(P(w).deaths).toBe(1);
  });

  it('un point de contrôle devient le nouveau retour après une mort', () => {
    const level = build((set) => {
      set(2, 11, 'S');
      set(8, 11, 'C');
      set(16, 11, '^');
    });
    const w = one(level);
    let checkpointEvents = 0;
    for (let t = 0; t < 200; t++) {
      step(w, { a: RIGHT });
      checkpointEvents += w.events.filter((e) => e.type === 'checkpoint').length;
    }
    expect(checkpointEvents).toBe(1);
    expect(P(w).checkpointIndex).toBe(0);
    expect(P(w).deaths).toBeGreaterThanOrEqual(1);
    // Après la mort, le coureur est repassé par le point de contrôle (x = 8,5) et non par le départ (2,5).
    const w2 = one(level);
    let afterDeath: number | null = null;
    for (let t = 0; t < 400 && afterDeath === null; t++) {
      step(w2, { a: t < 150 ? RIGHT : IDLE });
      if (P(w2).deaths > 0 && !P(w2).dead) afterDeath = P(w2).x;
    }
    expect(afterDeath).toBe(8.5);
  });

  it("l'arrivée classe les coureurs et termine la course quand tous sont arrivés", () => {
    const level = build((set, fill) => {
      set(2, 11, 'S');
      set(3, 11, 'S');
      fill(20, 8, 20, 11, 'F');
    });
    const w = createWorld(level, ['a', 'b']);
    for (let t = 0; t < 400 && !w.over; t++) {
      step(w, { a: RIGHT, b: t > 40 ? RIGHT : IDLE });
    }
    expect(w.over).toBe(true);
    expect(w.timeUp).toBe(false);
    expect(w.finishOrder).toEqual(['a', 'b']);
    expect(P(w, 0).rank).toBe(1);
    expect(P(w, 1).rank).toBe(2);
    expect(summary(w, 'a').finished).toBe(true);
    expect(summary(w, 'a').finishTick!).toBeLessThan(summary(w, 'b').finishTick!);
    run(w, 5, IDLE, 'a');
    expect(P(w, 0).anim).toBe('win');
    const tick = w.tick;
    step(w, { a: RIGHT });
    expect(w.tick).toBe(tick);
    expect(w.events).toEqual([]);
  });

  it('les coureurs sont des fantômes : aucune collision, pièces propres à chacun', () => {
    const level = build((set) => {
      set(2, 11, 'S');
      set(12, 11, 'o');
    });
    const w = createWorld(level, ['a', 'b']);
    expect(P(w, 0).x).toBe(P(w, 1).x); // même départ
    for (let t = 0; t < 120; t++) step(w, { a: RIGHT, b: IDLE });
    expect(P(w, 0).x).toBeGreaterThan(P(w, 1).x + 5);
    expect(P(w, 1).x).toBe(2.5);
    expect(P(w, 0).coins).toBe(1);
    const w2 = createWorld(level, ['a', 'b']);
    for (let t = 0; t < 120; t++) step(w2, { a: RIGHT, b: RIGHT });
    expect(P(w2, 0).coins).toBe(1);
    expect(P(w2, 1).coins).toBe(1);
    expect(P(w2, 0).x).toBe(P(w2, 1).x);
    expect(P(w2, 0).coinTaken).toEqual([true]);
  });

  it('la limite de temps termine la course', () => {
    const w = one(build((set) => set(2, 11, 'S'), { timeLimit: 2 }));
    expect(w.timeLimitTicks).toBe(2 * TICKS_PER_SECOND);
    let timeupEvents = 0;
    for (let t = 0; t < 119; t++) step(w, {});
    expect(w.over).toBe(false);
    step(w, {});
    timeupEvents += w.events.filter((e) => e.type === 'timeup').length;
    expect(w.over).toBe(true);
    expect(w.timeUp).toBe(true);
    expect(timeupEvents).toBe(1);
    step(w, { a: RIGHT });
    expect(w.tick).toBe(120);
    expect(P(w).x).toBe(2.5);
    expect(summary(w, 'a')).toMatchObject({ finished: false, finishTick: null, deaths: 0, alive: true });
  });

  it('vide la liste des événements à chaque pas', () => {
    const w = one(build((set) => set(2, 11, 'S')));
    step(w, { a: JUMP });
    expect(w.events.map((e) => e.type)).toContain('jump');
    step(w, { a: IDLE });
    expect(w.events.filter((e) => e.type === 'jump')).toHaveLength(0);
  });

  it('résume un joueur inconnu sans planter', () => {
    const w = one(build((set) => set(2, 11, 'S')));
    expect(summary(w, 'zz').alive).toBe(false);
  });

  it('les animations suivent l’état du coureur', () => {
    const w = one(build((set) => set(2, 11, 'S')));
    const seen = new Set<string>();
    for (let t = 0; t < 90; t++) {
      step(w, { a: t < 30 ? RIGHT : t === 30 ? RIGHT_JUMP : t < 60 ? RIGHT : IDLE });
      seen.add(P(w).anim);
    }
    expect(seen).toEqual(new Set(['idle', 'run', 'jump', 'fall']));
  });
});

describe('robot : les trois niveaux sont franchissables de bout en bout', () => {
  LEVELS.forEach((level, index) => {
    it(`${level.name} : 8 coureurs-robots arrivent avant la limite de ${level.timeLimit} s`, () => {
      const ids = Array.from({ length: 8 }, (_, i) => `r${i}`);
      const w = createWorld(level, ids);
      const result = runBots(w, (i) => ({ horizon: 85 + 5 * i, replan: 2 + (i % 4) }));
      expect(result.finished).toBe(true);
      expect(w.timeUp).toBe(false);
      expect(result.ticks).toBeLessThan(level.timeLimit * TICKS_PER_SECOND);
      expect(w.finishOrder).toHaveLength(8);
      for (const id of ids) {
        const s = summary(w, id);
        expect(s.finished, id).toBe(true);
        expect(s.finishTick!, id).toBeLessThan(level.timeLimit * TICKS_PER_SECOND);
        expect(s.coins).toBeLessThanOrEqual(LEVEL_MAX_COINS[index]!);
        expect(s.deaths).toBeLessThan(6);
      }
    }, 120_000);

    it(`${level.name} : ne se gagne pas en restant immobile ni en courant sans sauter`, () => {
      const idle = createWorld(level, ['a']);
      const lazy = createWorld(level, ['b']);
      for (let t = 0; t < level.timeLimit * TICKS_PER_SECOND; t++) {
        step(idle, {});
        step(lazy, { b: RIGHT });
      }
      expect(summary(idle, 'a').finished).toBe(false);
      expect(summary(lazy, 'b').finished).toBe(false);
    });
  });

  it('chaque niveau est un peu plus long que le précédent', () => {
    expect(LEVELS[0]!.width).toBeLessThan(LEVELS[1]!.width);
    expect(LEVELS[1]!.width).toBeLessThan(LEVELS[2]!.width);
  });
});
