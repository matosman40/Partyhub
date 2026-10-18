import { INSET, type Side } from '../rules.js';

/**
 * Projection du terrain en vue isométrique (environ 30°, façon jeux SNES à vue de dessus en biais).
 *
 * Le terrain reste un carré de 0 à 1 pour la physique (voir `rules.ts`). Ici on ne fait que le dessiner :
 * chaque point (u, v) du sol devient un point de l’écran, et les personnages se tiennent au bord de leur côté.
 */

/** Rapport de hauteur du losange : 0,58 équivaut à une pente d’environ 30°. */
export const TILT = 0.58;
/** Distance entre la ligne du terrain et les pieds du joueur, en fraction du terrain. */
export const STAND = 0.085;

export interface Layout {
  /** Largeur et hauteur de la scène, en pixels. */
  W: number;
  H: number;
  /** Demi-largeur et demi-hauteur du losange du terrain. */
  A: number;
  B: number;
  /** Centre du losange. */
  cx: number;
  cy: number;
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
  const A = W * 0.36;
  const B = A * TILT;
  const figH = W * 0.2;
  return {
    W,
    H,
    A,
    B,
    cx: W / 2,
    // Le contenu (joueurs du fond compris) se répartit entre la tribune du haut et le bord du bas.
    cy: W * 0.5,
    figH,
    // Le ratio du personnage complet (260 × 340) fixe la largeur.
    figW: figH / (340 / 260),
    racketH: figH * 0.55,
    ballR: Math.max(5, W * 0.016),
  };
}

/** Projection d’un point du sol (u, v), décalé de `lift` (fraction de la largeur) vers le haut. */
export function project(g: Layout, u: number, v: number, lift = 0): Point {
  return {
    x: g.cx + (u - v) * g.A,
    y: g.cy + (u + v - 1) * g.B - lift * g.W,
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
      return { u: pos, v: 1 + STAND };
    case 1:
      return { u: pos, v: -STAND };
    case 2:
      return { u: -STAND, v: pos };
    default:
      return { u: 1 + STAND, v: pos };
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
 * Main qui tient la raquette : un peu vers le terrain, et à hauteur de l’épaule (pieds - 0,42 × hauteur du
 * personnage). Une seule formule pour les quatre côtés.
 */
export function handOf(g: Layout, feet: Point): Point {
  const dx = g.cx - feet.x;
  const dy = g.cy - feet.y;
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
