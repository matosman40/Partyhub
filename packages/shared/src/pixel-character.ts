import { CHARACTER_ACCESSORIES, CHARACTER_HAIR_STYLES, type CharacterSpec } from './characters.js';

/**
 * Rendeur pixel d’un personnage : pur, déterministe, sans DOM ni IA. À partir d’un `CharacterSpec` (listes fermées),
 * il dessine en code, sur une grille de 32 × 32, des visages, des cycles de marche et des poses. Toutes les couleurs
 * viennent d’une palette de 16 teintes ; le contour noir fait un pixel ; l’ombrage est un aplat en bas à droite.
 *
 * Chaque morceau (jambe, buste, bras, tête) est dessiné dans sa propre couche, puis posé avec son contour : on obtient
 * ainsi un trait noir autour de chaque membre sans dessiner un seul contour à la main.
 */

/** Palette : contour, blanc, gris clair, gris foncé, trois teints, deux bruns, puis les couleurs vives. */
export const PIXEL_PALETTE: readonly string[] = [
  '#101010',
  '#FFFFFF',
  '#9A9AA8',
  '#4A4A5A',
  '#F6D7B5',
  '#C58A5A',
  '#7A4A2A',
  '#3B2314',
  '#D62828',
  '#FF8C1A',
  '#FFD23F',
  '#3DBE5A',
  '#1E6B3A',
  '#3A86FF',
  '#7B2FBE',
  '#7FE0FF',
];
export const PIXEL_TRANSPARENT = 255;
/** Côté d’un sprite source, en pixels. */
export const PIXEL_CELL = 32;

export interface PixelBitmap {
  width: number;
  height: number;
  /** Indices de palette, ligne par ligne ; 255 = transparent. */
  pixels: Uint8Array;
}

export const PIXEL_FACES = [
  'neutre',
  'content',
  'tres-joyeux',
  'fache',
  'en-colere',
  'triste',
  'surpris',
  'clin',
] as const;
export const PIXEL_POSES = ['repos', 'coucou', 'joie', 'colere', 'triste', 'victoire', 'defaite', 'fache'] as const;
export type PixelFace = (typeof PIXEL_FACES)[number];
export type PixelPose = (typeof PIXEL_POSES)[number];
/** `side` regarde vers la droite ; `mirrorBitmap` donne la gauche. */
export type PixelDir = 'front' | 'back' | 'side';

// Indices de palette.
const K = 0;
const W = 1;
const G1 = 2;
const G2 = 3;
const SKIN = 4;
const TAN = 5;
const BROWN = 6;
const DARK = 7;
const RED = 8;
const ORANGE = 9;
const YELLOW = 10;
const GREEN = 11;
const DGREEN = 12;
const BLUE = 13;
const PURPLE = 14;
const CYAN = 15;

/** Monture des lunettes : gris foncé, pour ne pas se fondre avec les paupières noires. */
const GLASSES = G2;

const N = PIXEL_CELL;
const T = PIXEL_TRANSPARENT;

// ---------------------------------------------------------------------------
// Couches
// ---------------------------------------------------------------------------

const GLYPH: Record<string, number> = { '0': K, '1': W, '8': RED, y: YELLOW, g: GREEN };

class Layer {
  readonly p = new Uint8Array(N * N).fill(T);

  set(x: number, y: number, c: number): void {
    if (x >= 0 && y >= 0 && x < N && y < N) this.p[y * N + x] = c;
  }

  get(x: number, y: number): number {
    return x >= 0 && y >= 0 && x < N && y < N ? this.p[y * N + x]! : T;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /** Pose un petit motif : « . » laisse la case telle quelle. */
  stamp(x: number, y: number, rows: readonly string[], legend: Record<string, number> = GLYPH): void {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const c = legend[row[dx]!];
        if (c !== undefined) this.set(x + dx, y + dy, c);
      }
    });
  }
}

/** Image finale : chaque couche ajoutée est entourée d’un contour noir d’un pixel. */
class Scene extends Layer {
  add(layer: Layer): void {
    const m = layer.p;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (m[y * N + x] === T) continue;
        if (x > 0 && m[y * N + x - 1] === T) this.p[y * N + x - 1] = K;
        if (x < N - 1 && m[y * N + x + 1] === T) this.p[y * N + x + 1] = K;
        if (y > 0 && m[(y - 1) * N + x] === T) this.p[(y - 1) * N + x] = K;
        if (y < N - 1 && m[(y + 1) * N + x] === T) this.p[(y + 1) * N + x] = K;
      }
    }
    for (let i = 0; i < m.length; i++) if (m[i] !== T) this.p[i] = m[i]!;
  }

  bitmap(): PixelBitmap {
    return { width: N, height: N, pixels: this.p.slice() };
  }
}

function line(a: readonly [number, number], b: readonly [number, number]): [number, number][] {
  const out: [number, number][] = [];
  let [x, y] = a;
  const dx = Math.abs(b[0] - x);
  const dy = -Math.abs(b[1] - y);
  const sx = x < b[0] ? 1 : -1;
  const sy = y < b[1] ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === b[0] && y === b[1]) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Du CharacterSpec à la palette
// ---------------------------------------------------------------------------

