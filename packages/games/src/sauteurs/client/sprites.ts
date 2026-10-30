import {
  PIXEL_TRANSPARENT,
  drawPose,
  drawWalk,
  mirrorBitmap,
  type CharacterSpec,
  type PixelBitmap,
  type PixelPose,
} from '@partyhub/shared';
import type { Anim } from '../engine.js';

/**
 * Sprites des coureurs. Les figures du rendeur pixel font 32 × 32 (environ 26 pixels de haut) ; une tuile du jeu
 * en fait 16 et un coureur 0,9 tuile. On réduit donc chaque sprite de moitié (un bloc de 2 × 2 pixels devient un
 * pixel) pour que le coureur ait la taille de sa boîte de collision, avec des pixels de la même taille que ceux
 * des tuiles.
 */

/** Ce qu'on dessine pour un coureur à un instant donné. */
export type SpriteChoice = { kind: 'walk'; frame: 0 | 1 | 2 | 3 } | { kind: 'pose'; pose: PixelPose };

/** Tuiles parcourues par image de marche : un cycle de 4 images dure 1,9 tuile. */
const FRAME_STRIDE = 2.1;

/**
 * Image du coureur selon son animation : marche de profil en courant, pose « joie » en l'air, « défaite » à terre,
 * « victoire » à l'arrivée, pieds joints à l'arrêt.
 */
export function chooseSprite(anim: Anim, x: number): SpriteChoice {
  switch (anim) {
    case 'run': {
      const frame = (Math.floor(Math.abs(x) * FRAME_STRIDE) % 4) as 0 | 1 | 2 | 3;
      return { kind: 'walk', frame };
    }
    case 'jump':
    case 'fall':
      return { kind: 'pose', pose: 'joie' };
    case 'hurt':
      return { kind: 'pose', pose: 'defaite' };
    case 'win':
      return { kind: 'pose', pose: 'victoire' };
    default:
      return { kind: 'walk', frame: 0 };
  }
}

/** Réduit un bitmap de moitié : un pixel est opaque s'il y a au moins deux pixels opaques dans son bloc de 2 × 2. */
export function halveBitmap(b: PixelBitmap): PixelBitmap {
  const w = Math.ceil(b.width / 2);
  const h = Math.ceil(b.height / 2);
  const pixels = new Uint8Array(w * h).fill(PIXEL_TRANSPARENT);
  const votes = new Uint8Array(256);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      votes.fill(0);
      let opaque = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = x * 2 + dx;
          const sy = y * 2 + dy;
          if (sx >= b.width || sy >= b.height) continue;
          const c = b.pixels[sy * b.width + sx]!;
          if (c === PIXEL_TRANSPARENT) continue;
          votes[c]!++;
          opaque++;
        }
      }
      if (opaque < 2) continue;
      // Le contour (indice 0) l'emporte à égalité : la silhouette garde son trait.
      let best = 0;
      let bestVotes = -1;
      for (let c = 0; c < 255; c++) {
        if (votes[c]! > bestVotes) {
          best = c;
          bestVotes = votes[c]!;
        }
      }
      pixels[y * w + x] = best;
    }
  }
  return { width: w, height: h, pixels };
}

/** Rangée du bas du dessin (la plante des pieds) : -1 si le bitmap est vide. */
export function footRow(b: PixelBitmap): number {
  for (let y = b.height - 1; y >= 0; y--) {
    for (let x = 0; x < b.width; x++) if (b.pixels[y * b.width + x] !== PIXEL_TRANSPARENT) return y;
  }
  return -1;
}

export interface SpriteArt {
  bitmap: PixelBitmap;
  /** Rangée des pieds dans le bitmap. */
  foot: number;
}

/** Sprite réduit d'un coureur, tourné vers la gauche ou la droite. */
export function makeSprite(spec: CharacterSpec, choice: SpriteChoice, facingLeft: boolean): SpriteArt {
  const full = choice.kind === 'walk' ? drawWalk(spec, 'side', choice.frame) : drawPose(spec, choice.pose);
  const half = halveBitmap(full);
  const bitmap = facingLeft && choice.kind === 'walk' ? mirrorBitmap(half) : half;
  return { bitmap, foot: footRow(bitmap) };
}

/** Clé de cache d'un sprite : le personnage, l'image demandée et le sens. */
export function spriteKey(specKey: string, choice: SpriteChoice, facingLeft: boolean): string {
  const what = choice.kind === 'walk' ? `w${choice.frame}` : `p${choice.pose}`;
  return `${specKey}|${what}|${facingLeft && choice.kind === 'walk' ? 'L' : 'R'}`;
}

/**
 * Cache de sprites : chaque image n'est dessinée qu'une fois. La fabrique est fournie par l'appelant (un canvas
 * dans le navigateur, un simple objet dans les tests). Le nombre d'entrées est borné : au-delà, la plus ancienne part.
 */
export class SpriteCache<T> {
  private readonly map = new Map<string, T>();
  hits = 0;
  misses = 0;
  constructor(private readonly limit = 600) {}
  get(key: string, make: () => T): T {
    const found = this.map.get(key);
    if (found !== undefined) {
      this.hits++;
      return found;
    }
    this.misses++;
    const made = make();
    this.map.set(key, made);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    return made;
  }
  get size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}
