import { PIXEL_TRANSPARENT, type PixelBitmap } from '@partyhub/shared';
import type { LevelTheme } from '../engine.js';

/**
 * Décors, tuiles et créatures de la Course des sauteurs, dessinés par code avec les 16 couleurs de la palette
 * commune (indices de `PIXEL_PALETTE`). Tout est pur et déterministe : les tests vérifient les tailles et la palette.
 */

// Indices de la palette.
export const K = 0; // contour #101010
export const W = 1; // blanc
export const G = 2; // gris clair
export const D = 3; // gris foncé
export const SK = 4; // peau claire
export const TN = 5; // brun clair
export const BR = 6; // brun
export const DB = 7; // brun très foncé
export const R = 8; // rouge
export const O = 9; // orange
export const Y = 10; // jaune
export const GR = 11; // vert
export const DG = 12; // vert foncé
export const BL = 13; // bleu
export const PU = 14; // violet
export const CY = 15; // cyan
const T = PIXEL_TRANSPARENT;

export const TILE = 16;

/** Petite toile d'indices de palette. */
export class Pix implements PixelBitmap {
  readonly pixels: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    fill: number = T,
  ) {
    this.pixels = new Uint8Array(width * height).fill(fill);
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return T;
    return this.pixels[y * this.width + x]!;
  }
  set(x: number, y: number, c: number): this {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.pixels[y * this.width + x] = c;
    return this;
  }
  rect(x: number, y: number, w: number, h: number, c: number): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    return this;
  }
  /** Ellipse pleine centrée en (cx, cy) de rayons (rx, ry). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
    return this;
  }
  /** Recopie `src` en (x, y) (les pixels transparents ne recouvrent rien). */
  blit(src: PixelBitmap, x: number, y: number): this {
    for (let j = 0; j < src.height; j++) {
      for (let i = 0; i < src.width; i++) {
        const c = src.pixels[j * src.width + i]!;
        if (c !== T) this.set(x + i, y + j, c);
      }
    }
    return this;
  }
  /** Trait de contour de 1 pixel : les pixels opaques qui touchent le vide (ou une couleur d'exclusion) deviennent `c`. */
  edge(c: number = K, outsideOpaque = false): this {
    const copy = this.pixels.slice();
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= this.width || y >= this.height ? (outsideOpaque ? 0 : T) : copy[y * this.width + x]!;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (copy[y * this.width + x] === T) continue;
        if (at(x - 1, y) === T || at(x + 1, y) === T || at(x, y - 1) === T || at(x, y + 1) === T) {
          this.pixels[y * this.width + x] = c;
        }
      }
    }
    return this;
  }
  /** Contour AUTOUR de la forme (sur les pixels vides voisins). */
  outline(c: number = K): this {
    const copy = this.pixels.slice();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (copy[y * this.width + x] !== T) continue;
        const n = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].some(
          ([a, b]) => a! >= 0 && b! >= 0 && a! < this.width && b! < this.height && copy[b! * this.width + a!] !== T,
        );
        if (n) this.pixels[y * this.width + x] = c;
      }
    }
    return this;
  }
}

const LEGEND: Record<string, number> = {
  k: K,
  w: W,
  g: G,
  d: D,
  s: SK,
  t: TN,
  b: BR,
  n: DB,
  r: R,
  o: O,
  y: Y,
  G: GR,
  H: DG,
  u: BL,
  p: PU,
  c: CY,
};

/** Dessin en texte : une lettre par pixel (voir `LEGEND`), `.` = transparent. Toutes les lignes ont la même longueur. */
export function fromRows(rows: readonly string[]): Pix {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const pix = new Pix(w, h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '.';
      if (ch !== '.') pix.set(x, y, LEGEND[ch] ?? T);
    }
  });
  return pix;
}

// ---------------------------------------------------------------------------------------------
// Tuiles
// ---------------------------------------------------------------------------------------------

export interface GroundPalette {
  top: number;
  topHi: number;
  topShade: number;
  fill: number;
  speck: number;
  pebble: number;
}