/** Teint : [couleur, ombre], ramené à la teinte de la palette la plus proche. */
const SKIN_MAP: readonly (readonly [number, number])[] = [
  [SKIN, TAN],
  [SKIN, TAN],
  [TAN, BROWN],
  [TAN, BROWN],
  [BROWN, DARK],
];
/** Cheveux : noir, brun, roux, rose (le rouge, faute de rose), violet-bleu, blond (le jaune, pour ne pas se confondre avec la peau). */
const HAIR_MAP: readonly (readonly [number, number])[] = [
  [DARK, K],
  [BROWN, DARK],
  [ORANGE, RED],
  [RED, PURPLE],
  [PURPLE, G2],
  [YELLOW, ORANGE],
];
const BROW_MAP: Record<number, number> = {
  [DARK]: K,
  [BROWN]: DARK,
  [ORANGE]: BROWN,
  [RED]: DARK,
  [PURPLE]: K,
  [YELLOW]: BROWN,
};
/** Vêtements : rouge, cyan, violet, jaune, vert, orange, bleu, blanc. */
const BODY_MAP: readonly (readonly [number, number])[] = [
  [RED, DARK],
  [CYAN, BLUE],
  [PURPLE, G2],
  [YELLOW, ORANGE],
  [GREEN, DGREEN],
  [ORANGE, RED],
  [BLUE, PURPLE],
  [W, G1],
];
/** Yeux : sombre, marron, bleu, vert. */
const EYE_MAP: readonly number[] = [K, BROWN, BLUE, GREEN];
const ACCENT_SHADE: Record<number, number> = {
  [RED]: DARK,
  [BLUE]: PURPLE,
  [PURPLE]: G2,
  [GREEN]: DGREEN,
  [CYAN]: BLUE,
  [YELLOW]: ORANGE,
};

interface Look {
  skin: number;
  skinShade: number;
  hair: number;
  hairShade: number;
  hairStyle: string;
  brow: number;
  body: number;
  bodyShade: number;
  pants: number;
  pantsShade: number;
  eye: number;
  accessory: string;
  facialHair: number;
  accent: number;
  accentShade: number;
  accent2: number;
}

/** Des yeux marron sur une peau brune se perdraient : ils passent au brun très foncé. */
function eyeOn(eye: number, skin: number): number {
  return eye === skin ? DARK : eye;
}

function lookOf(spec: CharacterSpec): Look {
  const skin = SKIN_MAP[spec.skin] ?? SKIN_MAP[0]!;
  const hair = HAIR_MAP[spec.hairColor] ?? HAIR_MAP[0]!;
  const body = BODY_MAP[spec.body] ?? BODY_MAP[0]!;
  const accent = [RED, BLUE, PURPLE, GREEN, CYAN, YELLOW].find((c) => c !== body[0] && c !== hair[0]) ?? RED;
  const pants = body[0] === BLUE ? ([G2, K] as const) : ([BLUE, G2] as const);
  return {
    skin: skin[0],
    skinShade: skin[1],
    hair: hair[0],
    hairShade: hair[1],
    hairStyle: CHARACTER_HAIR_STYLES[spec.hair] ?? 'none',
    brow: BROW_MAP[hair[0]] ?? DARK,
    body: body[0],
    bodyShade: body[1],
    pants: pants[0],
    pantsShade: pants[1],
    eye: eyeOn(EYE_MAP[spec.eyeColor ?? 0] ?? K, skin[0]),
    accessory: CHARACTER_ACCESSORIES[spec.accessory] ?? 'none',
    facialHair: spec.facialHair ?? 0,
    accent,
    accentShade: ACCENT_SHADE[accent] ?? DARK,
    accent2: accent === YELLOW ? W : YELLOW,
  };
}

// ---------------------------------------------------------------------------
// La tête
// ---------------------------------------------------------------------------

interface Geo {
  x: number;
  y: number;
  w: number;
  h: number;
  big: boolean;
  ew: number;
  eh: number;
  lx: number;
  ey: number;
  browY: number;
  noseY: number;
  mouthY: number;
  mw: number;
  mx: number;
  fringe: number;
  sideB: number;
  sw: number;
}

/** Grande tête (portrait) ou petite tête (corps entier) : mêmes pièces, autres mesures. */
function geo(big: boolean, x: number, y: number): Geo {
  return big
    ? {
        x,
        y,
        w: 20,
        h: 20,
        big,
        ew: 3,
        eh: 4,
        lx: 4,
        ey: 8,
        browY: 6,
        noseY: 13,
        mouthY: 15,
        mw: 6,
        mx: 7,
        fringe: 2,
        sideB: 6,
        sw: 2,
      }
    : {
        x,
        y,
        w: 16,
        h: 13,
        big,
        ew: 2,
        eh: 3,
        lx: 3,
        ey: 5,
        browY: 3,
        noseY: 8,
        mouthY: 9,
        mw: 4,
        mx: 6,
        fringe: 1,
        sideB: 3,
        sw: 1,
      };
}

function inset(g: Geo, y: number): number {
  const d = Math.min(y, g.h - 1 - y);
  if (g.big) return d === 0 ? 2 : d === 1 ? 1 : 0;
  return d === 0 ? 1 : 0;
}

function drawSkin(L: Layer, g: Geo, lk: Look): void {
  for (let y = 0; y < g.h; y++) {
    const i = inset(g, y);
    for (let x = i; x < g.w - i; x++) {
      const shade = y === g.h - 1 || (g.big && y === g.h - 2 && x >= g.w / 2) || (y >= 2 && x >= g.w - i - g.sw);
      L.set(g.x + x, g.y + y, shade ? lk.skinShade : lk.skin);
    }
  }
}

function drawEars(L: Layer, g: Geo, lk: Look): void {
  const rows = g.big ? 3 : 2;
  for (let r = 0; r < rows; r++) {
    L.set(g.x - 1, g.y + g.ey + 1 + r, lk.skin);
    L.set(g.x + g.w, g.y + g.ey + 1 + r, lk.skinShade);
  }
}

// --- Cheveux ---------------------------------------------------------------

type HairView = 'front' | 'back' | 'side';

const SPIKES = [1, 2, 3, 2];

