import { SIDES, type Side } from '../rules.js';
import {
  COURT,
  NET_H,
  POST_H,
  POST_X,
  STANDS_DIST,
  STANDS_H,
  STANDS_HALF,
  WALL_H,
  edgeOf,
  place,
  worldAt,
  type Layout,
  type Point,
  type Vec3,
} from './geometry.js';

/**
 * Décor du terrain en perspective, dessiné une fois par taille d’écran : herbe, tribunes au fond et sur les côtés,
 * terrain avec ses lignes, murs des côtés sans joueur, et filet. Les personnages, les raquettes et la balle sont des
 * éléments HTML au-dessus, placés à chaque image avec la même caméra (voir HostScreen).
 */

const GRASS = '#2f8a5f';
const STAND_BG = '#1b2a4a';
const STAND_TOP = '#0c1a33';
const BANDS = ['#E4572E', '#F2C14E', '#2EC4B6', '#5B5BD6', '#E4572E', '#F2C14E'];
const HEADS = ['#8a5a3c', '#c58a5b', '#f1c27d', '#5a3825', '#ffdbac'];
const INK = '#1a1030';
const COURT_BLUE = '#2563A8';
const LINE = 'rgba(255, 255, 255, 0.95)';
const WALL = '#0c2e28';
const WALL_TOP = 'rgba(255, 240, 210, 0.7)';
const NET_VEIL = 'rgba(245, 250, 245, 0.18)';
const NET_MESH = 'rgba(255, 255, 255, 0.85)';
const NET_LIGHT = '#f4f1ea';
/** Le filet : mailles comme sur la maquette (16 colonnes, 4 rangées). */
const NET_COLS = 16;
const NET_ROWS = 4;
/** Spectateurs par rangée et par tribune, et rayon de leur tête en unités de scène. */
const SPECTATORS = 150;
const HEAD_R = 0.18;

type Plane = (s: number, h: number) => Vec3;

function polygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function segment(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Point de la scène pour une position du terrain (u, v) à une hauteur donnée. */
function pt(g: Layout, u: number, v: number, height = 0): Point {
  return place(g.cam, worldAt(u, v, height));
}

/** Générateur pseudo-aléatoire fixe : le public est le même à chaque affichage. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, g: Layout): void {
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, 0, g.W, g.H);

  const random = seeded(7);
  // Le fond d’abord, puis les côtés : ceux-ci commencent au fond, pour ne pas se couper avec lui.
  drawStands(ctx, g, (s, h) => ({ x: s, y: h, z: -STANDS_DIST }), -STANDS_HALF, STANDS_HALF, random);
  for (const sx of [-1, 1]) {
    drawStands(ctx, g, (s, h) => ({ x: sx * STANDS_DIST, y: h, z: s }), -STANDS_DIST, STANDS_HALF, random);
  }
}

/**
 * Une tribune : fond sombre, rangées de couleur, spectateurs posés sur le haut de chaque rangée, et bande sombre en
 * haut. `plane` donne le point de la tribune pour une position le long d’elle (`s`) et une hauteur (`h`).
 */
function drawStands(
  ctx: CanvasRenderingContext2D,
  g: Layout,
  plane: Plane,
  from: number,
  to: number,
  random: () => number,
): void {
  const quad = (h0: number, h1: number): Point[] =>
    [plane(from, h0), plane(to, h0), plane(to, h1), plane(from, h1)].map((p) => place(g.cam, p));
  // Les rangées ont la place de la maquette : la première commence aux deux cinquièmes du haut de la tribune.
  const rowTop = (r: number) => STANDS_H * (1 - (0.42 + r * 0.09));
  const rowBottom = (r: number) => STANDS_H * (1 - (0.42 + (r + 1) * 0.09));

  polygon(ctx, quad(0, STANDS_H));
  ctx.fillStyle = STAND_BG;
  ctx.fill();
  BANDS.forEach((color, r) => {
    polygon(ctx, quad(rowBottom(r), rowTop(r)));
    ctx.fillStyle = color;
    ctx.fill();
  });

  // Spectateurs : leur tête dépasse un peu du haut de la rangée, comme sur la maquette.
  ctx.strokeStyle = INK;
  BANDS.forEach((_, r) => {
    for (let i = 0; i < SPECTATORS; i++) {
      const s = from + random() * (to - from);
      const color = HEADS[Math.floor(random() * HEADS.length)] ?? HEADS[0] ?? INK;
      const p = place(g.cam, plane(s, rowTop(r) + 0.08));
      const radius = HEAD_R * p.s;
      if (radius < 0.8) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, radius * 0.25);
      ctx.stroke();
    }
  });

  polygon(ctx, quad(STANDS_H * 0.88, STANDS_H));
  ctx.fillStyle = STAND_TOP;
  ctx.fill();
}