export const GROUND: Record<LevelTheme, GroundPalette> = {
  prairie: { top: GR, topHi: Y, topShade: DG, fill: BR, speck: DB, pebble: TN },
  grotte: { top: G, topHi: W, topShade: D, fill: D, speck: K, pebble: G },
  ciel: { top: GR, topHi: CY, topShade: DG, fill: TN, speck: BR, pebble: SK },
};

/** Terre : un fond avec quelques cailloux, deux variantes pour casser la répétition. */
export function groundFill(theme: LevelTheme, variant: 0 | 1): Pix {
  const p = GROUND[theme];
  const t = new Pix(TILE, TILE, p.fill);
  const specks =
    variant === 0
      ? [
          [3, 3],
          [11, 5],
          [6, 10],
          [13, 13],
          [1, 14],
        ]
      : [
          [12, 2],
          [4, 6],
          [9, 11],
          [2, 13],
          [14, 9],
        ];
  for (const [x, y] of specks) {
    t.set(x!, y!, p.speck);
    t.set(x! + 1, y!, p.speck);
  }
  const pebbles =
    variant === 0
      ? [
          [8, 2],
          [1, 8],
          [12, 11],
        ]
      : [
          [7, 4],
          [13, 6],
          [5, 12],
        ];
  for (const [x, y] of pebbles) t.set(x!, y!, p.pebble);
  if (theme === 'grotte') {
    // Veines de roche : des fissures sombres.
    t.rect(variant === 0 ? 6 : 3, 7, 1, 3, K).set(variant === 0 ? 7 : 4, 9, K);
  }
  return t;
}

/** Terre avec le dessus (herbe ou roche lisse) : contour noir en haut, franges en dessous. */
export function groundTop(theme: LevelTheme, variant: 0 | 1): Pix {
  const p = GROUND[theme];
  const t = groundFill(theme, variant);
  t.rect(0, 0, TILE, 1, K);
  t.rect(0, 1, TILE, 3, p.top);
  t.rect(0, 1, TILE, 1, p.topHi === Y || p.topHi === CY ? p.top : p.topHi);
  if (p.topHi === W || p.topHi === Y || p.topHi === CY) {
    for (let x = variant === 0 ? 2 : 5; x < TILE; x += 6) t.set(x, 1, p.topHi);
  }
  // Franges : des brins qui descendent sous la bande.
  for (let x = 0; x < TILE; x++) {
    const len = (x * 5 + variant * 3) % 4 === 0 ? 3 : (x * 3 + variant) % 3 === 0 ? 2 : 1;
    for (let j = 0; j < len; j++) t.set(x, 4 + j, p.topShade);
  }
  return t;
}

/** Brique : joints bruns, chaque brique éclairée en haut. */
export function brick(): Pix {
  const t = new Pix(TILE, TILE, BR);
  const rows = [0, 4, 8, 12];
  rows.forEach((y0, i) => {
    const off = i % 2 === 0 ? 0 : 4;
    for (let x0 = -off; x0 < TILE; x0 += 8) {
      const x = Math.max(0, x0);
      const w = Math.min(TILE, x0 + 7) - x;
      t.rect(x, y0, Math.max(0, w), 3, TN);
      t.rect(x, y0, Math.max(0, w), 1, SK);
      t.rect(x, y0 + 2, Math.max(0, w), 1, O);
    }
  });
  t.rect(0, 15, TILE, 1, K).rect(15, 0, 1, TILE, K).rect(0, 0, TILE, 1, K).rect(0, 0, 1, TILE, K);
  return t;
}

const QUESTION = ['.WWW.', 'W...W', '....W', '...W.', '..W..', '.....', '..W..'];

