import { COLS, ICE, ROWS, ROW_H, cellCenter, inMask } from '../physics.js';
import { hash, unitImage } from '../../bombes-party/client/render.js';
import { SPRITE_H, SPRITE_W } from '../../bombes-party/client/sprites.js';

/**
 * Plan de la banquise, vu de trois quarts : une grille hexagonale de cubes de glace bleue, chacun avec sa face
 * avant épaisse, posés sur une mer profonde. Certaines cases ont une neige sur le dessus, les trous sont des eaux
 * noires, et des morceaux de banquise flottent autour. Une case de la physique est un hexagone à pointe en haut ;
 * une ligne sur deux est décalée d’une demi-case.
 *
 * Positions : (x, z) sur le plan, comme dans la physique. Un personnage plus loin en z (plus haut sur l’écran)
 * est dessiné avant les autres, pour que les premiers plans le recouvrent.
 */

/** Marge de mer à gauche et à droite, en cases. */
const SIDE_MARGIN = 1;
/** Marge de mer au-dessus et au-dessous, en cases. */
const TOP_MARGIN = 0.8;
/** Écrasement vertical : la vue de trois quarts raccourcit la hauteur des hexagones. */
const SQUASH = 0.8;
/** Écart entre deux hexagones voisins, en part de leur taille : un joint sombre apparaît entre eux. */
const INSET = 0.92;
/** Hauteur de la face avant d’un cube, en part de la largeur d’une case. */
const THICK = 0.5;
/** Taille maximale d’une case (px CSS) : au-delà, le plan reste centré dans son cadre. */
const MAX_T = 48;
/** Rayon d’un hexagone à pointe en haut, en cases : 1 / √3. */
const HEX_R = 1 / Math.sqrt(3);
/** Nombre de morceaux de banquise flottants dans la mer. */
const CHUNK_COUNT = 16;

export interface BoardLayout {
  /** Largeur d’une case (px CSS). Un saut se mesure en multiples de cette valeur. */
  T: number;
  /** Pixel logique : un seizième de case, comme un pixel de Bomberman. */
  S: number;
  /** Marge de mer à gauche du plan, dans le plan (px). */
  pad: number;
  /** Marge de mer au-dessus du plan (px). */
  padY: number;
  /** Décalage horizontal du plan dans le cadre, pour le centrer (px). */
  ox: number;
  /** Pas vertical entre deux lignes d’hexagones (px). */
  rowStep: number;
  /** Demi-largeur et demi-hauteur d’un dessus d’hexagone (px). */
  hexW: number;
  hexH: number;
  /** Hauteur de la face avant d’un cube (px). */
  thick: number;
  width: number;
  height: number;
}

export function boardLayout(cssWidth: number): BoardLayout {
  const T = Math.min(cssWidth / (COLS + 2 * SIDE_MARGIN), MAX_T);
  const pad = T * SIDE_MARGIN;
  const padY = T * TOP_MARGIN;
  const rowStep = ROW_H * SQUASH * T;
  const hexW = 0.5 * T * INSET;
  const hexH = HEX_R * SQUASH * T * INSET;
  const thick = T * THICK;
  return {
    T,
    S: T / 16,
    pad,
    padY,
    ox: (cssWidth - (COLS * T + 2 * pad)) / 2,
    rowStep,
    hexW,
    hexH,
    thick,
    width: cssWidth,
    height: padY * 2 + (ROWS - 1) * rowStep + 2 * hexH + thick,
  };
}

/** Ordonnée, dans le plan, du centre d’une position z (en cases). */
function planY(L: BoardLayout, z: number): number {
  return L.padY + L.hexH + (z / ROW_H) * L.rowStep;
}

/** Abscisse, en pixels, d’un personnage en `x` (cases). */
export function actorLeft(L: BoardLayout, x: number): number {
  return L.ox + L.pad + (x + 0.5) * L.T;
}

/** Ligne de sol, en pixels, d’un personnage en `z` : ses pieds, dans la partie basse de sa case. */
export function groundY(L: BoardLayout, z: number): number {
  return planY(L, z) + L.hexH * 0.35;
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
const FACE_LEFT_HI = '#4f9fe0';
const FACE_LEFT_LO = '#2a6cb8';
const FACE_RIGHT_HI = '#2f7fcc';
const FACE_RIGHT_LO = '#1a4aa0';
const HOLE = '#0a1f55';
const HOLE_RIM = '#4aa8f0';

/** Chemin d’un hexagone à pointe en haut, centré en (cx, cy). */
function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number): void {
  g.beginPath();
  g.moveTo(cx, cy - hh);
  g.lineTo(cx + hw, cy - hh / 2);
  g.lineTo(cx + hw, cy + hh / 2);
  g.lineTo(cx, cy + hh);
  g.lineTo(cx - hw, cy + hh / 2);
  g.lineTo(cx - hw, cy - hh / 2);
  g.closePath();
}

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

  // Reflets de lumière sous l’eau : de petites taches claires qui dérivent.
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

