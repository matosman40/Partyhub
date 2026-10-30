/**
 * Caméra de l'écran principal : pure, sans DOM. Elle suit le premier et choisit un agrandissement ENTIER
 * (chaque pixel source devient `scale` pixels d'écran, donc des pixels tous de même taille) qui garde le plus
 * de monde possible à l'image.
 */

/** Côté d'une tuile dans les images sources, en pixels. */
export const TILE_PX = 16;
/** Au moins ce nombre de tuiles de large à l'image (le plus gros agrandissement). */
export const MIN_TILES_WIDE = 22;
/** Au plus ce nombre de tuiles de large à l'image (le plus petit agrandissement). */
export const MAX_TILES_WIDE = 60;
/** Marges autour des coureurs, en tuiles. */
export const MARGIN_X = 3;
export const MARGIN_TOP = 4.5;
export const MARGIN_BOTTOM = 1.8;
/** Il faut ce surplus de place pour zoomer (évite l'aller-retour entre deux agrandissements). */
export const ZOOM_IN_SLACK = 0.85;

export interface Point {
  x: number;
  y: number;
}

/** Ce que la caméra sait d'un coureur. */
export interface Follower extends Point {
  finished: boolean;
}

export interface CameraTarget {
  scale: number;
  /** Centre de l'image, en tuiles. */
  cx: number;
  cy: number;
}

export interface CameraInput {
  /** Coureurs à garder à l'image (voir `followSet`). */
  points: Point[];
  /** Le premier : la caméra ne le quitte pas, même quand tout le monde ne tient pas. */
  leader: Point | null;
  viewW: number;
  viewH: number;
  levelW: number;
  levelH: number;
  /** Agrandissement actuel (pour la marge d'hystérésis). */
  scale: number;
}

/** Plus petit et plus grand agrandissements entiers pour une largeur d'écran. */
export function scaleBounds(viewW: number): { min: number; max: number } {
  const max = Math.max(1, Math.min(8, Math.floor(viewW / (TILE_PX * MIN_TILES_WIDE))));
  const min = Math.max(1, Math.min(max, Math.floor(viewW / (TILE_PX * MAX_TILES_WIDE))));
  return { min, max };
}

/** Les coureurs que la caméra suit : ceux qui courent encore ; s'il n'en reste aucun, tous. Le premier = le plus à droite. */
export function followSet<T extends Follower>(players: readonly T[]): { points: T[]; leader: T | null } {
  const running = players.filter((p) => !p.finished);
  const set = running.length > 0 ? running : players.slice();
  let leader: T | null = null;
  for (const p of set) if (!leader || p.x > leader.x) leader = p;
  return { points: set, leader };
}

export function computeCamera(input: CameraInput): CameraTarget {
  const { points, leader, viewW, viewH, levelW, levelH } = input;
  const { min, max } = scaleBounds(viewW);
  if (points.length === 0 || !leader) {
    const s = Math.min(max, Math.max(min, input.scale || min));
    return clampCamera({ scale: s, cx: levelW / 2, cy: levelH / 2 }, viewW, viewH, levelW, levelH);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    // Un coureur tombé dans le vide ne fait pas descendre la caméra sous le niveau.
    const y = Math.min(p.y, levelH + 1);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const boxW = maxX - minX + 2 * MARGIN_X;
  const boxH = maxY - minY + MARGIN_TOP + MARGIN_BOTTOM;

  let scale = min;
  for (let s = max; s >= min; s--) {
    const slack = s > input.scale ? ZOOM_IN_SLACK : 1;
    if (boxW <= (viewW / (TILE_PX * s)) * slack && boxH <= (viewH / (TILE_PX * s)) * slack) {
      scale = s;
      break;
    }
  }

  const tilesW = viewW / (TILE_PX * scale);
  const tilesH = viewH / (TILE_PX * scale);
  let cx: number;
  let cy: number;
  if (boxW <= tilesW) cx = (minX + maxX) / 2;
  else cx = leader.x + tilesW * 0.12; // tout le monde ne tient pas : le premier, un peu à gauche du centre
  if (boxH <= tilesH) cy = (minY - MARGIN_TOP + maxY + MARGIN_BOTTOM) / 2;
  else cy = Math.min(leader.y, levelH + 1) - tilesH * 0.12;
  return clampCamera({ scale, cx, cy }, viewW, viewH, levelW, levelH);
}

/** Garde l'image dans le niveau : jamais de vide à gauche ou à droite ; niveau plus court que l'écran : posé en bas. */
export function clampCamera(
  c: CameraTarget,
  viewW: number,
  viewH: number,
  levelW: number,
  levelH: number,
): CameraTarget {
  const tilesW = viewW / (TILE_PX * c.scale);
  const tilesH = viewH / (TILE_PX * c.scale);
  const cx = levelW <= tilesW ? levelW / 2 : Math.min(levelW - tilesW / 2, Math.max(tilesW / 2, c.cx));
  const cy = levelH <= tilesH ? levelH - tilesH / 2 : Math.min(levelH - tilesH / 2, Math.max(tilesH / 2, c.cy));
  return { scale: c.scale, cx, cy };
}

/** Rapproche la caméra de sa cible (appelé à chaque pas de simulation). */
export function easeCamera(cur: CameraTarget, target: CameraTarget, rateX = 0.12, rateY = 0.1): CameraTarget {
  if (cur.scale !== target.scale) return { ...target };
  return {
    scale: cur.scale,
    cx: cur.cx + (target.cx - cur.cx) * rateX,
    cy: cur.cy + (target.cy - cur.cy) * rateY,
  };
}

export interface Indicator {
  /** Position de la pastille, en pixels d'écran. */
  x: number;
  y: number;
  /** Direction du coureur depuis le centre de l'écran (vecteur unitaire). */
  dx: number;
  dy: number;
  side: 'left' | 'right' | 'top' | 'bottom';
}

/** Indicateur au bord de l'écran pour un coureur hors champ ; `null` s'il est visible. */
export function indicatorFor(
  p: Point,
  cam: CameraTarget,
  viewW: number,
  viewH: number,
  margin: number,
): Indicator | null {
  const px = viewW / 2 + (p.x - cam.cx) * TILE_PX * cam.scale;
  const py = viewH / 2 + (p.y - 0.5 - cam.cy) * TILE_PX * cam.scale;
  const inside = px >= 0 && px <= viewW && py >= 0 && py <= viewH;
  if (inside) return null;
  const cx = viewW / 2;
  const cy = viewH / 2;
  const vx = px - cx;
  const vy = py - cy;
  const len = Math.hypot(vx, vy) || 1;
  const halfW = cx - margin;
  const halfH = cy - margin;
  const t = Math.min(halfW / Math.max(Math.abs(vx), 1e-6), halfH / Math.max(Math.abs(vy), 1e-6));
  const side: Indicator['side'] =
    Math.abs(vx) / halfW >= Math.abs(vy) / halfH ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'top' : 'bottom';
  return { x: cx + vx * t, y: cy + vy * t, dx: vx / len, dy: vy / len, side };
}
