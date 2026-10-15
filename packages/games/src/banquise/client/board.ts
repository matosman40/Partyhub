import { ICE, WIDTH } from '../physics.js';
import { hash, unitImage } from '../../bombes-party/client/render.js';
import { SPRITE_H, SPRITE_W } from '../../bombes-party/client/sprites.js';

/**
 * Plan de la banquise, sur une grille carrée comme le plateau de Bomberman. Chaque case de glace est une
 * plaque carrée en relief : son dessus est clair, avec un biseau de pixels (lumière en haut à gauche, ombre
 * en bas à droite), et son côté, plus sombre, dépasse vers le bas. Les trous sont des cases creuses, posées
 * sur une mer bleue percée de trous. Une colonne de la physique vaut une case.
 */

export const COLS = WIDTH;
/** Rangées dessinées : la première et la dernière sont de la mer, les trois du milieu sont la banquise. */
export const ROWS = 5;
export const FLOE_FIRST = 1;
export const FLOE_LAST = 3;
/** Rangée des personnages : la rangée centrale de la banquise. */
export const ACTOR_ROW = 2;

export interface BoardLayout {
  /** Côté d'une case, donc d'une colonne (px CSS). Un saut se mesure en multiples de cette valeur. */
  T: number;
  /** Pixel logique : un seizième de case, comme un pixel de Bomberman. */
  S: number;
  /** Marge horizontale : une demi-case de chaque côté. */
  pad: number;
  padY: number;
  /** Épaisseur visible d'une plaque, sous son dessus. */
  thick: number;
  width: number;
  height: number;
}

export function boardLayout(cssWidth: number): BoardLayout {
  // Vingt-deux demi-cases : vingt et une colonnes, plus une demi-case de marge de chaque côté.
  const T = cssWidth / (COLS + 1);
  const padY = T * 0.35;
  const thick = T * 0.2;
  return {
    T,
    S: T / 16,
    pad: T / 2,
    padY,
    thick,
    width: cssWidth,
    height: padY * 2 + ROWS * T + thick,
  };
}

/** Ordonnée du centre d'une rangée, en pixels. */
export function rowCenterY(L: BoardLayout, row: number): number {
  return L.padY + L.T / 2 + row * L.T;
}

/** Abscisse, en pixels, d'un personnage placé en `x` (colonnes). */
export function actorLeft(L: BoardLayout, x: number): number {
  return L.pad + x * L.T;
}

/** Ligne de sol, en pixels : les pieds des personnages posés sur la rangée centrale. */
export function groundY(L: BoardLayout): number {
  return rowCenterY(L, ACTOR_ROW) + L.T * 0.25;
}

// Palette : mer bleue, glace claire avec un biseau, côté plus sombre, trous creux.
const SEA_TOP = '#3f97d6';
const SEA_BOTTOM = '#1b5d99';
const SEA_FOAM = '#8fd0f2';
const PEG = '#0a3560';
const PEG_RIM = '#7cc0ec';
const HOLE = '#082a4d';
const HOLE_SHADE = '#041a30';
const SIDE = '#4c8fc0';
const SIDE_LO = '#2a6291';
const TOP_HI = '#ffffff';
const TOP_LO = '#cfeefa';
const BEVEL_LO = '#5c9fcb';
const CRACK = '#9ed2ee';

/** Case creuse : un trou dans la mer ou dans la banquise, avec son bord. */
function drawPit(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  L: BoardLayout,
  color: string,
  shade: string,
): void {
  const side = L.T;
  g.fillStyle = shade;
  g.fillRect(x, y, side, side);
  g.fillStyle = color;
  g.fillRect(x, y + L.S, side, side - L.S * 2);
  g.fillStyle = PEG_RIM;
  g.fillRect(x, y + side - L.S, side, L.S);
}

