import { COLS, ICE, ROWS, inMask } from '../physics.js';
import { hash, unitImage } from '../../bombes-party/client/render.js';
import { SPRITE_H, SPRITE_W } from '../../bombes-party/client/sprites.js';

/**
 * Plan de la banquise, vu de trois quarts, dans le style des plateaux de Bomberman enneigés : un îlot arrondi
 * de cubes de glace bleue, chacun avec sa face avant, posé sur une mer profonde. Certaines plaques ont une neige
 * sur le dessus, les trous sont des eaux noires, et des morceaux de banquise flottent autour. Entre deux rangées,
 * l'écart d'une plaque laisse voir sa face avant. Une case de la physique vaut une case du plan.
 *
 * Positions : (x, z) sur le plan, comme dans la physique. Un personnage plus loin en z (plus haut sur l'écran)
 * est dessiné avant les autres, pour que les premiers plans le recouvrent.
 */

/** Marge de mer à gauche et à droite, en cases. */
const SIDE_MARGIN = 1.1;
/** Marge de mer au-dessus et au-dessous, en cases. */
const TOP_MARGIN = 0.9;
/** Écrasement vertical du dessus : la hauteur d'une case vue de trois quarts, en part de sa largeur. */
const SQUASH = 0.6;
/** Épaisseur de la face avant d'un cube (et de l'écart entre rangées), en part de sa largeur. */
const THICK = 0.55;
/** Taille maximale d'une case (px CSS) : au-delà, le plan reste centré dans son cadre. */
const MAX_T = 48;
/** Nombre de morceaux de banquise flottants dans la mer. */
const CHUNK_COUNT = 16;

export interface BoardLayout {
  /** Largeur d'une case (px CSS). Un saut se mesure en multiples de cette valeur. */
  T: number;
  /** Pixel logique : un seizième de case, comme un pixel de Bomberman. */
  S: number;
  /** Marge de mer à gauche du plan, dans le plan (px). */
  pad: number;
  /** Marge de mer au-dessus du plan (px). */
  padY: number;
  /** Décalage horizontal du plan dans le cadre, pour le centrer (px). */
  ox: number;
  /** Hauteur d'une case vue de trois quarts (le dessus). */
  rowH: number;
  /** Épaisseur de la face avant d'un cube. */
  thick: number;
  width: number;
  height: number;
}

export function boardLayout(cssWidth: number): BoardLayout {
  const T = Math.min(cssWidth / (COLS + 2 * SIDE_MARGIN), MAX_T);
  const rowH = T * SQUASH;
  const thick = T * THICK;
  const padY = T * TOP_MARGIN;
  const boardW = T * (COLS + 2 * SIDE_MARGIN);
  return {
    T,
    S: T / 16,
    pad: T * SIDE_MARGIN,
    padY,
    ox: (cssWidth - boardW) / 2,
    rowH,
    thick,
    width: cssWidth,
    height: padY * 2 + ROWS * (rowH + thick),
  };
}

/** Ordonnée du haut d'une rangée (z entier), ou d'une position z continue, en pixels. */
export function rowTopY(L: BoardLayout, z: number): number {
  return L.padY + z * (L.rowH + L.thick);
}

/** Abscisse, en pixels, d'un personnage en `x` (cases). */
export function actorLeft(L: BoardLayout, x: number): number {
  return L.ox + L.pad + x * L.T;
}

/** Ligne de sol, en pixels, d'un personnage en `z` : ses pieds, dans la partie basse de sa case. */
export function groundY(L: BoardLayout, z: number): number {
  return rowTopY(L, z) + L.rowH * 0.8;
}

// Palette : mer profonde, glace bleue translucide, neige blanche, trous noirs.
const SEA_TOP = '#2f7ad8';
const SEA_MID = '#1656b0';
const SEA_BOTTOM = '#0a2a6e';
const CAUSTIC = '#8fd0ff';
const CHUNK_TOP = '#f4fbff';
const CHUNK_SIDE = '#6fb0e6';
const CHUNK_SHADE = '#3f7fc4';
const TOP_HI = '#e2f6ff';
const TOP_LO = '#8ccff3';
const TOP_EDGE = '#4f9fe0';
const SNOW = '#ffffff';
const SNOW_SHADE = '#cfe6f5';
const FRONT_HI = '#3d8fdc';
const FRONT_LO = '#1a4aa0';
const FRONT_LINE = '#9adcff';
const HOLE = '#0a1f55';
const HOLE_WALL = '#03102e';
const HOLE_RIM = '#4aa8f0';

