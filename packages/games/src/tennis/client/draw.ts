import { BALL_R, INSET, RACKET_HALF, SIDES, isHorizontal, type Side } from '../rules.js';
import { SIDE_COLORS } from './types.js';

/**
 * Dessin du terrain sur l’écran principal. Tout est exprimé en fractions du terrain (0 à 1) puis mis à l’échelle
 * de la taille du canevas : le même code sert à toutes les résolutions.
 */

export interface CourtFrame {
  /** Côtés défendus, position des raquettes, et intensité du flash après un coup réussi (0 à 1). */
  sides: { active: boolean; pos: number; flash: number }[];
  ball: { x: number; y: number; visible: boolean };
  /** Dernières positions de la balle, la plus ancienne en premier. */
  trail: { x: number; y: number }[];
}

export const EMPTY_FRAME: CourtFrame = {
  sides: SIDES.map(() => ({ active: false, pos: 0.5, flash: 0 })),
  ball: { x: 0.5, y: 0.5, visible: false },
  trail: [],
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Ligne de frappe d’un côté, en pixels, et l’intervalle qu’elle couvre. */
function racketLine(side: Side, pos: number, S: number): [number, number, number, number] {
  const a0 = (pos - RACKET_HALF) * S;
  const a1 = (pos + RACKET_HALF) * S;
  if (isHorizontal(side)) {
    const y = (side === 0 ? 1 - INSET : INSET) * S;
    return [a0, y, a1, y];
  }
  const x = (side === 2 ? INSET : 1 - INSET) * S;
  return [x, a0, x, a1];
}

function drawWall(ctx: CanvasRenderingContext2D, side: Side, S: number): void {
  const t = S * 0.028;
  ctx.fillStyle = 'rgba(8, 18, 40, 0.85)';
  if (side === 0) ctx.fillRect(0, S - t, S, t);
  else if (side === 1) ctx.fillRect(0, 0, S, t);
  else if (side === 2) ctx.fillRect(0, 0, t, S);
  else ctx.fillRect(S - t, 0, t, S);
}

export function drawCourt(ctx: CanvasRenderingContext2D, S: number, frame: CourtFrame): void {
  ctx.clearRect(0, 0, S, S);

  // Surface : deux teintes de bleu, en bandes, comme un court en dur.
  const grad = ctx.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#2f86e6');
  grad.addColorStop(1, '#1854aa');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, S, S, S * 0.03);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  for (let i = 0; i < 8; i += 2) ctx.fillRect(0, (i / 8) * S, S, S / 8);
  ctx.restore();

  // Lignes du court.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = Math.max(2, S * 0.005);
  const m = S * 0.012;
  roundRect(ctx, m, m, S - 2 * m, S - 2 * m, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(S * 0.2, S * 0.2, S * 0.6, S * 0.6);
  ctx.moveTo(S * 0.5, S * 0.2);
  ctx.lineTo(S * 0.5, S * 0.8);
  ctx.moveTo(S * 0.2, S * 0.5);
  ctx.lineTo(S * 0.8, S * 0.5);
  ctx.stroke();

  // Murs (côté libre ou éliminé) et raquettes (côté défendu).
  for (const side of SIDES) {
    const cell = frame.sides[side];
    if (!cell) continue;
    if (!cell.active) {
      drawWall(ctx, side, S);
      continue;
    }
    const [x0, y0, x1, y1] = racketLine(side, cell.pos, S);
    const color = SIDE_COLORS[side];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = S * 0.024;
    ctx.shadowColor = color;
    ctx.shadowBlur = S * 0.05 * cell.flash;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  // Traînée puis balle.
  if (frame.ball.visible) {
    const n = frame.trail.length;
    frame.trail.forEach((p, i) => {
      ctx.globalAlpha = ((i + 1) / (n + 1)) * 0.35;
      ctx.fillStyle = '#e6ff3b';
      ctx.beginPath();
      ctx.arc(p.x * S, p.y * S, Math.max(2, BALL_R * S * 0.9), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    const r = Math.max(6, BALL_R * S * 1.4);
    const bx = frame.ball.x * S;
    const by = frame.ball.y * S;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(bx + r * 0.25, by + r * 0.4, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e6ff3b';
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.beginPath();
    ctx.arc(bx - r * 0.35, by, r * 0.8, -1.1, 1.1);
    ctx.stroke();
  }
}
