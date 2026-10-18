import { SIDES, type Side } from '../rules.js';
import { edgeOf, project, type Layout, type Point } from './geometry.js';

/**
 * Décor du terrain, dessiné une fois par taille d’écran : fond de salle, public, surface en losange avec ses
 * bordures, et murs des côtés sans joueur. Les personnages, la raquette et la balle sont des éléments HTML
 * au-dessus, déplacés à chaque image (voir HostScreen).
 */

const CROWD = ['#ff4f8b', '#5eead4', '#ffd23f', '#b59cff', '#ff7a3d', '#ecebe3'];

/** Générateur déterministe : le public garde la même disposition d’une image à l’autre. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function polygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, g: Layout): void {
  const { W, H } = g;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#22185a');
  sky.addColorStop(1, '#0a0820');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Éclairage de la salle, au-dessus du court.
  const light = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.62);
  light.addColorStop(0, 'rgba(255, 236, 170, 0.22)');
  light.addColorStop(1, 'rgba(255, 236, 170, 0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);

  // Tribune du fond : bande sombre, puis quatre rangs de public.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(0, 0, W, H * 0.2);
  const rnd = seeded(7);
  const r = Math.max(3, W * 0.009);
  for (let row = 0; row < 4; row++) {
    const y = H * 0.035 + row * H * 0.038;
    for (let x = r; x < W + r; x += r * 2.4) {
      ctx.globalAlpha = 0.5 + rnd() * 0.35;
      ctx.fillStyle = CROWD[Math.floor(rnd() * CROWD.length)] ?? '#ffffff';
      ctx.beginPath();
      ctx.arc(x + rnd() * r * 0.6, y + rnd() * r * 0.4, r * (0.8 + rnd() * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function drawCourt(ctx: CanvasRenderingContext2D, g: Layout, active: boolean[]): void {
  const { W } = g;
  const T = project(g, 0, 0);
  const R = project(g, 1, 0);
  const Bm = project(g, 1, 1);
  const L = project(g, 0, 1);
  const thick = W * 0.028;

  // Bordure en relief : les deux côtés avant du losange ont une épaisseur, comme une dalle vue de biais.
  ctx.fillStyle = '#1b5a2c';
  polygon(ctx, [L, Bm, { x: Bm.x, y: Bm.y + thick }, { x: L.x, y: L.y + thick }]);
  ctx.fill();
  polygon(ctx, [Bm, R, { x: R.x, y: R.y + thick }, { x: Bm.x, y: Bm.y + thick }]);
  ctx.fill();

  // Surface : herbe, avec des rayures parallèles au côté bas.
  const grass = ctx.createLinearGradient(0, T.y, 0, Bm.y);
  grass.addColorStop(0, '#46b35c');
  grass.addColorStop(1, '#2c8c43');
  ctx.fillStyle = grass;
  polygon(ctx, [T, R, Bm, L]);
  ctx.fill();
  ctx.save();
  polygon(ctx, [T, R, Bm, L]);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  for (let k = 0; k < 8; k += 2) {
    polygon(ctx, [project(g, 0, k / 8), project(g, 1, k / 8), project(g, 1, (k + 1) / 8), project(g, 0, (k + 1) / 8)]);
    ctx.fill();
  }
  ctx.restore();

  // Lignes blanches : contour, zone de service et deux axes.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = Math.max(1.5, W * 0.0035);
  ctx.lineJoin = 'round';
  polygon(ctx, [T, R, Bm, L]);
  ctx.stroke();
  polygon(ctx, [project(g, 0.2, 0.2), project(g, 0.8, 0.2), project(g, 0.8, 0.8), project(g, 0.2, 0.8)]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(project(g, 0.5, 0).x, project(g, 0.5, 0).y);
  ctx.lineTo(project(g, 0.5, 1).x, project(g, 0.5, 1).y);
  ctx.moveTo(project(g, 0, 0.5).x, project(g, 0, 0.5).y);
  ctx.lineTo(project(g, 1, 0.5).x, project(g, 1, 0.5).y);
  ctx.stroke();

  // Murs : un côté sans joueur (libre ou éliminé) est une bande sombre le long de sa ligne.
  for (const side of SIDES) {
    if (active[side]) continue;
    drawWall(ctx, g, side);
  }
}

function drawWall(ctx: CanvasRenderingContext2D, g: Layout, side: Side): void {
  const [a, b] = edgeOf(side);
  const p1 = project(g, a.u, a.v);
  const p2 = project(g, b.u, b.v);
  const front = side === 0 || side === 3;
  ctx.strokeStyle = front ? '#2a1f4a' : 'rgba(42, 31, 74, 0.85)';
  ctx.lineWidth = g.W * (front ? 0.03 : 0.018);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}
