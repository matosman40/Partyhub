import { INSET, type Side } from '../rules.js';

/**
 * Scène en perspective du terrain de tennis, sur le même modèle que la maquette approuvée.
 *
 * Le terrain reste un carré de 0 à 1 pour la physique (voir `rules.ts`). Dans la scène, il mesure `COURT` unités de
 * côté, posé au sol (y = 0) et centré sur l’origine : u (gauche, droite) devient x, v (bas, haut) devient z, et la
 * hauteur est y. Une caméra fixe, en perspective, regarde le terrain depuis le bas de l’écran. Elle recule ou
 * s’approche pour que le terrain et les personnages tiennent dans le cadre (voir `fitCamera`). Le décor, les
 * personnages, la balle et les raquettes sont tous projetés avec cette même caméra : ils restent à leur place les
 * uns par rapport aux autres, et un personnage du premier plan est plus grand qu’un personnage du fond.
 */

/** Côté du terrain, en unités de scène. */
export const COURT = 12.5;
/** Distance entre le centre du terrain et les tribunes, au fond et sur les côtés. */
export const STANDS_DIST = COURT / 2 + 3.2;
/** Tribunes : demi-longueur de part et d’autre du centre, et hauteur. */
export const STANDS_HALF = 20;
export const STANDS_H = 6.4;
/** Personnage : hauteur, et largeur du cadre (le personnage complet fait 260 × 340). */
export const FIG_H = 3.6;
export const FIG_W = (FIG_H * 260) / 340;
/** Balle : rayon, hauteur au contact (celle d’une raquette levée), et sommet de la cloche. */
export const BALL_R = 0.25;
export const BALL_HIT_H = 1;
export const BALL_PEAK_H = 2.5;
/** Filet : hauteur du voile, hauteur des poteaux, et position des poteaux (un peu au-delà du terrain). */
export const NET_H = 1;
export const POST_H = 1.15;
export const POST_X = COURT / 2 + 0.3;
/** Hauteur des murs des côtés sans joueur. */
export const WALL_H = 0.5;
/** Décalage des joueurs hors du terrain : sur l’axe du fond et du premier plan, puis sur les côtés. */
export const STAND_V = 0.085;
export const STAND_U = 0.03;

/** Angle vertical de la caméra. */
const FOV_Y = (40 * Math.PI) / 180;
/** Point visé par la caméra, et décalage de la caméra par rapport à lui au réglage de base (maquette). */
const AIM: Vec3 = { x: 0, y: 0.4, z: -0.6 };
const OFFSET: Vec3 = { x: 0, y: 8.6, z: 17 };
const UP: Vec3 = { x: 0, y: 1, z: 0 };
/** Marges du cadre : à gauche et à droite, en haut, en bas (fractions de la scène). */
const MARGIN_X = 0.06;
const MARGIN_TOP = 0.04;
const MARGIN_BOTTOM = 0.05;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Point projeté : sa place à l’écran, et la taille (en pixels) d’une unité de scène à cet endroit. */
export interface Placed extends Point {
  s: number;
}

export interface Camera {
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  /** Distance focale, en pixels. */
  focal: number;
  /** Centre de l’écran, en pixels. */
  cx: number;
  cy: number;
}