/** Bloc bonus : bloc jaune cerné de noir, avec un point d'interrogation blanc ombré. */
export function bonusBlock(used: boolean): Pix {
  const t = new Pix(TILE, TILE, used ? D : Y);
  if (used) {
    t.rect(1, 1, 14, 14, G).rect(2, 2, 12, 12, D).rect(2, 2, 12, 1, G);
    for (const [x, y] of [
      [3, 3],
      [12, 3],
      [3, 12],
      [12, 12],
    ])
      t.set(x!, y!, K);
  } else {
    t.rect(1, 1, 14, 14, Y).rect(1, 13, 14, 2, O).rect(13, 1, 2, 14, O).rect(1, 1, 14, 1, W);
    t.rect(2, 2, 12, 1, Y);
    for (const [x, y] of [
      [2, 2],
      [13, 2],
      [2, 13],
      [13, 13],
    ])
      t.set(x!, y!, BR);
    QUESTION.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === 'W') t.set(5 + i + 1, 4 + j + 1, BR);
    });
    QUESTION.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === 'W') t.set(5 + i, 4 + j, W);
    });
  }
  t.rect(0, 0, TILE, 1, K).rect(0, 15, TILE, 1, K).rect(0, 0, 1, TILE, K).rect(15, 0, 1, TILE, K);
  return t;
}

/** Plateforme traversable par dessous : une planche fine. */
export function oneWay(): Pix {
  const t = new Pix(TILE, TILE);
  t.rect(0, 0, TILE, 6, K);
  t.rect(1, 1, 14, 4, TN);
  t.rect(1, 1, 14, 1, SK);
  t.rect(1, 4, 14, 1, BR);
  for (const x of [5, 10]) t.rect(x, 1, 1, 4, BR);
  t.rect(0, 0, 1, 6, K).rect(15, 0, 1, 6, K);
  return t;
}

/** Trois pointes grises. */
export function spikes(): Pix {
  const t = new Pix(TILE, TILE);
  for (const cx of [2.7, 8, 13.3]) {
    for (let y = 6; y < 16; y++) {
      const half = 0.6 + ((y - 6) / 9) * 2.4;
      for (let x = 0; x < TILE; x++) if (Math.abs(x + 0.5 - cx) <= half) t.set(x, y, G);
    }
  }
  t.edge(K, true);
  // Reflets blancs sur le flanc gauche, ombre à droite.
  for (const cx of [2.7, 8, 13.3]) {
    for (let y = 8; y < 15; y++) {
      const lx = Math.round(cx - 0.5 - ((y - 6) / 9) * 2.4 + 1);
      if (t.get(lx, y) === G) t.set(lx, y, W);
    }
  }
  return t;
}

/** Ressort, étendu (0) ou écrasé (1). */
export function spring(pressed: boolean): Pix {
  const pad = pressed ? 9 : 4;
  const t = new Pix(TILE, TILE);
  t.rect(1, 13, 14, 3, D);
  t.rect(2, 13, 12, 1, G);
  const coilTop = pad + 3;
  for (let y = coilTop; y < 13; y++) {
    for (let x = 4; x < 12; x++) t.set(x, y, (x + y) % 2 === 0 ? G : D);
  }
  t.rect(1, pad, 14, 3, R).rect(2, pad + 1, 3, 1, W);
  t.edge(K, true);
  // Le contour des ressorts s'arrête aux bords de la tuile.
  return t;
}

/** Point de contrôle : un mât avec un fanion, gris tant qu'il n'est pas atteint, jaune ensuite. */
export function checkpoint(active: boolean): Pix {
  const t = new Pix(TILE, TILE);
  t.rect(3, 14, 6, 2, D).rect(3, 14, 6, 1, G);
  t.rect(5, 1, 2, 13, active ? W : G);
  t.rect(5, 1, 1, 13, W);
  t.rect(4, 0, 4, 2, active ? Y : G);
  for (let y = 2; y <= 8; y++) {
    const width = Math.round(8 - Math.abs(y - 5) * 2.2);
    t.rect(7, y, Math.max(1, width), 1, active ? Y : D);
  }
  if (active) {
    t.rect(8, 3, 2, 1, W);
    t.rect(8, 5, 4, 1, O);
  }
  t.edge(K, true);
  return t;
}