function hairTop(style: string, g: Geo, x: number): number {
  const d = Math.min(x, g.w - 1 - x);
  if (style === 'curly') {
    if (d <= -2) return 3;
    if (d === -1) return 1;
    if (d === 0) return 0;
    return -1 - (x % 4 < 2 ? 1 : 0);
  }
  if (d <= -1) return 2;
  if (d === 0) return 1;
  if (d === 1) return 0;
  if (style === 'spiky') return -1 - SPIKES[((x % 4) + 4) % 4]!;
  return -1;
}

function hairBottom(style: string, view: HairView, g: Geo, x: number): number {
  const F = g.fringe;
  if (view === 'front') {
    if (x < 2 || x >= g.w - 2) {
      if (style === 'bob') return g.h - 3;
      if (style === 'curly') return g.ey + g.eh + (x % 3 === 0 ? 1 : 0);
      return g.sideB;
    }
    if (style === 'bob') return F + 1;
    if (style === 'spiky') return F + (x % 3 === 0 ? 1 : 0);
    if (style === 'curly') return F + (x % 3 === 1 ? 1 : 0);
    return x < g.w * 0.55 ? F + 1 : F;
  }
  const back = view === 'back' || x < g.w * 0.4;
  if (back) {
    const d = Math.min(x, g.w - 1 - x);
    const round = d <= 0 ? 2 : d === 1 ? 1 : 0;
    if (style === 'bob') return g.h - 2 - round;
    if (style === 'curly') return g.h - 3 - round + (x % 3 === 0 ? 1 : 0);
    return g.h - 4 - round;
  }
  if (style === 'bob') return F + 1;
  if (style === 'spiky') return F + (x % 3 === 0 ? 1 : 0);
  if (style === 'curly') return F + (x % 3 === 1 ? 1 : 0);
  return F;
}

function drawHair(L: Layer, g: Geo, lk: Look, view: HairView): void {
  const style = lk.hairStyle;
  if (style === 'none') return;
  const ext = style === 'curly' ? 2 : style === 'bob' ? 1 : 0;
  const to = view === 'side' ? g.w - 1 : g.w - 1 + ext;
  for (let x = -ext; x <= to; x++) {
    const top = hairTop(style, g, x);
    const bottom = hairBottom(style, view, g, x);
    for (let y = top; y <= bottom; y++) {
      const shade = x >= to - (g.big ? 1 : 0) || (y === bottom && x >= g.w / 2);
      L.set(g.x + x, g.y + y, shade ? lk.hairShade : lk.hair);
    }
  }
}

/** Chignon : posé sur la tête, ou au-dessus d’une casquette ; un chapeau ou une couronne le cachent. */
function drawBun(L: Layer, g: Geo, lk: Look, view: HairView): void {
  if (lk.hairStyle !== 'bun' || lk.accessory === 'party' || lk.accessory === 'crown') return;
  const capped = lk.accessory === 'cap';
  const full = g.big ? ['.hhhh.', 'hhhhhh', 'hhhhhS', '.hhSS.'] : ['.hh.', 'hhhh', 'hhhS'];
  const rows = capped && g.big ? full.slice(1) : full;
  const left = (view === 'side' ? Math.round(g.w * 0.3) : Math.floor(g.w / 2)) - Math.floor(rows[0]!.length / 2);
  const top = -rows.length - (capped ? 1 : 0);
  L.stamp(g.x + left, g.y + top, rows, { h: lk.hair, S: lk.hairShade });
}

// --- Accessoires -------------------------------------------------------------

function drawAccessory(L: Layer, g: Geo, lk: Look, view: HairView): void {
  const { x, y, w, h } = g;
  const acc = lk.accessory;
  const legend = { a: lk.accent, s: lk.accentShade, b: lk.accent2, k: K };
  const cx = view === 'side' ? Math.round(w * 0.45) : Math.floor(w / 2);
  if (acc === 'party') {
    const widths = [8, 6, 4, 2];
    widths.forEach((cw, i) => {
      const left = x + cx - Math.floor(cw / 2) + (view === 'side' ? 0 : 0);
      L.rect(left, y - 1 - i, cw, 1, i % 2 === 0 ? lk.accent : lk.accent2);
      L.set(left + cw - 1, y - 1 - i, i % 2 === 0 ? lk.accentShade : lk.accent2);
    });
  } else if (acc === 'crown') {
    const x0 = x + 3;
    const x1 = x + w - 4;
    L.rect(x0, y - 1, x1 - x0 + 1, 1, YELLOW);
    L.rect(x0, y, x1 - x0 + 1, 1, ORANGE);
    for (const px of [x0, x + cx - 1, x1 - 1]) {
      L.rect(px, y - 3, 2, 2, YELLOW);
      L.set(px + 1, y - 2, ORANGE);
    }
    L.set(x + cx - 1, y - 1, RED);
    L.set(x + cx, y - 1, RED);
  } else if (acc === 'cap') {
    const dome = (row: number, from: number, to: number, shade = false) =>
      L.rect(x + from, y + row, to - from + 1, 1, shade ? lk.accentShade : lk.accent);
    dome(-2, 4, w - 5);
    dome(-1, 2, w - 3);
    dome(0, 0, w - 1);
    dome(1, 0, w - 1, true);
    if (lk.hairStyle !== 'bun') L.set(x + cx, y - 3, lk.accent2);
    if (view === 'front') {
      L.rect(x + 1, y + 2, w - 2, 1, lk.accentShade);
      if (g.big) L.rect(x + 4, y + 3, w - 8, 1, lk.accentShade);
    } else if (view === 'side') {
      L.rect(x + w - (g.big ? 6 : 5), y + 2, g.big ? 10 : 8, 1, lk.accentShade);
    }
    for (let dx = 0; dx < w; dx++) if (dx >= w - 3) L.set(x + dx, y - 1, lk.accentShade);
  } else if (acc === 'headphones') {
    L.rect(x + 1, y - 2, w - 2, 1, G2);
    L.set(x, y - 1, G2);
    L.set(x + w - 1, y - 1, G2);
    const cupH = g.big ? 4 : 3;
    const rows = Math.max(0, g.ey + 1 - 0);
    if (view === 'side') {
      const ex = Math.round(w * 0.3);
      L.rect(x + ex - 1, y + g.ey, 3, cupH + 1, lk.accent);
      L.rect(x + ex - 1, y + g.ey + cupH, 3, 1, lk.accentShade);
      L.rect(x + 1, y - 2, w - 2, 1, G2);
      L.set(x + ex + 1, y - 1, G2);
    } else {
      for (let r = -1; r < rows; r++) {
        L.set(x - 1, y + r, G2);
        L.set(x + w, y + r, G2);
      }
      L.rect(x - 2, y + g.ey + 1, 2, cupH, lk.accent);
      L.rect(x + w, y + g.ey + 1, 2, cupH, lk.accent);
      L.rect(x - 2, y + g.ey + cupH, 2, 1, lk.accentShade);
      L.rect(x + w, y + g.ey + cupH, 2, 1, lk.accentShade);
    }
  } else if (acc === 'bow') {
    const rows = g.big ? ['aa...aa', 'aaabaaa', 'aaabaaa', 'ss...ss'] : ['aa.aa', 'aabaa', 'ss.ss'];
    const bx = view === 'side' ? x + 1 : x + w - rows[0]!.length - 1;
    L.stamp(bx, y - rows.length + 1, rows, legend);
  } else if (acc === 'flower') {
    const rows = ['.a.', 'aba', '.a.'];
    const fx = view === 'side' ? x + Math.round(w * 0.35) : x + 3;
    L.stamp(fx, y - 2, rows, legend);
    L.set(fx + 3, y, GREEN);
    L.set(fx + 3, y + 1, DGREEN);
  }
  void h;
}

