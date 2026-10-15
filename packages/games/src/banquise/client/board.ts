import { ICE, WIDTH } from '../physics.js';
import { hash, unitImage } from '../../bombes-party/client/render.js';
import { SPRITE_H, SPRITE_W } from '../../bombes-party/client/sprites.js';

/**
 * Plan de la banquise, dessiné comme un plateau de jeu de société : des plaques de glace hexagonales
 * en relief, posées sur une mer bleue percée de trous. Une colonne de la physique vaut la largeur
 * d'une plaque. La rangée centrale (celle des personnages) a une plaque par colonne ; les rangées
 * voisines sont décalées d'une demi-plaque, pour former le nid d'abeille. Une plaque absente est un trou.
 */

export const COLS = WIDTH;
/** Rangées dessinées : la première et la dernière sont de la mer, les trois du milieu sont la banquise. */
export const ROWS = 5;
export const FLOE_FIRST = 1;
export const FLOE_LAST = 3;
/** Rangée des personnages : la rangée centrale, dont les plaques sont alignées sur les colonnes. */
export const ACTOR_ROW = 2;

export interface BoardLayout {
  /** Largeur d'une plaque, donc d'une colonne (px CSS). Un saut se mesure en multiples de cette valeur. */
  T: number;
  /** Pixel logique du sprite : un seizième de la plaque. */
  S: number;
  /** Marge horizontale : une demi-colonne de chaque côté, pour le décalage des rangées. */
  pad: number;
  padY: number;
  /** Hauteur d'une plaque (pointe en haut) et écart entre deux rangées. */
  hexH: number;
  rowStep: number;
  /** Épaisseur visible d'une plaque, sous son dessus. */
  thick: number;
  width: number;
  height: number;
}

export function boardLayout(cssWidth: number): BoardLayout {
  // Vingt-deux demi-colonnes : vingt et une colonnes, plus une demi-colonne de marge de chaque côté.
  const T = cssWidth / (COLS + 1);
  const hexH = (T * 2) / Math.sqrt(3);
  const rowStep = hexH * 0.75;
  const padY = hexH * 0.3;
  const thick = T * 0.22;
  return {
    T,
    S: T / 16,
    pad: T / 2,
    padY,
    hexH,
    rowStep,
    thick,
    width: cssWidth,
    height: padY * 2 + hexH + (ROWS - 1) * rowStep + thick,
  };
}

/** Ordonnée du centre d'une rangée, en pixels. */
export function rowCenterY(L: BoardLayout, row: number): number {
  return L.padY + L.hexH / 2 + row * L.rowStep;
}

/** Abscisse, en pixels, d'un personnage placé en `x` (colonnes). */
export function actorLeft(L: BoardLayout, x: number): number {
  return L.pad + x * L.T;
}

/** Ligne de sol, en pixels : les pieds des personnages posés sur la rangée centrale. */
export function groundY(L: BoardLayout): number {
  return rowCenterY(L, ACTOR_ROW) + L.T * 0.3;
}

// Palette : mer bleue, plaques de glace claires avec un côté plus sombre, trous d'eau foncés.
const SEA_TOP = '#3f97d6';
const SEA_BOTTOM = '#1b5d99';
const SEA_FOAM = '#8fd0f2';
const HOLE = '#0a3560';
const HOLE_RIM = '#7cc0ec';
const SIDE = '#4c8fc0';
const SIDE_LO = '#2f6896';
const TOP_HI = '#ffffff';
const TOP_LO = '#cfeefa';
const CRACK = '#9ed2ee';

/** Hexagone à pointe en haut, centré en (cx, cy), de rayon `r`. */
function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/** Rayon d'une plaque, un peu réduit pour laisser voir le joint entre deux plaques. */
function plateRadius(L: BoardLayout): number {
  return L.T / Math.sqrt(3) - L.T * 0.04;
}

interface Plate {
  row: number;
  /** Colonne de la physique la plus proche : sert de graine au décor. */
  col: number;
  /** Position horizontale, en colonnes (centre). */
  x: number;
  present: boolean;
}

/**
 * Plaques d'une rangée. La rangée des personnages a une plaque par colonne, centrée en c + 0,5. Les rangées
 * voisines ont une plaque entre deux colonnes, centrée en j + 1 : elle n'existe que si les deux colonnes sont de glace.
 */
function platesOf(ice: string, row: number): Plate[] {
  const plates: Plate[] = [];
  if (row === ACTOR_ROW) {
    for (let c = 0; c < COLS; c++) plates.push({ row, col: c, x: c + 0.5, present: ice[c] === ICE });
  } else {
    for (let j = 0; j < COLS - 1; j++) {
      plates.push({ row, col: j, x: j + 1, present: ice[j] === ICE && ice[j + 1] === ICE });
    }
  }
  return plates;
}

