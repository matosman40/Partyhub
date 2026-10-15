import { ICE, WIDTH } from '../physics.js';
import { hash, unitImage } from '../../bombes-party/client/render.js';
import { SPRITE_H, SPRITE_W } from '../../bombes-party/client/sprites.js';

/**
 * Plan de la banquise, vu de trois quarts comme les niveaux 3D de Bomberman. La grille est écrasée
 * verticalement : le dessus de chaque case est un carré aplati, et chaque plaque de glace montre sa face
 * avant, plus sombre, qui lui donne de l'épaisseur. Entre deux rangées, un écart de l'épaisseur d'une
 * plaque laisse voir cette face avant : sans lui, la rangée de devant cacherait tout. Les trous sont des
 * cases creuses. Les personnages sont debout sur la rangée centrale, avec leur ombre au sol.
 * Une colonne de la physique vaut une case.
 */

export const COLS = WIDTH;
/** Rangées dessinées : la première et la dernière sont de la mer, les trois du milieu sont la banquise. */
export const ROWS = 5;
export const FLOE_FIRST = 1;
export const FLOE_LAST = 3;
/** Rangée des personnages : la rangée centrale de la banquise. */
export const ACTOR_ROW = 2;

/** Écrasement vertical du dessus : la hauteur d'une case vue de trois quarts, en part de sa largeur. */
const SQUASH = 0.7;
/** Épaisseur de la face avant d'une plaque, en part de sa largeur. */
const THICK = 0.5;

export interface BoardLayout {
  /** Largeur d'une case, donc d'une colonne (px CSS). Un saut se mesure en multiples de cette valeur. */
  T: number;
  /** Pixel logique : un seizième de case, comme un pixel de Bomberman. */
  S: number;
  /** Marge horizontale : une demi-case de chaque côté. */
  pad: number;
  padY: number;
  /** Hauteur d'une case vue de trois quarts (le dessus). */
  rowH: number;
  /** Épaisseur de la face avant d'une plaque. */
  thick: number;
  width: number;
  height: number;
}

export function boardLayout(cssWidth: number): BoardLayout {
  // Vingt-deux demi-cases : vingt et une colonnes, plus une demi-case de marge de chaque côté.
  const T = cssWidth / (COLS + 1);
  const rowH = T * SQUASH;
  const thick = T * THICK;
  const padY = T * 0.4;
  return {
    T,
    S: T / 16,
    pad: T / 2,
    padY,
    rowH,
    thick,
    width: cssWidth,
    height: padY * 2 + ROWS * (rowH + thick),
  };
}

/** Ordonnée du haut du dessus d'une rangée, en pixels. Chaque rangée occupe son dessus plus l'écart. */
export function rowTopY(L: BoardLayout, row: number): number {
  return L.padY + row * (L.rowH + L.thick);
}

/** Abscisse, en pixels, d'un personnage placé en `x` (colonnes). */
export function actorLeft(L: BoardLayout, x: number): number {
  return L.pad + x * L.T;
}

/** Ligne de sol, en pixels : les pieds des personnages, posés dans la partie basse de leur case. */
export function groundY(L: BoardLayout): number {
  return rowTopY(L, ACTOR_ROW) + L.rowH * 0.8;
}

// Palette : mer bleue, glace claire, faces avant plus sombres, trous creux.
const SEA_TOP = '#3f97d6';
const SEA_BOTTOM = '#1b5d99';
const SEA_FOAM = '#8fd0f2';
const PEG = '#0a3560';
const PEG_RIM = '#7cc0ec';
const HOLE = '#06223f';
const HOLE_WALL = '#020f1e';
const FRONT = '#3a7bb0';
const FRONT_LO = '#245c8a';
const FRONT_LINE = '#6fa9d6';
const TOP_HI = '#ffffff';
const TOP_LO = '#cfeefa';
const BEVEL_LO = '#5c9fcb';
const CRACK = '#9ed2ee';