// --- Visage ---------------------------------------------------------------------

const EYES: Record<PixelFace, string | readonly [string, string]> = {
  neutre: 'open',
  content: 'open',
  'tres-joyeux': 'arc',
  fache: 'open',
  'en-colere': 'narrow',
  triste: 'sad',
  surpris: 'wide',
  clin: ['open', 'arc'],
};

interface BrowKind {
  shape: 'flat' | 'angry' | 'crush' | 'sad' | 'arc' | 'raised';
  base: number;
  thick?: boolean;
}

const BROWS: Record<PixelFace, BrowKind> = {
  neutre: { shape: 'flat', base: 0 },
  content: { shape: 'arc', base: 0 },
  'tres-joyeux': { shape: 'arc', base: -1 },
  fache: { shape: 'angry', base: 0 },
  'en-colere': { shape: 'crush', base: 0, thick: true },
  triste: { shape: 'sad', base: 0 },
  surpris: { shape: 'raised', base: -1 },
  clin: { shape: 'arc', base: 0 },
};

function browDy(shape: BrowKind['shape'], t: number): number {
  switch (shape) {
    case 'flat':
      return 0;
    case 'angry':
      return Math.round(t * 2);
    case 'crush':
      return 1 + Math.round(t * 2);
    case 'sad':
      return 1 - Math.round(t * 2);
    case 'arc':
      return t > 0.2 && t < 0.8 ? -1 : 0;
    case 'raised':
      return t > 0.2 && t < 0.8 ? -1 : 0;
  }
}

const MOUTH_BIG: Record<PixelFace, readonly string[]> = {
  neutre: ['......', '.0000.'],
  content: ['0....0', '.0000.'],
  'tres-joyeux': ['000000', '011110', '.0880.', '..00..'],
  fache: ['......', '000000'],
  'en-colere': ['000000', '088880', '088880', '.0000.'],
  triste: ['......', '.0000.', '0....0'],
  surpris: ['..00..', '.0880.', '.0880.', '..00..'],
  clin: ['.....0', '.0000.'],
};

const MOUTH_SMALL: Record<PixelFace, readonly string[]> = {
  neutre: ['....', '.00.'],
  content: ['0..0', '.00.'],
  'tres-joyeux': ['0000', '0880', '.00.'],
  fache: ['....', '0000'],
  'en-colere': ['0000', '0880', '0000'],
  triste: ['.00.', '0..0'],
  surpris: ['.00.', '0880', '.00.'],
  clin: ['...0', '.00.'],
};

function drawEye(L: Layer, g: Geo, lk: Look, kind: string, right: boolean): void {
  const X = g.x + (right ? g.w - g.lx - g.ew : g.lx);
  const Y = g.y + g.ey;
  const { ew, eh } = g;
  const col = lk.eye;
  switch (kind) {
    case 'open':
      L.rect(X, Y, ew, 1, K);
      L.rect(X, Y + 1, ew, eh - 1, col);
      L.set(X, Y + 1, W);
      break;
    case 'narrow':
      L.rect(X, Y + 1, ew, 1, K);
      L.rect(X, Y + 2, ew, eh - 2, col);
      break;
    case 'sad':
      L.rect(X, Y + 1, ew, 1, K);
      L.rect(X, Y + 2, ew, eh - 1, col);
      L.set(X + ew - 1, Y + eh, W);
      break;
    case 'wide': {
      const legend = { '0': K, '1': W, c: col };
      if (g.big) L.stamp(X - 1, Y - 1, ['.000.', '01110', '01c10', '01110', '.000.'], legend);
      else L.stamp(X - 1, Y - 1, ['.00.', '01c0', '01c0', '.00.'], legend);
      break;
    }
    case 'arc':
      if (g.big) L.stamp(X, Y + 1, ['.0.', '0.0'], GLYPH);
      else L.stamp(X, Y + 1, right ? ['0.', '.0'] : ['.0', '0.'], GLYPH);
      break;
  }
}