function drawHole(g: CanvasRenderingContext2D, cx: number, cy: number, L: BoardLayout): void {
  g.fillStyle = HOLE;
  g.beginPath();
  g.ellipse(cx, cy, L.T * 0.36, L.T * 0.3, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = HOLE_RIM;
  g.lineWidth = Math.max(1, L.T * 0.05);
  g.stroke();
}

/** Mer : dégradé, reflets qui glissent lentement, trous du cadre comme ceux d'un plateau à pions. */
function drawSea(g: CanvasRenderingContext2D, L: BoardLayout, now: number): void {
  const sea = g.createLinearGradient(0, 0, 0, L.height);
  sea.addColorStop(0, SEA_TOP);
  sea.addColorStop(1, SEA_BOTTOM);
  g.fillStyle = sea;
  g.fillRect(0, 0, L.width, L.height);

  g.strokeStyle = SEA_FOAM;
  g.lineWidth = Math.max(1, L.T * 0.04);
  g.globalAlpha = 0.35;
  for (let i = 0; i < 8; i++) {
    const x = ((hash(i, 11) * 1.4 + now / 9000) % 1.2) * L.width - L.width * 0.1;
    const y = L.padY + hash(i, 12) * L.height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + L.T * 0.7, y - L.T * 0.08);
    g.stroke();
  }
  g.globalAlpha = 1;

  for (const row of [0, ROWS - 1]) {
    const cy = rowCenterY(L, row);
    for (let x = 1; x < COLS + 1; x += 2) drawHole(g, L.pad + (x - 0.5) * L.T, cy, L);
  }
}

/** Dessus d'une plaque : dégradé clair, fissures et un petit éclat. */
function drawTop(g: CanvasRenderingContext2D, L: BoardLayout, cx: number, cy: number, seed: number): void {
  const r = plateRadius(L);
  const grad = g.createLinearGradient(0, cy - r, 0, cy + r);
  grad.addColorStop(0, TOP_HI);
  grad.addColorStop(1, TOP_LO);
  hexPath(g, cx, cy, r);
  g.fillStyle = grad;
  g.fill();

  // Fissures : deux traits courts, placés de façon fixe pour chaque plaque.
  const ox = (hash(seed, 3) - 0.5) * L.T * 0.4;
  const oy = (hash(seed, 4) - 0.5) * L.T * 0.25;
  g.strokeStyle = CRACK;
  g.lineWidth = Math.max(1, L.T * 0.035);
  g.beginPath();
  g.moveTo(cx - L.T * 0.22 + ox, cy + oy);
  g.lineTo(cx - L.T * 0.02 + ox, cy - L.T * 0.06 + oy);
  g.lineTo(cx + L.T * 0.14 + ox, cy - L.T * 0.02 + oy);
  g.stroke();
  g.fillStyle = TOP_HI;
  const dot = Math.max(1, L.T * 0.06);
  g.fillRect(cx + ox * 0.6, cy + L.T * 0.14, dot, dot);
}

/** Plan complet : mer, trous, plaques de glace en relief. Les personnages sont dessinés ensuite. */
export function drawBoard(g: CanvasRenderingContext2D, L: BoardLayout, ice: string, now: number, dpr: number): void {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, L.width, L.height);
  drawSea(g, L, now);

  const rows: Plate[][] = [];
  for (let row = FLOE_FIRST; row <= FLOE_LAST; row++) rows.push(platesOf(ice, row));

  // Trous : là où la plaque manque dans la banquise.
  for (const plates of rows) {
    for (const p of plates) {
      if (!p.present) drawHole(g, L.pad + p.x * L.T, rowCenterY(L, p.row), L);
    }
  }

  // Côtés d'abord, puis dessus : une plaque recouvre le côté de celle qui est au-dessus d'elle.
  const r = plateRadius(L);
  for (const plates of rows) {
    for (const p of plates) {
      if (!p.present) continue;
      const cx = L.pad + p.x * L.T;
      const cy = rowCenterY(L, p.row);
      const side = g.createLinearGradient(0, cy, 0, cy + L.thick + r);
      side.addColorStop(0, SIDE);
      side.addColorStop(1, SIDE_LO);
      hexPath(g, cx, cy + L.thick, r);
      g.fillStyle = side;
      g.fill();
    }
  }
  for (const plates of rows) {
    for (const p of plates) {
      if (!p.present) continue;
      drawTop(g, L, L.pad + p.x * L.T, rowCenterY(L, p.row), p.row * 31 + p.col);
    }
  }
}

/** Personnage posé sur la glace. `lift` : hauteur du saut, en colonnes (négatif quand il coule). */
export interface ActorDraw {
  x: number;
  lift: number;
  colorIndex: number;
  facing: -1 | 1;
  walking: boolean;
  step: number;
}

/** Ombre au sol : plus petite et plus pâle quand le personnage saute. */
export function drawShadow(g: CanvasRenderingContext2D, L: BoardLayout, a: ActorDraw): void {
  const scale = Math.max(0.45, 1 - a.lift * 0.12);
  g.save();
  g.globalAlpha = Math.max(0.2, 0.4 - a.lift * 0.15);
  g.fillStyle = '#06203a';
  g.beginPath();
  g.ellipse(actorLeft(L, a.x), groundY(L), 5 * L.S * scale, 1.5 * L.S * scale, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Sprite de couleur, posé sur ses pieds. Un pas le fait rebondir d'un pixel. */
export function drawSpriteActor(g: CanvasRenderingContext2D, L: BoardLayout, a: ActorDraw): void {
  const bounce = a.walking && a.step ? L.S : 0;
  const top = groundY(L) - a.lift * L.T - bounce - SPRITE_H * L.S;
  const facing = a.facing < 0 ? 'left' : 'right';
  g.imageSmoothingEnabled = false;
  g.drawImage(
    unitImage(a.colorIndex, 'front', a.step, facing),
    actorLeft(L, a.x) - (SPRITE_W * L.S) / 2,
    top,
    SPRITE_W * L.S,
    SPRITE_H * L.S,
  );
}