/** Centre, dans le plan (sans le décalage du cadre), d’une case. */
function cellPos(L: BoardLayout, col: number, row: number): { x: number; y: number } {
  const c = cellCenter(col, row);
  return { x: L.pad + (c.x + 0.5) * L.T, y: planY(L, c.z) };
}

/**
 * Face avant d’un cube : deux pans sous les arêtes basses de l’hexagone, prolongés vers le bas.
 * Le pan gauche est plus clair, le droit plus sombre, comme la lumière des niveaux de Bomberman.
 */
function drawSkirt(g: CanvasRenderingContext2D, L: BoardLayout, cx: number, cy: number): void {
  const { hexW: hw, hexH: hh, thick: t } = L;
  const midY = cy + hh / 2;
  const leftGrad = g.createLinearGradient(0, midY, 0, midY + t);
  leftGrad.addColorStop(0, FACE_LEFT_HI);
  leftGrad.addColorStop(1, FACE_LEFT_LO);
  g.fillStyle = leftGrad;
  g.beginPath();
  g.moveTo(cx - hw, midY);
  g.lineTo(cx, cy + hh);
  g.lineTo(cx, cy + hh + t);
  g.lineTo(cx - hw, midY + t);
  g.closePath();
  g.fill();

  const rightGrad = g.createLinearGradient(0, midY, 0, midY + t);
  rightGrad.addColorStop(0, FACE_RIGHT_HI);
  rightGrad.addColorStop(1, FACE_RIGHT_LO);
  g.fillStyle = rightGrad;
  g.beginPath();
  g.moveTo(cx, cy + hh);
  g.lineTo(cx + hw, midY);
  g.lineTo(cx + hw, midY + t);
  g.lineTo(cx, cy + hh + t);
  g.closePath();
  g.fill();
}

/** Dessus d’un cube : glace claire, liseré sombre sur le bord, neige sur certaines cases. */
function drawTop(g: CanvasRenderingContext2D, L: BoardLayout, col: number, row: number, cx: number, cy: number): void {
  const { hexW: hw, hexH: hh } = L;
  const grad = g.createLinearGradient(0, cy - hh, 0, cy + hh);
  grad.addColorStop(0, TOP_HI);
  grad.addColorStop(1, TOP_LO);
  hexPath(g, cx, cy, hw, hh);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = TOP_EDGE;
  g.lineWidth = Math.max(1, L.S);
  g.stroke();

  const seed = row * 31 + col;
  if (hash(seed, 9) < 0.35) {
    // Neige posée sur le dessus, en un hexagone plus petit au bord haut de la case.
    hexPath(g, cx, cy - hh * 0.2, hw * 0.7, hh * 0.6);
    g.fillStyle = SNOW;
    g.fill();
  }
}

/** Trou : eau noire dans un hexagone, avec un liseré clair. */
function drawHole(g: CanvasRenderingContext2D, L: BoardLayout, cx: number, cy: number): void {
  hexPath(g, cx, cy, L.hexW, L.hexH);
  g.fillStyle = HOLE;
  g.fill();
  g.strokeStyle = HOLE_RIM;
  g.lineWidth = Math.max(1, L.S);
  g.stroke();
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
 * Dessine le plan : mer, puis l’îlot ligne par ligne, du fond vers l’avant. Une case de glace a sa face avant ;
 * une case d’eau à l’intérieur de l’îlot est un trou ; une case hors de l’îlot reste de la mer.
 */
export function drawBoard(g: CanvasRenderingContext2D, L: BoardLayout, ice: string, now: number, dpr: number): void {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, L.width, L.height);
  drawSea(g, L, now);

  g.save();
  g.translate(L.ox, 0);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (ice[row * COLS + col] !== ICE) continue;
      const p = cellPos(L, col, row);
      drawSkirt(g, L, p.x, p.y);
    }
    for (let col = 0; col < COLS; col++) {
      const p = cellPos(L, col, row);
      if (ice[row * COLS + col] === ICE) drawTop(g, L, col, row, p.x, p.y);
      else if (inMask(col, row)) drawHole(g, L, p.x, p.y);
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

/** Sprite de couleur, debout sur ses pieds. Un pas le fait rebondir d’un pixel. */
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
