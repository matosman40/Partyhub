import { INSET, type Side } from '../rules.js';

/**
 * Projection du terrain en perspective, vu de haut et en biais, comme les jeux de tennis sur console 16 bits.
 *
 * Le terrain reste un carré de 0 à 1 pour la physique (voir `rules.ts`). Ici on ne fait que le dessiner : le bord
 * lointain (v = 0) est plus étroit que le bord proche (v = 1), et chaque ligne horizontale garde sa largeur. Les
 * personnages se tiennent au bord de leur côté, et sont plus petits au fond.
 */

/** Décalage des joueurs hors du terrain : sur l’axe du fond et du premier plan, puis sur les côtés. */
export const STAND_V = 0.085;
export const STAND_U = 0.03;

export interface Layout {
  /** Largeur et hauteur de la scène, en pixels. */
  W: number;
  H: number;
  /** Axe vertical du terrain. */
  cx: number;
  /** Ordonnée du bord lointain et du bord proche du terrain. */
  yFar: number;
  yNear: number;
  /** Largeur du terrain au bord lointain et au bord proche. */
  wFar: number;
  wNear: number;
  /** Taille d’un personnage (hauteur, largeur) et longueur d’une raquette. */
  figH: number;
  figW: number;
  racketH: number;
  /** Rayon de la balle. */
  ballR: number;
}

export interface Point {
  x: number;
  y: number;
}

export function layoutFor(W: number): Layout {
  const H = W * 0.86;
  const figH = W * 0.17;
  return {
    W,
    H,
    cx: W / 2,
    yFar: H * 0.22,
    yNear: H * 0.9,
    wFar: W * 0.72,
    wNear: W * 0.88,
    figH,
    // Le ratio du personnage complet (260 × 340) fixe la largeur.
    figW: figH / (340 / 260),
    racketH: figH * 0.55,
    ballR: Math.max(4, W * 0.014),
  };
}

/** Projection d’un point du sol (u, v), décalé de `lift` (fraction de la largeur) vers le haut. */
export function project(g: Layout, u: number, v: number, lift = 0): Point {
  const width = g.wFar + (g.wNear - g.wFar) * v;
  return {
    x: g.cx + (u - 0.5) * width,
    y: g.yFar + (g.yNear - g.yFar) * v - lift * g.W,
  };
}

/**
 * Point au sol où se tient le joueur d’un côté : au bord, décalé vers l’extérieur, et à la position de sa raquette
 * le long de ce côté (`pos`, de 0 à 1). Bas : v = 1 + décalage ; haut : v = -décalage ; gauche : u = -décalage ;
 * droite : u = 1 + décalage.
 */
export function standAt(side: Side, pos: number): { u: number; v: number } {
  switch (side) {
    case 0:
      return { u: pos, v: 1 + STAND_V };
    case 1:
      return { u: pos, v: -STAND_V };
    case 2:
      return { u: -STAND_U, v: pos };
    default:
      return { u: 1 + STAND_U, v: pos };
  }
}

/** Point de la ligne de frappe du côté, là où la raquette touche la balle. */
export function strikeAt(side: Side, pos: number): { u: number; v: number } {
  switch (side) {
    case 0:
      return { u: pos, v: 1 - INSET };
    case 1:
      return { u: pos, v: INSET };
    case 2:
      return { u: INSET, v: pos };
    default:
      return { u: 1 - INSET, v: pos };
  }
}

/**
 * Main qui tient la raquette : un peu vers le centre du terrain, et à hauteur de l’épaule (pieds - 0,42 × hauteur du
 * personnage). Une seule formule pour les quatre côtés.
 */
export function handOf(g: Layout, feet: Point): Point {
  const centerY = (g.yFar + g.yNear) / 2;
  const dx = g.cx - feet.x;
  const dy = centerY - feet.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: feet.x + (dx / len) * g.figH * 0.22,
    y: feet.y - g.figH * 0.42 + (dy / len) * g.figH * 0.12,
  };
}

/** Extrémités d’un côté du terrain, pour dessiner un mur. */
export function edgeOf(side: Side): [{ u: number; v: number }, { u: number; v: number }] {
  switch (side) {
    case 0:
      return [
        { u: 0, v: 1 },
        { u: 1, v: 1 },
      ];
    case 1:
      return [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
      ];
    case 2:
      return [
        { u: 0, v: 0 },
        { u: 0, v: 1 },
      ];
    default:
      return [
        { u: 1, v: 0 },
        { u: 1, v: 1 },
      ];
  }
}
