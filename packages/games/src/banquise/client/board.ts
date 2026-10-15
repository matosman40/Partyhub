import { ICE, WIDTH } from '../physics.js';
import { hash, image, INK, rect, TILE_PX, unitImage } from '../../bombes-party/client/render.js';
import { SPRITE_H, SPRITE_W } from '../../bombes-party/client/sprites.js';

/**
 * Plan de la banquise, dessiné comme le plateau de Bomberman : vue de dessus, tuiles de 16 pixels
 * agrandies sans lissage, biseau asymétrique (lumière en haut à gauche, ombre en bas à droite).
 * La banquise occupe quelques rangées au milieu d'une mer ; les personnages se tiennent sur la rangée
 * centrale. Une colonne de glace vaut une tuile, comme dans la physique.
 */

export const COLS = WIDTH;
/** Rangées de mer au-dessus et au-dessous de la banquise. */
export const SEA_ROWS = 2;
export const FLOE_ROWS = 5;
export const ROWS = SEA_ROWS * 2 + FLOE_ROWS;
/** Rangée où se tiennent les personnages : le milieu de la banquise. */
export const ACTOR_ROW = SEA_ROWS + Math.floor(FLOE_ROWS / 2);
/** Marge autour du plan, en tuiles (comme le plateau de Bomberman). */
const PAD_TILES = 0.25;

export interface BoardLayout {
  /** Taille d'une tuile, en pixels CSS. */
  T: number;
  /** Pixel logique : une tuile fait 16 pixels logiques. */
  S: number;
  pad: number;
  width: number;
  height: number;
}

export function boardLayout(cssWidth: number): BoardLayout {
  const T = cssWidth / (COLS + PAD_TILES * 2);
  const pad = PAD_TILES * T;
  return { T, S: T / TILE_PX, pad, width: cssWidth, height: pad * 2 + ROWS * T };
}

/** Abscisse, en pixels, du centre d'un personnage placé en `x` (colonnes). */
export function actorLeft(L: BoardLayout, x: number): number {
  return L.pad + x * L.T;
}

/** Ligne de sol, en pixels : les pieds des personnages posés sur la rangée centrale. */
export function groundY(L: BoardLayout): number {
  return L.pad + (ACTOR_ROW + 1) * L.T - L.S;
}

// Palette : glace claire, biseau asymétrique, eau sombre à reflets.
const ICE_BASE = '#cdeef9';
const ICE_HI = '#f7fdff';
const ICE_LO = '#6aa9d2';
const ICE_EDGE = '#3c7fb0';
const ICE_CRACK = '#93c8e4';
const FOAM = '#ffffff';
const WATER = '#2b78b1';
const WATER_HI = '#84c8ec';
const WATER_LO = '#1b5a8a';

/** Bits : 1 eau au-dessus, 2 eau au-dessous, 4 eau à gauche, 8 eau à droite. */
function iceImage(mask: number, variant: number): HTMLCanvasElement {
  return image(`ice:${mask}:${variant}`, TILE_PX, TILE_PX, (g) => {
    rect(g, 0, 0, 16, 16, ICE_BASE);
    // Biseau : clair en haut et à gauche, sombre en bas et à droite. Au contact de l'eau, écume ou bord foncé.
    rect(g, 0, 0, 16, 1, mask & 1 ? FOAM : ICE_HI);
    rect(g, 0, 0, 1, 16, mask & 4 ? FOAM : ICE_HI);
    rect(g, 0, 15, 16, 1, mask & 2 ? ICE_EDGE : ICE_LO);
    rect(g, 15, 0, 1, 16, mask & 8 ? ICE_EDGE : ICE_LO);
    if (mask & 2) rect(g, 1, 14, 14, 1, ICE_EDGE);
    // Fissures et reflets, placés de façon fixe pour chaque variante.
    const px = 2 + Math.floor(hash(variant * 13 + 1, 5) * 9);
    const py = 3 + Math.floor(hash(variant * 7 + 2, 6) * 8);
    rect(g, px, py, 3, 1, ICE_CRACK);
    rect(g, px + 3, py + 1, 2, 1, ICE_CRACK);
    rect(g, px + 6, py + 4, 2, 1, ICE_CRACK);
    rect(g, 3 + variant * 6, 10, 1, 1, ICE_HI);
    rect(g, 10 - variant * 4, 5, 1, 1, ICE_HI);
  });
}