/** Fanion d'arrivée : mât blanc et gris ; la tuile du haut porte une boule et un drapeau rouge qui flotte. */
export function finishPole(top: boolean, wave: 0 | 1): Pix {
  const t = new Pix(TILE, TILE);
  t.rect(7, 0, 2, 16, W).rect(8, 0, 1, 16, G);
  if (top) {
    t.ellipse(8, 3, 2.5, 2.5, Y);
    t.rect(7, 2, 1, 1, W);
    t.rect(7, 0, 2, 1, T);
    t.ellipse(8, 3, 2.5, 2.5, Y);
    // Drapeau : un damier rouge et blanc qui ondule.
    for (let y = 5; y < 12; y++) {
      const len = 7 - Math.abs(y - 8) + (wave === 1 ? (y % 2 === 0 ? 1 : -1) : y % 2 === 0 ? -1 : 1);
      for (let x = 0; x < len; x++) {
        const cx = 9 + x;
        t.set(cx, y, (x + y) % 2 === 0 ? R : W);
      }
    }
  }
  t.edge(K, true);
  t.rect(7, 15, 2, 1, K);
  return t;
}

/** Pièce qui tourne : 4 images (face, trois quarts, tranche, trois quarts). */
export function coin(frame: 0 | 1 | 2 | 3): Pix {
  const t = new Pix(TILE, TILE);
  if (frame === 2) {
    // De tranche : une lame jaune de deux pixels, cernée de noir.
    t.rect(7, 3, 2, 10, Y).rect(8, 4, 1, 8, O);
    t.rect(6, 4, 1, 8, K).rect(9, 4, 1, 8, K).rect(7, 2, 2, 1, K).rect(7, 13, 2, 1, K);
    return t;
  }
  const rx = [5, 3.5, 0, 3.5][frame]!;
  t.ellipse(8, 8, rx, 6, Y);
  t.ellipse(8, 8, Math.max(1, rx - 2), 4, O);
  t.ellipse(7.5, 7.5, Math.max(1, rx - 3), 3, Y);
  t.rect(6, 5, 1, 2, W);
  t.edge(K);
  return t;
}

/** Pièce déjà prise par le premier mais encore à prendre pour les autres : un anneau gris. */
export function coinGhost(): Pix {
  const t = new Pix(TILE, TILE);
  t.ellipse(8, 8, 5, 6, G);
  t.ellipse(8, 8, 3, 4, T);
  t.edge(D);
  return t;
}

const SLIME_A = [
  '................',
  '................',
  '................',
  '................',
  '.....kkkkkk.....',
  '...kkGGGGGGkk...',
  '..kGwwGGGGGGGk..',
  '.kGwGGGGGGGGGGk.',
  '.kGGGGGGGGGGGGk.',
  '.kGGwwGGGGwwGGk.',
  '.kGGwkGGGGwkGGk.',
  '.kGGGGGGGGGGGHk.',
  '.kGGGGGGGGGHHHk.',
  '.kHGGGGGGGHHHHk.',
  '..kHHHHHHHHHHk..',
  '...kkkkkkkkkk...',
];

const SLIME_B = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '....kkkkkkkk....',
  '..kkGGGGGGGGkk..',
  '.kGwwGGGGGGGGGk.',
  'kGGGGGGGGGGGGGGk',
  'kGGGwwGGGGwwGGGk',
  'kGGGwkGGGGwkGGGk',
  'kGGGGGGGGGGGGHHk',
  'kHGGGGGGGGHHHHHk',
  'kHHHHHHHHHHHHHHk',
  '.kkkkkkkkkkkkkk.',
];

/** Petit slime vert : deux images (haut, aplati). */
export function slime(frame: 0 | 1): Pix {
  return fromRows(frame === 0 ? SLIME_A : SLIME_B);
}

/** Étincelle de pièce, 3 × 3. */
export function sparkle(): Pix {
  return fromRows(['.y.', 'ywy', '.y.']);
}

// ---------------------------------------------------------------------------------------------
// Décors à parallaxe
// ---------------------------------------------------------------------------------------------

