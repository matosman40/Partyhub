import { SIDES, type Side } from '../rules.js';
import { edgeOf, project, type Layout, type Point } from './geometry.js';

/**
 * Décor du terrain, dessiné une fois par taille d’écran : mur de la tribune au fond, herbe autour, terrain en
 * perspective avec ses lignes, et murs des côtés sans joueur. Les personnages, les raquettes et la balle sont des
 * éléments HTML au-dessus, déplacés à chaque image (voir HostScreen).
 */

const GROUND_TOP = '#2a7062';
const GROUND_BOTTOM = '#174a41';
const SURFACE = '#2f8d72';
const STRIPE = 'rgba(0, 40, 20, 0.08)';
const LINE = 'rgba(255, 255, 255, 0.92)';
const WALL = '#0c2e28';

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

export function drawBackdrop(ctx: CanvasRenderingContext2D, g: Layout): void {
  const { W, H } = g;

  // Autour du terrain : herbe sombre, plus foncée vers le bas de l’image.
  const ground = ctx.createLinearGradient(0, g.yFar, 0, H);
  ground.addColorStop(0, GROUND_TOP);
  ground.addColorStop(1, GROUND_BOTTOM);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, W, H);

  // Mur de fond : bois sombre, à lames horizontales, jusqu’au bord lointain du terrain.
  const wall = ctx.createLinearGradient(0, 0, 0, g.yFar);
  wall.addColorStop(0, '#6b4129');
  wall.addColorStop(1, '#9a6640');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, g.yFar);
  const board = Math.max(3, g.yFar / 7);
  ctx.fillStyle = 'rgba(40, 20, 10, 0.35)';
  for (let y = board; y < g.yFar; y += board) {
    ctx.fillRect(0, y, W, Math.max(1, W * 0.004));
  }
  // Rebord clair, juste au-dessus du terrain.
  ctx.fillStyle = 'rgba(255, 240, 210, 0.45)';
  ctx.fillRect(0, g.yFar - Math.max(2, W * 0.006), W, Math.max(2, W * 0.006));
}

export function drawCourt(ctx: CanvasRenderingContext2D, g: Layout, active: boolean[]): void {
  const { W } = g;
  const at = (u: number, v: number) => project(g, u, v);
  const T = at(0, 0);
  const R = at(1, 0);
  const Bm = at(1, 1);
  const L = at(0, 1);

  // Surface, avec des bandes régulières d’une profondeur à l’autre.
  ctx.save();
  polygon(ctx, [T, R, Bm, L]);
  ctx.fillStyle = SURFACE;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = STRIPE;
  for (let k = 1; k < 10; k += 2) {
    polygon(ctx, [at(0, k / 10), at(1, k / 10), at(1, (k + 1) / 10), at(0, (k + 1) / 10)]);
    ctx.fill();
  }
  // Reflet doux au centre du court, comme une lumière de stade tombant sur la surface.
  const cy = (g.yFar + g.yNear) / 2;
  const glow = ctx.createRadialGradient(g.cx, cy, 0, g.cx, cy, g.wNear * 0.75);
  glow.addColorStop(0, 'rgba(255, 255, 220, 0.14)');
  glow.addColorStop(1, 'rgba(255, 255, 220, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, g.H);
  ctx.restore();

  // Lignes blanches : contour, lignes de couloir, lignes de service et ligne centrale, avec une ombre légère.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.2, W * 0.0036);
  ctx.shadowColor = 'rgba(0, 20, 10, 0.35)';
  ctx.shadowBlur = Math.max(1, W * 0.004);
  ctx.shadowOffsetY = Math.max(0.5, W * 0.002);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  polygon(ctx, [T, R, Bm, L]);
  ctx.stroke();
  segment(ctx, at(0.12, 0), at(0.12, 1));
  segment(ctx, at(0.88, 0), at(0.88, 1));
  segment(ctx, at(0.12, 0.2), at(0.88, 0.2));
  segment(ctx, at(0.12, 0.8), at(0.88, 0.8));
  segment(ctx, at(0.5, 0.2), at(0.5, 0.8));
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Murs : un côté sans joueur (libre ou éliminé) est une bordure sombre, qui renvoie la balle.
  for (const side of SIDES) {
    if (active[side]) continue;
    drawWall(ctx, g, side);
  }
}

function drawWall(ctx: CanvasRenderingContext2D, g: Layout, side: Side): void {
  const [a, b] = edgeOf(side);
  ctx.strokeStyle = WALL;
  ctx.lineWidth = g.W * 0.009;
  ctx.lineCap = 'butt';
  segment(ctx, project(g, a.u, a.v), project(g, b.u, b.v));
}