/** Eau : une image par reflet, qui glisse d'un pixel à chaque étape. */
function waterImage(frame: number, variant: number): HTMLCanvasElement {
  return image(`water:${frame}:${variant}`, TILE_PX, TILE_PX, (g) => {
    rect(g, 0, 0, 16, 16, WATER);
    rect(g, 0, 15, 16, 1, WATER_LO);
    for (let i = 0; i < 2; i++) {
      const y = 3 + i * 6 + variant;
      const x = (2 + hash(variant * 5 + i, 9) * 8 + frame * 2) % 12;
      rect(g, Math.floor(x) + 1, y, 3, 1, WATER_HI);
    }
  });
}

/** Ce qui entoure une case de glace : eau au-dessus (bord avant), au-dessous, à gauche, à droite. */
function iceMask(ice: string, row: number, col: number): number {
  const up = row === SEA_ROWS ? 1 : 0;
  const down = row === SEA_ROWS + FLOE_ROWS - 1 ? 2 : 0;
  const left = col === 0 || ice[col - 1] !== ICE ? 4 : 0;
  const right = col === COLS - 1 || ice[col + 1] !== ICE ? 8 : 0;
  return up | down | left | right;
}

/** Plan complet : mer, banquise, trous. Les tuiles sont peintes une fois et réutilisées à chaque image. */
export function drawBoard(ctx: CanvasRenderingContext2D, L: BoardLayout, ice: string, now: number, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  rect(ctx, 0, 0, L.width, L.height, INK);
  const frame = Math.floor(now / 260) % 4;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const floe = row >= SEA_ROWS && row < SEA_ROWS + FLOE_ROWS;
      const variant = hash(row * 31 + col, 7) < 0.5 ? 0 : 1;
      const tile = floe && ice[col] === ICE ? iceImage(iceMask(ice, row, col), variant) : waterImage(frame, variant);
      ctx.drawImage(tile, L.pad + col * L.T, L.pad + row * L.T, L.T, L.T);
    }
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, L.width - 3, L.height - 3);
}

/** Personnage posé sur la glace, vu de dessus comme sur le plateau. `lift` : hauteur du saut, en tuiles. */
export interface ActorDraw {
  x: number;
  lift: number;
  colorIndex: number;
  facing: -1 | 1;
  walking: boolean;
  step: number;
}

/** Ombre au sol, puis le sprite de couleur (ou le personnage importé, passé à part). */
export function drawShadow(ctx: CanvasRenderingContext2D, L: BoardLayout, a: ActorDraw): void {
  const feet = groundY(L);
  const scale = Math.max(0.45, 1 - a.lift * 0.12);
  ctx.save();
  ctx.globalAlpha = Math.max(0.2, 0.4 - a.lift * 0.15);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(actorLeft(L, a.x), feet, 5 * L.S * scale, 1.5 * L.S * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Sprite de couleur, posé sur ses pieds. Un pas le fait rebondir d'un pixel. */
export function drawSpriteActor(ctx: CanvasRenderingContext2D, L: BoardLayout, a: ActorDraw): void {
  const bounce = a.walking && a.step ? L.S : 0;
  const top = groundY(L) - a.lift * L.T - bounce - SPRITE_H * L.S;
  const facing = a.facing < 0 ? 'left' : 'right';
  ctx.drawImage(
    unitImage(a.colorIndex, 'front', a.step, facing),
    actorLeft(L, a.x) - (SPRITE_W * L.S) / 2,
    top,
    SPRITE_W * L.S,
    SPRITE_H * L.S,
  );
}