/** Une couche répétée horizontalement. */
export interface BackdropLayer {
  bitmap: PixelBitmap;
  /** Part du déplacement de la caméra suivie par la couche (0 : collée à l'écran, 1 : comme le niveau). */
  factor: number;
  /** Où poser la couche. */
  anchor: 'bottom' | 'top' | 'sky';
  /** Dérive propre (pixels par seconde, vers la gauche), pour les nuages. */
  drift: number;
  /** Couleur de remplissage sous (bottom) ou sur (top) la couche, quand elle ne couvre pas tout l'écran. */
  fill: number | null;
}

export interface Backdrop {
  /** Couleur du ciel (fond uni). */
  sky: number;
  /** Bandes du ciel : [fraction de hauteur de départ, couleur, damier avec la couleur précédente]. */
  bands: { from: number; color: number; dither?: boolean }[];
  layers: BackdropLayer[];
}

const PERIOD = 256;

/** Hasard déterministe (mulberry32) : les décors sont identiques à chaque partie. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cloud(w: number, h: number, seed: number): Pix {
  const rand = rng(seed);
  const t = new Pix(w, h);
  const bumps = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < bumps; i++) {
    const cx = (w * (i + 0.7)) / (bumps + 0.4);
    const r = h * (0.28 + rand() * 0.2);
    t.ellipse(cx, h - 1 - r * 0.9, r * 1.15, r, W);
  }
  t.rect(Math.floor(w * 0.08), h - 5, Math.floor(w * 0.84), 4, W);
  // Dessous gris (un seul aplat).
  for (let y = h - 3; y < h; y++) for (let x = 0; x < w; x++) if (t.get(x, y) === W) t.set(x, y, G);
  return t;
}

function placeClouds(count: number, hMax: number, layerH: number, seed: number, w = 48, h = 20): Pix {
  const rand = rng(seed);
  const layer = new Pix(PERIOD, layerH);
  for (let i = 0; i < count; i++) {
    const cw = w - 8 + Math.floor(rand() * 24);
    const ch = h - 4 + Math.floor(rand() * 8);
    const x = Math.floor((i * PERIOD) / count + rand() * 20);
    const y = Math.floor(rand() * Math.max(1, hMax - ch));
    const c = cloud(cw, ch, seed * 31 + i);
    // Les nuages qui passent au bord se prolongent de l'autre côté.
    layer.blit(c, x, y);
    layer.blit(c, x - PERIOD, y);
  }
  return layer;
}

function hills(
  height: number,
  base: number,
  amp: number,
  waves: [number, number][],
  body: number,
  light: number | null,
  seed: number,
): Pix {
  const t = new Pix(PERIOD, height);
  const rand = rng(seed);
  const phase = waves.map(() => rand() * Math.PI * 2);
  for (let x = 0; x < PERIOD; x++) {
    let v = 0;
    waves.forEach(([freq, weight], i) => {
      v += weight * Math.sin(((x * freq) / PERIOD) * Math.PI * 2 + phase[i]!);
    });
    const top = Math.max(0, Math.min(height - 1, Math.round(height - base - amp * v)));
    for (let y = top; y < height; y++) t.set(x, y, body);
    if (light !== null) {
      t.set(x, top, light);
      if (x % 4 < 2) t.set(x, top + 1, light);
    }
  }
  return t;
}

function bushes(height: number, seed: number): Pix {
  const rand = rng(seed);
  const t = new Pix(PERIOD, height);
  for (let i = 0; i < 9; i++) {
    const cx = Math.floor((i * PERIOD) / 9 + rand() * 12);
    const r = 5 + Math.floor(rand() * 5);
    for (const sx of [cx, cx - PERIOD]) {
      t.ellipse(sx, height - 4, r * 1.4, r, DG);
      t.ellipse(sx - 1, height - 4 - r * 0.35, r * 0.9, r * 0.7, GR);
    }
  }
  t.rect(0, height - 3, PERIOD, 3, DG);
  return t;
}

function stalactites(height: number, seed: number): Pix {
  const rand = rng(seed);
  const t = new Pix(PERIOD, height);
  t.rect(0, 0, PERIOD, 4, D);
  let x = 0;
  while (x < PERIOD) {
    const w = 8 + Math.floor(rand() * 12);
    const len = 8 + Math.floor(rand() * (height - 12));
    for (let y = 0; y < len; y++) {
      const half = (w / 2) * (1 - y / (len + 2));
      for (let i = 0; i < PERIOD; i++) {
        if (Math.abs(i + 0.5 - (x + w / 2)) <= half) t.set(i % PERIOD, y, D);
      }
    }
    x += w + 2 + Math.floor(rand() * 8);
  }
  t.edge(K);
  // Éclats clairs sur le côté gauche des pointes.
  for (let i = 1; i < PERIOD; i++) {
    for (let y = 4; y < height - 1; y++) {
      if (t.get(i, y) === D && t.get(i - 1, y) === K && y % 3 === 0) t.set(i, y, G);
    }
  }
  return t;
}

function caveWall(height: number, seed: number): Pix {
  const rand = rng(seed);
  const t = new Pix(PERIOD, height, K);
  for (let i = 0; i < 26; i++) {
    const cx = rand() * PERIOD;
    const cy = rand() * height;
    const rx = 7 + rand() * 14;
    const ry = 5 + rand() * 9;
    for (const sx of [cx, cx - PERIOD]) {
      t.ellipse(sx, cy, rx, ry, D);
      t.ellipse(sx - 1, cy - 1, rx * 0.6, ry * 0.55, K);
    }
  }
  // Cristaux : de petits losanges cyan et blancs piqués dans la roche.
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(rand() * (PERIOD - 4));
    const y = Math.floor(rand() * (height - 4));
    t.set(x + 1, y, CY)
      .set(x, y + 1, CY)
      .set(x + 1, y + 1, W)
      .set(x + 2, y + 1, CY)
      .set(x + 1, y + 2, CY);
  }
  return t;
}

function floorRocks(height: number, seed: number): Pix {
  const rand = rng(seed);
  const t = new Pix(PERIOD, height);
  let x = 0;
  while (x < PERIOD) {
    const w = 10 + Math.floor(rand() * 14);
    const h = 6 + Math.floor(rand() * (height - 6));
    for (let y = 0; y < h; y++) {
      const half = (w / 2) * (1 - y / (h + 3));
      for (let i = 0; i < PERIOD; i++) {
        if (Math.abs(i + 0.5 - (x + w / 2)) <= half) t.set(i % PERIOD, height - 1 - y, D);
      }
    }
    x += w + Math.floor(rand() * 6);
  }
  t.edge(K);
  return t;
}

function islands(height: number, seed: number): Pix {
  const rand = rng(seed);
  const t = new Pix(PERIOD, height);
  const count = 3;
  for (let i = 0; i < count; i++) {
    const w = 38 + Math.floor(rand() * 24);
    const cx = Math.floor((i * PERIOD) / count + 20 + rand() * 30);
    const top = 6 + Math.floor(rand() * (height - 44));
    const depth = 14 + Math.floor(rand() * 10);
    const isle = new Pix(w, depth + 6);
    isle.rect(0, 0, w, 5, W).rect(2, 3, w - 4, 2, G);
    for (let y = 5; y < depth + 6; y++) {
      const half = (w / 2) * (1 - (y - 5) / (depth + 2));
      for (let x = 0; x < w; x++) if (Math.abs(x + 0.5 - w / 2) <= half) isle.set(x, y, y % 4 === 0 ? D : G);
    }
    for (let x = 4; x < w - 4; x += 7) isle.set(x, 6 + (x % 3), D);
    isle.edge(D);
    for (const sx of [cx - w / 2, cx - w / 2 - PERIOD]) t.blit(isle, Math.round(sx), top);
  }
  return t;
}

export function backdropFor(theme: LevelTheme): Backdrop {
  switch (theme) {
    case 'grotte':
      return {
        sky: K,
        bands: [],
        layers: [
          { bitmap: caveWall(180, 11), factor: 0.2, anchor: 'bottom', drift: 0, fill: K },
          { bitmap: stalactites(70, 5), factor: 0.45, anchor: 'top', drift: 0, fill: null },
          { bitmap: floorRocks(46, 9), factor: 0.65, anchor: 'bottom', drift: 0, fill: D },
        ],
      };
    case 'ciel':
      return {
        sky: BL,
        bands: [
          { from: 0.42, color: CY, dither: true },
          { from: 0.5, color: CY },
        ],
        layers: [
          { bitmap: placeClouds(4, 150, 160, 21, 56, 24), factor: 0.12, anchor: 'sky', drift: 3, fill: null },
          { bitmap: islands(120, 3), factor: 0.3, anchor: 'bottom', drift: 0, fill: null },
          { bitmap: placeClouds(5, 90, 100, 8, 42, 18), factor: 0.55, anchor: 'bottom', drift: 6, fill: null },
        ],
      };
    default:
      return {
        sky: CY,
        bands: [],
        layers: [
          { bitmap: placeClouds(4, 120, 130, 4), factor: 0.1, anchor: 'sky', drift: 4, fill: null },
          {
            bitmap: hills(
              110,
              64,
              18,
              [
                [1, 1],
                [3, 0.45],
              ],
              BL,
              null,
              17,
            ),
            factor: 0.25,
            anchor: 'bottom',
            drift: 0,
            fill: BL,
          },
          {
            bitmap: hills(
              80,
              38,
              12,
              [
                [2, 1],
                [5, 0.35],
              ],
              DG,
              GR,
              29,
            ),
            factor: 0.45,
            anchor: 'bottom',
            drift: 0,
            fill: DG,
          },
          { bitmap: bushes(36, 6), factor: 0.7, anchor: 'bottom', drift: 0, fill: DG },
        ],
      };
  }
}

/** Soleil de la prairie, collé à l'écran. */
export function sun(): Pix {
  const t = new Pix(30, 30);
  t.ellipse(15, 15, 11, 11, O).ellipse(15, 15, 9, 9, Y).ellipse(12, 12, 4, 4, W);
  t.edge(K);
  return t;
}

