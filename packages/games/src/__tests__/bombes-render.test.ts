import { describe, expect, it } from 'vitest';
import {
  burstParticles,
  drawParticles,
  updateParticles,
  type Particle,
  type ParticleKind,
} from '../bombes-party/client/render.js';

/**
 * Contexte de dessin factice : comme le canvas du navigateur, il lève une erreur sur un rayon négatif.
 * Une telle erreur arrêtait la boucle d'affichage et figeait le plateau quand un personnage tombait.
 */
function fakeCanvas() {
  const radii: number[] = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    stroke() {},
    fillRect() {},
    translate() {},
    rotate() {},
    arc(_x: number, _y: number, r: number) {
      if (r < 0) throw new RangeError(`The radius provided (${r}) is negative.`);
      radii.push(r);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, radii };
}

const KINDS: ParticleKind[] = ['spark', 'dust', 'smoke', 'ring', 'confetti'];

describe('particules du plateau', () => {
  it('un anneau de mort dont la vie dépasse la durée prévue ne fait jamais planter le dessin', () => {
    // Le hasard peut donner une vie supérieure à la durée : la fraction de vie dépasse alors 1.
    const list: Particle[] = [];
    for (let i = 0; i < 200; i++) burstParticles(list, 100, 100, 'ring', 1, '#ff3d8b', 0, 26, 0.5);
    const fake = fakeCanvas();
    expect(() => drawParticles(fake.ctx, list)).not.toThrow();
    expect(fake.radii.every((r) => r >= 0)).toBe(true);
  });

  it('aucun type de particule ne produit un rayon négatif, même après plusieurs images', () => {
    const list: Particle[] = [];
    for (const kind of KINDS) burstParticles(list, 50, 50, kind, 40, '#ffe066', 260, 30, 0.9);
    const fake = fakeCanvas();
    for (let frame = 0; frame < 60; frame++) {
      updateParticles(list, 1 / 60);
      expect(() => drawParticles(fake.ctx, list)).not.toThrow();
    }
    expect(fake.radii.every((r) => r >= 0)).toBe(true);
  });
});