export interface Layout {
  /** Largeur et hauteur de la scène, en pixels. */
  W: number;
  H: number;
  /** Axe vertical de l’écran. */
  cx: number;
  cam: Camera;
  /** Pixels par unité de scène au centre du terrain : la taille de référence des personnages. */
  unit: number;
  /** Taille d’un personnage au centre (hauteur, largeur), longueur d’une raquette, et rayon de la balle. */
  figH: number;
  figW: number;
  racketH: number;
  ballR: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalize = (a: Vec3): Vec3 => {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
};

/** Caméra pour un recul `s` (1 = réglage de la maquette), sur un écran de W × H pixels. */
function cameraAt(s: number, W: number, H: number): Camera {
  const eye = { x: AIM.x + OFFSET.x * s, y: AIM.y + OFFSET.y * s, z: AIM.z + OFFSET.z * s };
  const forward = normalize(sub(AIM, eye));
  const right = normalize(cross(forward, UP));
  const up = cross(right, forward);
  return { eye, forward, right, up, focal: H / 2 / Math.tan(FOV_Y / 2), cx: W / 2, cy: H / 2 };
}

/** Projection d’un point de la scène avec la caméra donnée. */
export function place(cam: Camera, p: Vec3): Placed {
  const d = sub(p, cam.eye);
  const depth = Math.max(1e-3, dot(d, cam.forward));
  const s = cam.focal / depth;
  return { x: cam.cx + dot(d, cam.right) * s, y: cam.cy - dot(d, cam.up) * s, s };
}

/** Point de la scène pour une position du terrain (u, v de 0 à 1) et une hauteur en unités de scène. */
export function worldAt(u: number, v: number, height = 0): Vec3 {
  return { x: (u - 0.5) * COURT, y: height, z: (v - 0.5) * COURT };
}

/** Projection d’une position du terrain, avec sa taille à cet endroit. */
export function placeAt(g: Layout, u: number, v: number, height = 0): Placed {
  return place(g.cam, worldAt(u, v, height));
}

/** Projection d’une position du terrain (u, v) à une hauteur donnée, en pixels de l’écran. */
export function project(g: Layout, u: number, v: number, height = 0): Point {
  const p = placeAt(g, u, v, height);
  return { x: p.x, y: p.y };
}

/** Points qui doivent toujours rester dans le cadre : les quatre coins du terrain, les deux personnages, les poteaux. */
const REQUIRED: Vec3[] = (() => {
  const points: Vec3[] = [];
  for (const x of [-COURT / 2, COURT / 2]) {
    for (const z of [-COURT / 2, COURT / 2]) points.push({ x, y: 0, z });
  }
  for (const v of [1 + STAND_V, -STAND_V]) {
    const z = worldAt(0, v).z;
    for (const x of [-FIG_W / 2, FIG_W / 2]) points.push({ x, y: 0, z }, { x, y: FIG_H, z });
  }
  for (const x of [-POST_X, POST_X]) points.push({ x, y: POST_H, z: 0 });
  return points;
})();

/** Le cadre tient-il tous les points requis, dans ses marges ? */
function fits(cam: Camera, W: number, H: number): boolean {
  const left = W * MARGIN_X;
  const right = W - left;
  const top = H * MARGIN_TOP;
  const bottom = H * (1 - MARGIN_BOTTOM);
  return REQUIRED.every((p) => {
    const q = place(cam, p);
    return q.x >= left && q.x <= right && q.y >= top && q.y <= bottom;
  });
}

/**
 * Caméra du cadre : la plus proche qui laisse tenir tous les points requis, pour que le décor soit le plus grand
 * possible. En reculant, tout rétrécit autour du point visé : une recherche par dichotomie suffit.
 */
function fitCamera(W: number, H: number): Camera {
  let lo = 1;
  let hi = 8;
  if (fits(cameraAt(lo, W, H), W, H)) return cameraAt(lo, W, H);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fits(cameraAt(mid, W, H), W, H)) hi = mid;
    else lo = mid;
  }
  return cameraAt(hi, W, H);
}

let cached: Layout | null = null;

/**
 * Mise en page de la scène pour une largeur d’écran donnée. La boucle d’animation la demande à chaque image : le
 * résultat est gardé tant que la largeur ne change pas.
 */
export function layoutFor(W: number): Layout {
  if (cached?.W === W) return cached;
  const H = W * 0.86;
  const cam = fitCamera(W, H);
  const unit = place(cam, { x: 0, y: 0, z: 0 }).s;
  const figH = FIG_H * unit;
  cached = {
    W,
    H,
    cx: W / 2,
    cam,
    unit,
    figH,
    figW: figH * (260 / 340),
    racketH: figH * 0.55,
    ballR: BALL_R * unit,
  };
  return cached;
}

/**
 * Hauteur de la balle pendant son vol, en unités de scène. `progress` va de 0 (le coup) à 1 (la retombée) : la balle
 * part de la hauteur de la raquette, monte en cloche, et revient à cette hauteur.
 */
export function ballHeight(progress: number): number {
  const k = Math.max(0, Math.min(1, progress));
  return BALL_HIT_H + (BALL_PEAK_H - BALL_HIT_H) * 4 * k * (1 - k);
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
 * Main qui tient la raquette : un peu vers le centre du terrain, et à hauteur de l’épaule. `feet` est le pied du
 * personnage à l’écran, et `scale` sa taille relative à la référence (voir HostScreen). Une seule formule pour les
 * quatre côtés.
 */
export function handOf(g: Layout, feet: Point, scale: number): Point {
  const centre = project(g, 0.5, 0.5);
  const dx = g.cx - feet.x;
  const dy = centre.y - feet.y;
  const len = Math.hypot(dx, dy) || 1;
  const figH = g.figH * scale;
  return {
    x: feet.x + (dx / len) * figH * 0.22,
    y: feet.y - figH * 0.42 + (dy / len) * figH * 0.12,
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
