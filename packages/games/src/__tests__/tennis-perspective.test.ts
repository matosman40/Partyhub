import { describe, expect, it } from 'vitest';
import {
  BALL_HIT_H,
  BALL_PEAK_H,
  STAND_V,
  ballHeight,
  layoutFor,
  placeAt,
  project,
  standAt,
} from '../tennis/client/geometry.js';

/** Largeurs d’écran testées : du téléphone posé sur une table jusqu’à la télé. */
const WIDTHS = [320, 480, 760, 1100];

const inside = (p: { x: number; y: number }, W: number, H: number) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;

describe('perspective du terrain de tennis', () => {
  it.each(WIDTHS)('le terrain et les deux joueurs tiennent dans le cadre (largeur %i)', (W) => {
    const g = layoutFor(W);
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      expect(inside(project(g, u, v), g.W, g.H)).toBe(true);
    }
    // Joueurs du bas et du haut : pied et tête doivent être à l’écran.
    for (const side of [0, 1] as const) {
      const stand = standAt(side, 0.5);
      expect(inside(project(g, stand.u, stand.v), g.W, g.H)).toBe(true);
      expect(inside(project(g, stand.u, stand.v, 3.6), g.W, g.H)).toBe(true);
    }
  });

  it.each(WIDTHS)('le terrain occupe une grande part de la largeur (largeur %i)', (W) => {
    const g = layoutFor(W);
    const left = project(g, 0, 1).x;
    const right = project(g, 1, 1).x;
    expect(right - left).toBeGreaterThan(W * 0.6);
  });

  it('le joueur du premier plan est plus grand et plus bas que celui du fond', () => {
    const g = layoutFor(480);
    const near = placeAt(g, 0.5, 1 + STAND_V);
    const far = placeAt(g, 0.5, -STAND_V);
    expect(near.s).toBeGreaterThan(far.s);
    expect(near.y).toBeGreaterThan(far.y);
  });

  it('la taille de référence est celle des personnages au centre du terrain', () => {
    const g = layoutFor(480);
    const centre = placeAt(g, 0.5, 0.5);
    expect(centre.s).toBeCloseTo(g.unit, 6);
    expect(g.figH).toBeGreaterThan(g.W * 0.12);
    expect(g.figH).toBeLessThan(g.W * 0.35);
    expect(g.figW).toBeCloseTo((g.figH * 260) / 340, 6);
  });

  it('le terrain est symétrique par rapport à l’axe de l’écran', () => {
    const g = layoutFor(480);
    const left = project(g, 0, 0.5);
    const right = project(g, 1, 0.5);
    expect(left.x + right.x).toBeCloseTo(2 * g.cx, 6);
    expect(left.y).toBeCloseTo(right.y, 6);
  });

  it('une hauteur remonte le point à l’écran', () => {
    const g = layoutFor(480);
    const ground = project(g, 0.5, 0.5, 0);
    const air = project(g, 0.5, 0.5, 1);
    expect(air.y).toBeLessThan(ground.y);
    expect(air.x).toBeCloseTo(ground.x, 6);
  });

  it('la mise en page est gardée tant que la largeur ne change pas', () => {
    expect(layoutFor(500)).toBe(layoutFor(500));
    expect(layoutFor(500)).not.toBe(layoutFor(501));
  });
});

describe('hauteur de la balle', () => {
  it('part de la hauteur de la raquette, monte en cloche et revient à la même hauteur', () => {
    expect(ballHeight(0)).toBeCloseTo(BALL_HIT_H, 9);
    expect(ballHeight(0.5)).toBeCloseTo(BALL_PEAK_H, 9);
    expect(ballHeight(1)).toBeCloseTo(BALL_HIT_H, 9);
    expect(ballHeight(0.25)).toBeGreaterThan(BALL_HIT_H);
    expect(ballHeight(0.25)).toBeLessThan(BALL_PEAK_H);
  });

  it('ne sort jamais de la cloche, même hors de son intervalle', () => {
    expect(ballHeight(-1)).toBeCloseTo(BALL_HIT_H, 9);
    expect(ballHeight(3)).toBeCloseTo(BALL_HIT_H, 9);
  });
});