/** Tous les bitmaps du jeu, pour les tests de palette. */
export function allArt(): { name: string; bitmap: PixelBitmap }[] {
  const out: { name: string; bitmap: PixelBitmap }[] = [];
  const themes: LevelTheme[] = ['prairie', 'grotte', 'ciel'];
  for (const th of themes) {
    for (const v of [0, 1] as const) {
      out.push({ name: `${th}-fill-${v}`, bitmap: groundFill(th, v) });
      out.push({ name: `${th}-top-${v}`, bitmap: groundTop(th, v) });
    }
    backdropFor(th).layers.forEach((l, i) => out.push({ name: `${th}-fond-${i}`, bitmap: l.bitmap }));
  }
  out.push({ name: 'brique', bitmap: brick() });
  out.push({ name: 'bonus', bitmap: bonusBlock(false) });
  out.push({ name: 'bonus-use', bitmap: bonusBlock(true) });
  out.push({ name: 'planche', bitmap: oneWay() });
  out.push({ name: 'pointes', bitmap: spikes() });
  out.push({ name: 'ressort-0', bitmap: spring(false) });
  out.push({ name: 'ressort-1', bitmap: spring(true) });
  out.push({ name: 'controle-0', bitmap: checkpoint(false) });
  out.push({ name: 'controle-1', bitmap: checkpoint(true) });
  for (const top of [false, true])
    for (const w of [0, 1] as const) out.push({ name: `fanion-${top}-${w}`, bitmap: finishPole(top, w) });
  for (const f of [0, 1, 2, 3] as const) out.push({ name: `piece-${f}`, bitmap: coin(f) });
  out.push({ name: 'piece-fantome', bitmap: coinGhost() });
  out.push({ name: 'slime-0', bitmap: slime(0) });
  out.push({ name: 'slime-1', bitmap: slime(1) });
  out.push({ name: 'soleil', bitmap: sun() });
  out.push({ name: 'etincelle', bitmap: sparkle() });
  return out;
}