function drawBrows(L: Layer, g: Geo, lk: Look, face: PixelFace): void {
  const kind = BROWS[face];
  const n = g.ew + 2;
  const minRow = g.fringe + 2;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      let dy = browDy(kind.shape, t) + kind.base;
      if (face === 'clin' && side === 1) dy -= 1;
      const col = g.lx - 1 + i;
      const x = side === 0 ? col : g.w - 1 - col;
      const row = Math.max(minRow, g.browY + dy);
      L.set(g.x + x, g.y + row, lk.brow);
      if (kind.thick) L.set(g.x + x, g.y + row + 1, lk.brow);
    }
  }
}

function drawGlasses(L: Layer, g: Geo): void {
  const x0 = g.lx - 1;
  const x1 = g.lx + g.ew;
  const y0 = g.ey - 1;
  const y1 = g.ey + g.eh;
  for (let side = 0; side < 2; side++) {
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (yy !== y0 && yy !== y1 && xx !== x0 && xx !== x1) continue;
        L.set(g.x + (side === 0 ? xx : g.w - 1 - xx), g.y + yy, GLASSES);
      }
    }
  }
  for (let xx = x1 + 1; xx <= g.w - 1 - (x1 + 1); xx++) L.set(g.x + xx, g.y + g.ey + 1, GLASSES);
}

function drawFacialHair(L: Layer, g: Geo, lk: Look): void {
  const c = lk.hair === YELLOW || lk.hairStyle === 'none' ? (lk.hairStyle === 'none' ? DARK : lk.hair) : lk.hair;
  const s = lk.hairStyle === 'none' ? K : lk.hairShade;
  if (lk.facialHair === 1) {
    const y = g.noseY + 1;
    const from = g.mx - (g.big ? 2 : 1);
    const to = g.mx + g.mw + (g.big ? 1 : 0);
    L.rect(g.x + from, g.y + y, to - from + 1, 1, c);
    if (g.big) {
      L.set(g.x + from, g.y + y + 1, c);
      L.set(g.x + to, g.y + y + 1, s);
    }
  } else if (lk.facialHair === 2) {
    // Barbe : favoris sur les côtés, puis tout le bas du visage (le menton seul sur la petite tête, qui garde sa bouche).
    const solidFrom = g.noseY + (g.big ? 1 : 3);
    const side = g.big ? 2 : 1;
    for (let y = g.ey + 2; y < g.h; y++) {
      const solid = y >= solidFrom;
      const i = solid ? inset(g, y) : 0;
      for (let x = i; x < g.w - i; x++) {
        if (!solid && x >= side && x < g.w - side) continue;
        const shade = y === g.h - 1 || x >= g.w - i - side;
        L.set(g.x + x, g.y + y, shade ? s : c);
      }
    }
  }
}

function drawFrontFace(L: Layer, g: Geo, lk: Look, face: PixelFace): void {
  drawFacialHair(L, g, lk);
  // nez
  const nx = g.w / 2 - 1;
  L.set(g.x + nx, g.y + g.noseY, lk.skinShade);
  L.set(g.x + nx + 1, g.y + g.noseY, lk.skinShade);
  // joues
  if (face === 'content' || face === 'tres-joyeux' || face === 'clin') {
    for (let i = 0; i < (g.big ? 2 : 1); i++) {
      L.set(g.x + g.lx - 1 + i, g.y + g.noseY, RED);
      L.set(g.x + g.w - 1 - (g.lx - 1 + i), g.y + g.noseY, RED);
    }
  }
  // yeux
  const eyes = EYES[face];
  const kinds = typeof eyes === 'string' ? ([eyes, eyes] as const) : eyes;
  drawEye(L, g, lk, kinds[0], false);
  drawEye(L, g, lk, kinds[1], true);
  // larme
  if (face === 'triste') {
    if (g.big) {
      L.set(g.x + g.lx + 1, g.y + g.ey + g.eh + 1, CYAN);
      L.set(g.x + g.lx + 1, g.y + g.ey + g.eh + 2, BLUE);
    } else L.set(g.x + g.lx, g.y + g.ey + g.eh, CYAN);
  }
  // bouche
  L.stamp(g.x + g.mx, g.y + g.mouthY, (g.big ? MOUTH_BIG : MOUTH_SMALL)[face]);
}

function drawSideFace(L: Layer, g: Geo, lk: Look, face: PixelFace): void {
  const { x, y, w } = g;
  // barbe ou moustache
  if (lk.facialHair === 2) {
    for (let yy = g.noseY + 1; yy < g.h; yy++) {
      for (let xx = 6; xx < w - inset(g, yy); xx++) {
        const shade = yy === g.h - 1 || xx >= w - 2;
        L.set(
          x + xx,
          y + yy,
          shade ? (lk.hairStyle === 'none' ? K : lk.hairShade) : lk.hairStyle === 'none' ? DARK : lk.hair,
        );
      }
    }
  } else if (lk.facialHair === 1) {
    L.rect(x + w - 5, y + g.noseY + 1, 5, 1, lk.hairStyle === 'none' ? DARK : lk.hair);
  }
  L.set(x + w, y + g.noseY, lk.skin);
  L.set(x + w - 1, y + g.noseY, lk.skinShade);
  if (face === 'content' || face === 'tres-joyeux') L.set(x + w - 8, y + g.noseY, RED);
  const ex = x + w - 5;
  const ey = y + g.ey;
  L.rect(ex, ey, 2, 1, K);
  L.rect(ex, ey + 1, 2, g.eh - 1, lk.eye);
  L.set(ex, ey + 1, W);
  const brow = BROWS[face];
  const dy = brow.shape === 'angry' ? 1 : 0;
  L.rect(x + w - 6, y + Math.max(g.fringe + 2, g.browY - (brow.base < 0 ? 1 : 0)), 3, 1, lk.brow);
  L.set(x + w - 3, y + g.browY + dy, lk.brow);
  L.stamp(
    x + w - 6,
    y + g.mouthY,
    MOUTH_SMALL[face].map((r) => r.slice(0, 4)),
  );
}

