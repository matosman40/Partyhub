import { describe, expect, it } from 'vitest';
import {
  AUTO_SPEED,
  BASE_SPEED,
  MAX_SPEED,
  RACKET_HALF,
  RACKET_SPEED,
  aimFromTilt,
  createRally,
  moveRackets,
  racketTarget,
  serve,
  stepRally,
  type Rally,
} from '../tennis/rules.js';

/** Échange réglé à la main : raquettes au centre, balle immobile, aucun automate ne bouge tant qu’on ne le dit pas. */
function rallyAt(active: boolean[], x: number, y: number, vx: number, vy: number): Rally {
  return {
    ball: { x, y, vx, vy, speed: Math.hypot(vx, vy) || BASE_SPEED },
    active,
    pos: [0.5, 0.5, 0.5, 0.5],
    aim: [null, null, null, null],
    bias: [0, 0, 0, 0],
  };
}

/** Générateur déterministe (congruence linéaire), pour des parties reproductibles. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Tennis party : coups et balles perdues', () => {
  it('une raquette qui couvre la balle renvoie le coup, plus vite', () => {
    const r = rallyAt([true, false, false, false], 0.5, 0.96, 0, 0.5);
    const events = stepRally(r, 0.02);
    expect(events).toEqual([{ type: 'hit', side: 0 }]);
    expect(r.ball.vy).toBeLessThan(0);
    expect(r.ball.speed).toBeGreaterThan(BASE_SPEED * 0.5);
    expect(r.ball.speed).toBeLessThanOrEqual(MAX_SPEED);
  });

  it('une balle qui passe à côté de la raquette est perdue', () => {
    // La raquette est à l’extrême gauche ; la balle arrive au milieu du côté bas, trop vite pour être rattrapée.
    const r = rallyAt([true, false, false, false], 0.5, 0.96, 0, 0.5);
    r.pos[0] = 0.1;
    const events = stepRally(r, 0.02);
    expect(events).toEqual([{ type: 'lost', side: 0 }]);
  });

  it('un côté sans joueur est un mur : la balle rebondit', () => {
    const r = rallyAt([false, false, false, false], 0.02, 0.5, -0.4, 0);
    const events = stepRally(r, 0.02);
    expect(events).toEqual([]);
    expect(r.ball.vx).toBeGreaterThan(0);
    expect(r.ball.x).toBeGreaterThan(0);
  });

  it('une balle qui va vers l’intérieur ne déclenche rien', () => {
    const r = rallyAt([true, true, false, false], 0.5, 0.5, 0.2, 0.2);
    expect(stepRally(r, 0.02)).toEqual([]);
  });

  it('une raquette automatique suit la balle qui arrive sur son côté', () => {
    const r = rallyAt([true, false, false, false], 0.3, 0.8, 0, 0.5);
    for (let i = 0; i < 20; i++) moveRackets(r, 0.02);
    expect(Math.abs((r.pos[0] ?? 0) - 0.3)).toBeLessThan(0.01);
    expect(AUTO_SPEED).toBeLessThan(RACKET_SPEED);
  });

  it('une commande du téléphone place la raquette, sans dépasser le côté', () => {
    const r = rallyAt([true, false, false, false], 0.5, 0.5, 0, 0);
    r.aim[0] = 1;
    moveRackets(r, 1);
    expect(r.pos[0]).toBeCloseTo(racketTarget(1));
    expect(r.pos[0]).toBeLessThanOrEqual(1 - RACKET_HALF);
    r.aim[0] = -1;
    moveRackets(r, 1);
    expect(r.pos[0]).toBeCloseTo(racketTarget(-1));
    expect(r.pos[0]).toBeGreaterThanOrEqual(RACKET_HALF);
  });

  it('un service part du centre vers un côté défendu', () => {
    // rng = 0.5 : le côté tiré est le second défendu, ici le haut.
    const ball = serve([true, true, false, false], () => 0.5);
    expect(ball).toMatchObject({ x: 0.5, y: 0.5 });
    expect(ball.vy).toBeLessThan(0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(BASE_SPEED);
  });
});

describe('Tennis party : commande du téléphone', () => {
  it('l’inclinaison pousse la raquette du bon côté selon la position du joueur', () => {
    // Le joueur du bas tient sa droite vers la droite de l’écran ; celui du haut, face à lui, l’inverse.
    expect(aimFromTilt(0, { x: 0.5, y: 0 })).toBeCloseTo(0.7);
    expect(aimFromTilt(1, { x: 0.5, y: 0 })).toBeCloseTo(-0.7);
    expect(aimFromTilt(2, { x: 0, y: 1 })).toBe(1);
    expect(aimFromTilt(3, { x: 0, y: 1 })).toBe(-1);
  });

  it('une inclinaison forte est bornée à la course de la raquette', () => {
    expect(aimFromTilt(0, { x: 1, y: 0 })).toBe(1);
    expect(aimFromTilt(0, { x: -1, y: 0 })).toBe(-1);
  });
});

describe('Tennis party : partie simulée', () => {
  it('quatre raquettes automatiques échangent la balle sans bloquer, et restent sous la vitesse maximale', () => {
    const rng = seeded(42);
    const active = [true, true, true, true];
    const r = createRally(active, rng);
    let hits = 0;
    let losses = 0;
    for (let i = 0; i < 60 * 60; i++) {
      for (const event of stepRally(r, 1 / 60)) {
        if (event.type === 'hit') hits += 1;
        else {
          losses += 1;
          r.ball = serve(active, rng);
        }
      }
      expect(r.ball.speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
    }
    expect(hits).toBeGreaterThan(20);
    expect(losses).toBeGreaterThanOrEqual(0);
  });
});