export function drawCourt(ctx: CanvasRenderingContext2D, g: Layout, active: boolean[]): void {
  const at = (u: number, v: number) => pt(g, u, v);
  const corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];

  // Surface, à plat sur le sol.
  polygon(ctx, corners);
  ctx.fillStyle = COURT_BLUE;
  ctx.fill();

  // Lignes blanches : contour, lignes de couloir, lignes de service et ligne centrale.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1, 0.12 * g.unit);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  polygon(ctx, corners);
  ctx.stroke();
  segment(ctx, at(0.12, 0), at(0.12, 1));
  segment(ctx, at(0.88, 0), at(0.88, 1));
  segment(ctx, at(0.12, 0.2), at(0.88, 0.2));
  segment(ctx, at(0.12, 0.8), at(0.88, 0.8));
  segment(ctx, at(0.5, 0.2), at(0.5, 0.8));

  // Murs : un côté sans joueur (libre ou éliminé) est une bordure basse et sombre, qui renvoie la balle.
  for (const side of SIDES) {
    if (active[side]) continue;
    drawWall(ctx, g, side);
  }
}

function drawWall(ctx: CanvasRenderingContext2D, g: Layout, side: Side): void {
  const [a, b] = edgeOf(side);
  const bottomA = pt(g, a.u, a.v);
  const bottomB = pt(g, b.u, b.v);
  const topA = pt(g, a.u, a.v, WALL_H);
  const topB = pt(g, b.u, b.v, WALL_H);
  polygon(ctx, [bottomA, bottomB, topB, topA]);
  ctx.fillStyle = WALL;
  ctx.fill();
  ctx.strokeStyle = WALL_TOP;
  ctx.lineWidth = Math.max(1, 0.06 * g.unit);
  segment(ctx, topA, topB);
}

/**
 * Filet, au milieu du court (v = 0,5) : un voile tendu entre deux poteaux, avec ses mailles, son ruban du haut et son
 * ombre au sol. Il est dessiné sur sa propre couche, placée selon sa profondeur entre les joueurs du fond et ceux du
 * premier plan (voir HostScreen).
 */
export function drawNet(ctx: CanvasRenderingContext2D, g: Layout): void {
  // Le voile dépasse un peu du terrain, de la même façon que sur la maquette.
  const half = (COURT + 0.5) / 2;
  const at = (x: number, y: number, z = 0): Point => place(g.cam, { x, y, z });

  // Ombre du filet sur la surface.
  polygon(ctx, [at(-half, 0, 0), at(half, 0, 0), at(half, 0, 0.25), at(-half, 0, 0.25)]);
  ctx.fillStyle = 'rgba(0, 20, 10, 0.28)';
  ctx.fill();

  // Voile, puis mailles verticales et horizontales.
  polygon(ctx, [at(-half, 0), at(half, 0), at(half, NET_H), at(-half, NET_H)]);
  ctx.fillStyle = NET_VEIL;
  ctx.fill();
  ctx.strokeStyle = NET_MESH;
  ctx.lineWidth = Math.max(0.8, 0.03 * g.unit);
  for (let i = 0; i <= NET_COLS; i++) {
    const x = -half + (2 * half * i) / NET_COLS;
    segment(ctx, at(x, 0), at(x, NET_H));
  }
  for (let k = 1; k < NET_ROWS; k++) {
    const y = (NET_H * k) / NET_ROWS;
    segment(ctx, at(-half, y), at(half, y));
  }

  // Ruban du haut, puis poteaux qui dépassent du voile.
  ctx.strokeStyle = NET_LIGHT;
  ctx.lineWidth = Math.max(1.5, 0.1 * g.unit);
  segment(ctx, at(-half, NET_H + 0.04), at(half, NET_H + 0.04));
  ctx.lineWidth = Math.max(2, 0.16 * g.unit);
  for (const sx of [-1, 1]) {
    segment(ctx, at(sx * POST_X, 0), at(sx * POST_X, POST_H));
  }
}