function drawSideGlasses(L: Layer, g: Geo): void {
  const x0 = g.w - 6;
  for (let yy = g.ey - 1; yy <= g.ey + g.eh; yy++) {
    for (let xx = x0; xx <= x0 + 3; xx++) {
      if (yy !== g.ey - 1 && yy !== g.ey + g.eh && xx !== x0 && xx !== x0 + 3) continue;
      L.set(g.x + xx, g.y + yy, GLASSES);
    }
  }
}

/** Dessine la tête entière dans une couche : peau, oreilles, visage, lunettes, cheveux, accessoire. */
function headLayer(g: Geo, lk: Look, view: PixelDir, face: PixelFace): Layer {
  const L = new Layer();
  drawSkin(L, g, lk);
  if (view === 'side') {
    drawHair(L, g, lk, 'side');
    const earHidden = lk.hairStyle === 'bob' || lk.hairStyle === 'curly';
    if (!earHidden) {
      const ex = g.x + Math.round(g.w * 0.3);
      L.rect(ex, g.y + g.ey, 2, 3, lk.skin);
      L.rect(ex + 1, g.y + g.ey + 1, 1, 2, lk.skinShade);
    }
    drawSideFace(L, g, lk, face);
    if (lk.accessory === 'glasses') drawSideGlasses(L, g);
    drawAccessory(L, g, lk, 'side');
    drawBun(L, g, lk, 'side');
    return L;
  }
  drawEars(L, g, lk);
  if (view === 'front') {
    drawFrontFace(L, g, lk, face);
    if (lk.accessory === 'glasses') drawGlasses(L, g);
    drawBrows(L, g, lk, face);
  }
  drawHair(L, g, lk, view);
  drawAccessory(L, g, lk, view);
  drawBun(L, g, lk, view);
  return L;
}

// ---------------------------------------------------------------------------
// Visages (planche A)
// ---------------------------------------------------------------------------

export function drawFace(spec: CharacterSpec, face: PixelFace): PixelBitmap {
  const lk = lookOf(spec);
  const scene = new Scene();
  const g = geo(true, 6, 6);
  const bust = new Layer();
  bust.rect(14, 26, 3, 1, lk.skin);
  bust.set(17, 26, lk.skinShade);
  const rows = [
    [8, 23],
    [6, 25],
    [5, 26],
    [5, 26],
    [5, 26],
  ];
  rows.forEach(([a, b], i) => {
    for (let x = a!; x <= b!; x++) bust.set(x, 27 + i, x >= 24 || i === 4 ? lk.bodyShade : lk.body);
  });
  bust.rect(15, 27, 2, 1, lk.skin);
  scene.add(bust);
  scene.add(headLayer(g, lk, 'front', face));
  return scene.bitmap();
}

// ---------------------------------------------------------------------------
// Corps entier : marche et poses
// ---------------------------------------------------------------------------

interface ArmRig {
  /** Points du bras, depuis l’épaule, à plat : x, y, x, y… (x vers l’extérieur ou l’avant, y vers le bas). */
  pts: readonly number[];
  sleeve?: number;
  hand?: 'fist' | 'open';
}

interface LegRig {
  /** Décalage du pied en profil (positif : vers l’avant). */
  shift: number;
  /** Pied arrière décollé d’un pixel (talon levé) ; l’autre reste à la ligne de sol. */
  lift: number;
}

interface Rig {
  view: PixelDir;
  face: PixelFace;
  /** Genoux pliés : le buste descend de ce nombre de pixels (0 à 2). */
  drop: number;
  /** Tête baissée. */
  headDy: number;
  /** Écartement des pieds. */
  spread: number;
  /** Front/dos : bras de gauche et de droite de l’écran. Profil : bras lointain et bras proche. */
  armL: ArmRig;
  armR: ArmRig;
  legL: LegRig;
  legR: LegRig;
}

const REST: ArmRig = {
  pts: [0, 0, 0, 4],
  sleeve: 2,
  hand: 'fist',
};
const swing = (n: number): ArmRig => ({
  pts: [0, 0, 0, n],
  sleeve: 2,
  hand: 'fist',
});
const FLAT: LegRig = { shift: 0, lift: 0 };

type Tone = 'near' | 'far';

function armLayer(lk: Look, sx: number, sy: number, dir: 1 | -1, arm: ArmRig, tone: Tone): Layer {
  const L = new Layer();
  const far = tone === 'far';
  const sleeve = far ? lk.bodyShade : lk.body;
  const sleeveShade = far ? lk.bodyShade : lk.bodyShade;
  const hand = far ? lk.skinShade : lk.skin;
  const handShade = far ? lk.skinShade : lk.skinShade;
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < arm.pts.length; i += 2) pts.push([sx + dir * arm.pts[i]!, sy + arm.pts[i + 1]!]);
  const path: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = line(pts[i]!, pts[i + 1]!);
    if (i > 0) seg.shift();
    path.push(...seg);
  }
  if (path.length === 0 && pts[0]) path.push(pts[0]);
  const n = arm.sleeve ?? 3;
  path.forEach(([x, y], i) => L.rect(x, y, 2, 2, i < n ? sleeve : hand));
  path.forEach(([x, y], i) => {
    const c = i < n ? sleeveShade : handShade;
    L.set(x + 1, y + 1, c);
  });
  const end = path[path.length - 1]!;
  if (arm.hand === 'open') {
    L.rect(end[0] - 1, end[1] - 1, 4, 3, hand);
    L.rect(end[0] + 2, end[1] - 1, 1, 3, handShade);
  } else {
    L.rect(end[0] - 1, end[1], 4, 2, hand);
    L.rect(end[0] + 2, end[1], 1, 2, handShade);
  }
  return L;
}