/** Dessine un morceau de banquise : un polygone irrégulier, son côté sombre sous le dessus. */
function chunkPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.beginPath();
  g.moveTo(x, y + h * 0.3);
  g.lineTo(x + w * 0.3, y);
  g.lineTo(x + w * 0.8, y + h * 0.1);
  g.lineTo(x + w, y + h * 0.6);
  g.lineTo(x + w * 0.6, y + h);
  g.lineTo(x + w * 0.2, y + h * 0.9);
  g.closePath();
}

function drawChunk(g: CanvasRenderingContext2D, L: BoardLayout, x: number, y: number, w: number, h: number): void {
  chunkPath(g, x, y + h * 0.3, w, h);
  g.fillStyle = CHUNK_SHADE;
  g.fill();
  chunkPath(g, x, y + h * 0.12, w, h);
  g.fillStyle = CHUNK_SIDE;
  g.fill();
  chunkPath(g, x, y, w, h * 0.85);
  g.fillStyle = CHUNK_TOP;
  g.fill();
  // Neige sur le dessus, un peu décalée.
  g.fillStyle = SNOW;
  g.fillRect(x + w * 0.3, y + h * 0.2, w * 0.35, Math.max(1, L.S * 1.5));
}

/** Mer profonde : dégradé, reflets qui glissent lentement, morceaux de banquise dans les marges. */
function drawSea(g: CanvasRenderingContext2D, L: BoardLayout, now: number): void {
  const sea = g.createLinearGradient(0, 0, 0, L.height);
  sea.addColorStop(0, SEA_TOP);
  sea.addColorStop(0.5, SEA_MID);
  sea.addColorStop(1, SEA_BOTTOM);
  g.fillStyle = sea;
  g.fillRect(0, 0, L.width, L.height);

  // Reflets de lumière sous l'eau : de petites taches claires qui dérivent.
  g.fillStyle = CAUSTIC;
  for (let i = 0; i < 14; i++) {
    const x = ((hash(i, 11) + now / 14000) % 1) * L.width;
    const y = hash(i, 12) * L.height;
    g.globalAlpha = 0.12 + 0.08 * hash(i, 13);
    g.beginPath();
    g.ellipse(x, y, L.T * 0.35, L.T * 0.12, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  for (let i = 0; i < CHUNK_COUNT; i++) {
    let cx: number;
    let cy: number;
    switch (i % 4) {
      case 0:
        cx = (L.ox + L.pad) * (0.1 + 0.8 * hash(i, 31));
        cy = L.height * hash(i, 32);
        break;
      case 1:
        cx = L.width - (L.ox + L.pad) * (0.1 + 0.8 * hash(i, 31));
        cy = L.height * hash(i, 32);
        break;
      case 2:
        cx = L.width * hash(i, 31);
        cy = L.padY * (0.1 + 0.7 * hash(i, 32));
        break;
      default:
        cx = L.width * hash(i, 31);
        cy = L.height - L.padY * (0.1 + 0.7 * hash(i, 32));
    }
    const w = L.T * (0.8 + 0.8 * hash(i, 34));
    const h = w * 0.6;
    drawChunk(g, L, cx - w / 2, cy - h / 2, w, h);
  }
}

/** Trou : eau noire, paroi du fond dans l'ombre, bord clair sur le devant. */
function drawPit(g: CanvasRenderingContext2D, L: BoardLayout, x: number, y: number): void {
  g.fillStyle = HOLE;
  g.fillRect(x, y, L.T, L.rowH);
  g.fillStyle = HOLE_WALL;
  g.fillRect(x, y, L.T, L.rowH * 0.3);
  const b = Math.max(1, L.S);
  g.fillStyle = HOLE_RIM;
  g.fillRect(x, y + L.rowH - b, L.T, b);
  g.fillRect(x, y + L.rowH * 0.3, b, L.rowH * 0.7);
  g.fillRect(x + L.T - b, y + L.rowH * 0.3, b, L.rowH * 0.7);
}

/** Face avant d'un cube : bleue et translucide, avec une arête claire en haut. */
function drawFront(g: CanvasRenderingContext2D, L: BoardLayout, x: number, y: number): void {
  const grad = g.createLinearGradient(0, y, 0, y + L.thick);
  grad.addColorStop(0, FRONT_HI);
  grad.addColorStop(1, FRONT_LO);
  g.fillStyle = grad;
  g.fillRect(x, y, L.T, L.thick);
  g.fillStyle = FRONT_LINE;
  g.fillRect(x, y, L.T, Math.max(1, L.S * 1.2));
}

/** Dessus d'un cube : glace claire, arête sombre sur le bord, neige sur certaines plaques. */
function drawTop(g: CanvasRenderingContext2D, L: BoardLayout, c: number, row: number, x: number, y: number): void {
  const grad = g.createLinearGradient(0, y, 0, y + L.rowH);
  grad.addColorStop(0, TOP_HI);
  grad.addColorStop(1, TOP_LO);
  g.fillStyle = grad;
  g.fillRect(x, y, L.T, L.rowH);

  const b = Math.max(1, L.S * 1.2);
  g.fillStyle = TOP_EDGE;
  g.fillRect(x, y + L.rowH - b, L.T, b);
  g.fillRect(x + L.T - b, y, b, L.rowH);

  const seed = row * 31 + c;
  if (hash(seed, 9) < 0.35) {
    // Neige posée sur le dessus, avec deux pointes qui coulent vers le bas.
    const sx = x + b;
    const sw = L.T - 2 * b;
    const sh = L.rowH * (0.3 + 0.2 * hash(seed, 10));
    g.fillStyle = SNOW;
    g.fillRect(sx, y + b, sw, sh);
    g.fillStyle = SNOW_SHADE;
    g.fillRect(sx, y + b + sh, sw, b);
    g.fillStyle = SNOW;
    g.fillRect(sx + sw * 0.15, y + b + sh, sw * 0.12, b * 2);
    g.fillRect(sx + sw * 0.6, y + b + sh, sw * 0.12, b * 1.5);
  }
}

/** Personnage posé sur la glace. `lift` : hauteur du saut, en cases (négatif quand il coule). */
export interface ActorDraw {
  x: number;
  z: number;
  lift: number;
  colorIndex: number;
  facing: -1 | 1;
  walking: boolean;
  step: number;
}

/**
 * Dessine le plan : mer, puis l'îlot rangée par rangée, du fond vers l'avant. Les cases hors de l'îlot restent
 * de la mer ; les cases d'eau à l'intérieur sont des trous. Les personnages sont dessinés ensuite.
 */
export function drawBoard(g: CanvasRenderingContext2D, L: BoardLayout, ice: string, now: number, dpr: number): void {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, L.width, L.height);
  drawSea(g, L, now);

  g.save();
  g.translate(L.ox, 0);
  for (let row = 0; row < ROWS; row++) {
    const y = rowTopY(L, row);
    for (let c = 0; c < COLS; c++) {
      if (ice[row * COLS + c] !== ICE) continue;
      drawFront(g, L, L.pad + c * L.T, y + L.rowH);
    }
    for (let c = 0; c < COLS; c++) {
      const x = L.pad + c * L.T;
      if (ice[row * COLS + c] === ICE) drawTop(g, L, c, row, x, y);
      else if (inMask(c, row)) drawPit(g, L, x, y);
    }
  }
  g.restore();
}

/** Ombre au sol : plus petite et plus pâle quand le personnage saute. */
export function drawShadow(g: CanvasRenderingContext2D, L: BoardLayout, a: ActorDraw): void {
  const scale = Math.max(0.45, 1 - a.lift * 0.12);
  g.save();
  g.globalAlpha = Math.max(0.2, 0.4 - a.lift * 0.15);
  g.fillStyle = '#06203a';
  g.beginPath();
  g.ellipse(actorLeft(L, a.x), groundY(L, a.z), 5 * L.S * scale, 1.5 * L.S * scale, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Sprite de couleur, debout sur ses pieds. Un pas le fait rebondir d'un pixel. */
export function drawSpriteActor(g: CanvasRenderingContext2D, L: BoardLayout, a: ActorDraw): void {
  const bounce = a.walking && a.step ? L.S : 0;
  const top = groundY(L, a.z) - a.lift * L.T - bounce - SPRITE_H * L.S;
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