/** Case creuse vue de trois quarts : le fond sombre et le mur du fond, qui fait ombre en haut. */
function drawPit(g: CanvasRenderingContext2D, x: number, y: number, L: BoardLayout, floor: string): void {
  g.fillStyle = floor;
  g.fillRect(x, y, L.T, L.rowH);
  g.fillStyle = HOLE_WALL;
  g.fillRect(x, y, L.T, L.rowH * 0.3);
  g.fillStyle = PEG_RIM;
  g.fillRect(x, y + L.rowH - L.S, L.T, L.S);
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
      drawPit(g, L.pad + c * L.T + L.T * 0.2, rowTopY(L, row) + L.rowH * 0.2, { ...L, T: L.T * 0.6, rowH: L.rowH * 0.6 }, PEG);
    }
  }
}

/** Face avant d'une plaque : sombre, avec des lignes de strates, sous son dessus. */
function drawFront(g: CanvasRenderingContext2D, L: BoardLayout, x: number, y: number): void {
  const grad = g.createLinearGradient(0, y, 0, y + L.thick);
  grad.addColorStop(0, FRONT);
  grad.addColorStop(1, FRONT_LO);
  g.fillStyle = grad;
  g.fillRect(x, y, L.T, L.thick);
  g.fillStyle = FRONT_LINE;
  g.fillRect(x, y + L.thick * 0.35, L.T, Math.max(1, L.S * 0.8));
}

/** Dessus d'une plaque : dégradé clair, biseau de pixels comme les blocs de Bomberman, fissures. */
function drawTop(g: CanvasRenderingContext2D, L: BoardLayout, c: number, row: number, x: number, y: number): void {
  const grad = g.createLinearGradient(0, y, 0, y + L.rowH);
  grad.addColorStop(0, TOP_HI);
  grad.addColorStop(1, TOP_LO);
  g.fillStyle = grad;
  g.fillRect(x, y, L.T, L.rowH);

  const b = Math.max(1, L.S * 1.2);
  g.fillStyle = TOP_HI;
  g.fillRect(x, y, L.T, b);
  g.fillRect(x, y, b, L.rowH);
  g.fillStyle = BEVEL_LO;
  g.fillRect(x, y + L.rowH - b, L.T, b);
  g.fillRect(x + L.T - b, y, b, L.rowH);

  // Fissures : deux traits courts, placés de façon fixe pour chaque case.
  const seed = row * 31 + c;
  const px = Math.round(hash(seed, 3) * 6) * L.S + L.T * 0.2;
  const py = Math.round(hash(seed, 4) * 3) * L.S + L.rowH * 0.25;
  g.fillStyle = CRACK;
  g.fillRect(x + px, y + py, L.T * 0.28, Math.max(1, L.S));
  g.fillRect(x + px + L.T * 0.2, y + py + L.S, L.T * 0.18, Math.max(1, L.S));
  g.fillRect(x + L.T * 0.55, y + L.rowH * 0.6, L.T * 0.2, Math.max(1, L.S));
}

/** Plan complet : mer, trous, plaques de glace avec leur face avant. Les personnages sont dessinés ensuite. */
export function drawBoard(g: CanvasRenderingContext2D, L: BoardLayout, ice: string, now: number, dpr: number): void {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, L.width, L.height);
  drawSea(g, L, now);

  // Rangée par rangée, du fond vers l'avant : la face avant d'une rangée tombe dans l'écart qui la sépare de la suivante.
  for (let row = FLOE_FIRST; row <= FLOE_LAST; row++) {
    const y = rowTopY(L, row);
    for (let c = 0; c < COLS; c++) {
      const x = L.pad + c * L.T;
      if (ice[c] === ICE) drawFront(g, L, x, y + L.rowH);
    }
    for (let c = 0; c < COLS; c++) {
      const x = L.pad + c * L.T;
      if (ice[c] === ICE) drawTop(g, L, c, row, x, y);
      else drawPit(g, x, y, L, HOLE);
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

/** Sprite de couleur, debout sur ses pieds. Un pas le fait rebondir d'un pixel. */
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