/** Mer : dégradé, reflets qui glissent lentement, trous du cadre comme ceux d'un plateau à pions. */
function drawSea(g: CanvasRenderingContext2D, L: BoardLayout, now: number): void {
  const sea = g.createLinearGradient(0, 0, 0, L.height);
  sea.addColorStop(0, SEA_TOP);
  sea.addColorStop(1, SEA_BOTTOM);
  g.fillStyle = sea;
  g.fillRect(0, 0, L.width, L.height);

  g.strokeStyle = SEA_FOAM;
  g.lineWidth = Math.max(1, L.S * 1.2);
  g.globalAlpha = 0.35;
  for (let i = 0; i < 8; i++) {
    const x = ((hash(i, 11) * 1.4 + now / 9000) % 1.2) * L.width - L.width * 0.1;
    const y = L.padY + hash(i, 12) * L.height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + L.T * 0.6, y - L.T * 0.06);
    g.stroke();
  }
  g.globalAlpha = 1;

  // Trous du cadre : une case creuse sur deux, au-dessus et au-dessous de la banquise.
  for (const row of [0, ROWS - 1]) {
    for (let c = 0; c < COLS; c += 2) {
      const x = L.pad + c * L.T + L.T * 0.2;
      const y = rowCenterY(L, row) - L.T / 2 + L.T * 0.2;
      drawPit(g, x, y, { ...L, T: L.T * 0.6 }, PEG, '#0a2b4f');
    }
  }
}

/** Plaque de glace : côté sombre qui dépasse, dessus clair avec biseau de pixels et fissures. */
function drawPlate(g: CanvasRenderingContext2D, L: BoardLayout, c: number, row: number): void {
  const x = L.pad + c * L.T;
  const y = rowCenterY(L, row) - L.T / 2;
  const b = Math.max(1, L.S * 1.2);

  // Côté : la plaque est épaisse, son côté dépasse sous le dessus.
  g.fillStyle = SIDE_LO;
  g.fillRect(x, y, L.T, L.T + L.thick);
  g.fillStyle = SIDE;
  g.fillRect(x, y + L.T - L.S * 2, L.T, L.S * 2);

  // Dessus : dégradé clair.
  const grad = g.createLinearGradient(0, y, 0, y + L.T);
  grad.addColorStop(0, TOP_HI);
  grad.addColorStop(1, TOP_LO);
  g.fillStyle = grad;
  g.fillRect(x, y, L.T, L.T);

  // Biseau, comme les blocs de Bomberman : clair en haut et à gauche, sombre en bas et à droite.
  g.fillStyle = TOP_HI;
  g.fillRect(x, y, L.T, b);
  g.fillRect(x, y, b, L.T);
  g.fillStyle = BEVEL_LO;
  g.fillRect(x, y + L.T - b, L.T, b);
  g.fillRect(x + L.T - b, y, b, L.T);

  // Fissures : deux traits courts, placés de façon fixe pour chaque case.
  const seed = row * 31 + c;
  const px = Math.round(hash(seed, 3) * 6) * L.S + L.T * 0.2;
  const py = Math.round(hash(seed, 4) * 6) * L.S + L.T * 0.25;
  g.fillStyle = CRACK;
  g.fillRect(x + px, y + py, L.T * 0.28, Math.max(1, L.S));
  g.fillRect(x + px + L.T * 0.2, y + py + L.S, L.T * 0.18, Math.max(1, L.S));
  g.fillRect(x + L.T * 0.55, y + L.T * 0.6, L.T * 0.2, Math.max(1, L.S));
}

/** Plan complet : mer, trous, plaques de glace en relief. Les personnages sont dessinés ensuite. */
export function drawBoard(g: CanvasRenderingContext2D, L: BoardLayout, ice: string, now: number, dpr: number): void {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, L.width, L.height);
  drawSea(g, L, now);

  // Trous d'abord, puis les côtés, puis les dessus : une plaque recouvre le côté de celle du dessus.
  for (let row = FLOE_FIRST; row <= FLOE_LAST; row++) {
    for (let c = 0; c < COLS; c++) {
      if (ice[c] === ICE) continue;
      const x = L.pad + c * L.T;
      const y = rowCenterY(L, row) - L.T / 2;
      drawPit(g, x, y, L, HOLE, HOLE_SHADE);
    }
  }
  for (let row = FLOE_FIRST; row <= FLOE_LAST; row++) {
    for (let c = 0; c < COLS; c++) {
      if (ice[c] === ICE) drawPlate(g, L, c, row);
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