function legLayer(lk: Look, rig: Rig, side: 'L' | 'R', tone: Tone): Layer {
  const L = new Layer();
  const far = tone === 'far';
  const pants = far ? lk.pantsShade : lk.pants;
  const pantsShade = lk.pantsShade;
  const shoe = far ? G1 : W;
  const shoeShade = far ? G2 : G1;
  const leg = side === 'L' ? rig.legL : rig.legR;
  const k = rig.drop > 0 ? 1 : 0;
  if (rig.view === 'side') {
    const s = leg.shift;
    const lift = leg.lift;
    const rows = lift
      ? [[26, Math.round(s / 2)]]
      : [
          [26, Math.round(s / 3)],
          [27, Math.round((2 * s) / 3)],
        ];
    for (const [r, off] of rows as [number, number][]) {
      if (r! < 26 + rig.drop) continue;
      L.rect(14 + off!, r!, 3, 1, pants);
      L.set(16 + off!, r!, pantsShade);
    }
    const sy = 28 - lift;
    L.rect(13 + s, sy, 6, 2, shoe);
    L.rect(13 + s, sy + 1, 6, 1, shoeShade);
    return L;
  }
  const sp = k + rig.spread;
  const lift = leg.lift;
  const mir = (x: number, w: number) => (side === 'L' ? x : N - x - w);
  const shift = Math.round(sp / 2);
  for (let r = 26 + rig.drop; r <= 27 - lift; r++) {
    L.rect(mir(12 - shift, 3), r, 3, 1, pants);
    L.set(mir(12 - shift, 3) + (side === 'L' ? 2 : 0), r, pantsShade);
  }
  const sx = mir(10 - sp, 5);
  L.rect(sx, 28 - lift, 5, 2, shoe);
  L.rect(sx, 29 - lift, 5, 1, shoeShade);
  return L;
}

function torsoLayer(lk: Look, rig: Rig): Layer {
  const L = new Layer();
  const t0 = 20 + rig.drop;
  const t1 = 25 + rig.drop;
  const x0 = rig.view === 'side' ? 11 : 10;
  const x1 = rig.view === 'side' ? 20 : 21;
  for (let y = t0; y <= t1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (y === t0 && (x === x0 || x === x1) && rig.view !== 'side') continue;
      L.set(x, y, x === x1 || y === t1 ? lk.bodyShade : lk.body);
    }
  }
  if (rig.view === 'front') {
    L.set(15, t0, lk.skin);
    L.set(16, t0, lk.skin);
  }
  return L;
}

function drawFigure(spec: CharacterSpec, rig: Rig): PixelBitmap {
  const lk = lookOf(spec);
  const scene = new Scene();
  const t0 = 20 + rig.drop;
  const side = rig.view === 'side';
  if (side) {
    scene.add(armLayer(lk, 14, t0, 1, rig.armL, 'far'));
    scene.add(legLayer(lk, rig, 'L', 'far'));
    scene.add(torsoLayer(lk, rig));
    scene.add(legLayer(lk, rig, 'R', 'near'));
    scene.add(armLayer(lk, 14, t0, 1, rig.armR, 'near'));
  } else {
    scene.add(legLayer(lk, rig, 'L', 'near'));
    scene.add(legLayer(lk, rig, 'R', 'near'));
    scene.add(torsoLayer(lk, rig));
    scene.add(armLayer(lk, 8, t0, -1, rig.armL, 'near'));
    scene.add(armLayer(lk, 22, t0, 1, rig.armR, 'near'));
  }
  const g = geo(false, 8, 7 + rig.drop + rig.headDy);
  scene.add(headLayer(g, lk, rig.view, rig.face));
  return scene.bitmap();
}

function baseRig(view: PixelDir, face: PixelFace): Rig {
  return { view, face, drop: 0, headDy: 0, spread: 0, armL: REST, armR: REST, legL: FLAT, legR: FLAT };
}

export function drawWalk(spec: CharacterSpec, dir: PixelDir, frame: 0 | 1 | 2 | 3): PixelBitmap {
  const rig = baseRig(dir, 'content');
  if (frame === 1 || frame === 3) {
    // 1 : pied gauche avant et bras droit avant ; 3 : l’inverse. À l’écran, de face, la gauche du personnage est à droite.
    const leftFoot = frame === 1;
    if (dir === 'side') {
      // armL/legL : côté lointain (gauche du personnage) ; armR/legR : côté proche (droit).
      const fwd: ArmRig = {
        pts: [0, 0, 3, 4],
        sleeve: 2,
        hand: 'fist',
      };
      const back: ArmRig = {
        pts: [0, 0, -3, 4],
        sleeve: 2,
        hand: 'fist',
      };
      rig.legL = leftFoot ? { shift: 3, lift: 0 } : { shift: -3, lift: 1 };
      rig.legR = leftFoot ? { shift: -3, lift: 1 } : { shift: 3, lift: 0 };
      rig.armL = leftFoot ? back : fwd;
      rig.armR = leftFoot ? fwd : back;
    } else {
      // Écran : gauche/droite de l’image. Face : gauche du personnage = droite de l’image ; dos : l’inverse.
      const charLeftIsImageRight = dir === 'front';
      const imgRightForward = leftFoot === charLeftIsImageRight;
      rig.legL = imgRightForward ? { shift: 0, lift: 1 } : FLAT;
      rig.legR = imgRightForward ? FLAT : { shift: 0, lift: 1 };
      // Bras opposé au pied avant : bras avant du côté contraire de l’image.
      rig.armL = imgRightForward ? swing(5) : swing(3);
      rig.armR = imgRightForward ? swing(3) : swing(5);
    }
  }
  return drawFigure(spec, rig);
}

interface PoseDef {
  face: PixelFace;
  drop?: number;
  headDy?: number;
  spread?: number;
  armL: ArmRig;
  armR: ArmRig;
}

const POSES: Record<PixelPose, PoseDef> = {
  repos: { face: 'content', armL: REST, armR: REST },
  coucou: {
    face: 'content',
    armL: {
      pts: [0, 0, 3, -1, 5, -3],
      sleeve: 3,
      hand: 'open',
    },
    armR: REST,
  },
  joie: {
    face: 'tres-joyeux',
    drop: 1,
    armL: {
      pts: [0, 0, 2, -3, 4, -7],
      sleeve: 3,
      hand: 'open',
    },
    armR: {
      pts: [0, 0, 2, -3, 4, -7],
      sleeve: 3,
      hand: 'open',
    },
  },
  colere: {
    face: 'en-colere',
    headDy: 1,
    spread: 2,
    armL: {
      pts: [0, 0, 3, 2, 1, 5],
      sleeve: 3,
      hand: 'fist',
    },
    armR: {
      pts: [0, 0, 3, 2, 1, 5],
      sleeve: 3,
      hand: 'fist',
    },
  },
  triste: {
    face: 'triste',
    headDy: 1,
    armL: {
      pts: [0, 1, 0, 5],
      sleeve: 2,
      hand: 'fist',
    },
    armR: {
      pts: [0, 1, 0, 5],
      sleeve: 2,
      hand: 'fist',
    },
  },
  victoire: {
    face: 'tres-joyeux',
    drop: 1,
    armL: {
      pts: [0, 0, 2, -3, 2, -8],
      sleeve: 3,
      hand: 'fist',
    },
    armR: {
      pts: [0, 0, 2, -3, 2, -8],
      sleeve: 3,
      hand: 'fist',
    },
  },
  defaite: {
    face: 'triste',
    drop: 2,
    headDy: 1,
    armL: {
      pts: [0, 1, 0, 5],
      sleeve: 2,
      hand: 'fist',
    },
    armR: {
      pts: [0, 1, 0, 5],
      sleeve: 2,
      hand: 'fist',
    },
  },
  fache: {
    face: 'fache',
    armL: {
      pts: [0, 2, -7, 3],
      sleeve: 6,
      hand: 'fist',
    },
    armR: {
      pts: [0, 3, -7, 4],
      sleeve: 6,
      hand: 'fist',
    },
  },
};

export function drawPose(spec: CharacterSpec, pose: PixelPose): PixelBitmap {
  const def = POSES[pose];
  const rig = baseRig('front', def.face);
  rig.drop = def.drop ?? 0;
  rig.headDy = def.headDy ?? 0;
  rig.spread = def.spread ?? 0;
  rig.armL = def.armL;
  rig.armR = def.armR;
  return drawFigure(spec, rig);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function mirrorBitmap(b: PixelBitmap): PixelBitmap {
  const pixels = new Uint8Array(b.pixels.length);
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) pixels[y * b.width + x] = b.pixels[y * b.width + (b.width - 1 - x)]!;
  }
  return { width: b.width, height: b.height, pixels };
}

const RGB = PIXEL_PALETTE.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = m[1]!;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** Pixels RGBA agrandis d’un facteur entier. Fond `null` : transparent. */
export function bitmapToRgba(b: PixelBitmap, scale: number, background: string | null = null): Uint8ClampedArray {
  const s = Math.max(1, Math.round(scale));
  const w = b.width * s;
  const out = new Uint8ClampedArray(w * b.height * s * 4);
  const bg = background ? hexToRgb(background) : null;
  for (let y = 0; y < b.height * s; y++) {
    for (let x = 0; x < w; x++) {
      const idx = b.pixels[Math.floor(y / s) * b.width + Math.floor(x / s)]!;
      const rgb = idx === T ? null : RGB[idx];
      const o = (y * w + x) * 4;
      if (rgb) {
        out[o] = rgb[0]!;
        out[o + 1] = rgb[1]!;
        out[o + 2] = rgb[2]!;
        out[o + 3] = 255;
      } else if (bg) {
        out[o] = bg[0];
        out[o + 1] = bg[1];
        out[o + 2] = bg[2];
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

const SHEET_SCALE = 8;
const SHEET_BACKGROUND = '#FF00FF';

/** Planche complète, chaque case agrandie ×8, sur fond magenta : visages 4×2, marche 4×3, poses 4×2. */
export function renderSheet(
  spec: CharacterSpec,
  sheet: 'faces' | 'walk' | 'poses',
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const cell = PIXEL_CELL * SHEET_SCALE;
  let cells: PixelBitmap[][];
  if (sheet === 'faces') {
    cells = [0, 1].map((r) => PIXEL_FACES.slice(r * 4, r * 4 + 4).map((f) => drawFace(spec, f)));
  } else if (sheet === 'poses') {
    cells = [0, 1].map((r) => PIXEL_POSES.slice(r * 4, r * 4 + 4).map((p) => drawPose(spec, p)));
  } else {
    cells = (['front', 'back', 'side'] as const).map((dir) =>
      ([0, 1, 2, 3] as const).map((frame) => drawWalk(spec, dir, frame)),
    );
  }
  const width = cell * 4;
  const height = cell * cells.length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  cells.forEach((row, r) =>
    row.forEach((bitmap, c) => {
      const part = bitmapToRgba(bitmap, SHEET_SCALE, SHEET_BACKGROUND);
      for (let y = 0; y < cell; y++) {
        const from = y * cell * 4;
        rgba.set(part.subarray(from, from + cell * 4), ((r * cell + y) * width + c * cell) * 4);
      }
    }),
  );
  return { width, height, rgba };
}
