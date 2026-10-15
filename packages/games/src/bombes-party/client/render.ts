/**
 * Rendu du plateau sur canvas. Décors et sprites sont peints en code ; un joueur qui a choisi un
 * personnage importé est dessiné avec sa case (voir skins.ts).
 * Vue de dessus, comme les Bomberman d'origine. Une case vaut 16 « pixels logiques » :
 * chaque décor est peint une seule fois à cette taille, puis agrandi sans lissage, ce qui
 * garde les contours nets à toutes les tailles d'écran. Les personnages glissent d'une case
 * à l'autre au rythme du serveur et marchent pendant le déplacement.
 */

import { FRAMES, SPRITE_H, SPRITE_W, withFacing } from './sprites.js';
import { drawSkin, skinReady, type PackSkin } from './skins.js';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type PowerKind = 'bomb' | 'flame' | 'speed' | 'kangaroo' | 'dino';
export type Mount = 'kangaroo' | 'dino';

export interface BoardUnitView {
  playerId: string;
  name: string;
  color: number;
  x: number;
  y: number;
  alive: boolean;
  mount?: Mount | null;
  speed?: number;
  facing?: Dir;
}

/** Vue publique du plateau, telle que la reçoit le navigateur. */
export interface BoardView {
  phase?: string;
  width: number;
  height: number;
  grid: string[];
  units: BoardUnitView[];
  bombs: Array<{ id: string; x: number; y: number; color: number; endsAt: number }>;
  flames: Array<{ x: number; y: number }>;
  powerups: Array<{ x: number; y: number; kind: PowerKind }>;
  winnerName?: string | null;
}

/** Une case logique : 16 pixels, la résolution des décors d'origine. */
export const TILE_PX = 16;
/** Marge autour du plateau, en cases. */
const PAD_TILES = 0.25;

export interface Layout {
  /** Taille d'une case, en pixels CSS. */
  T: number;
  /** Hauteur d'une case au sol : identique à T, la vue est de dessus. */
  tileD: number;
  pad: number;
  width: number;
  height: number;
}

/** Calcule la taille des cases pour une largeur CSS donnée. */
export function layoutFor(cssWidth: number, cols: number, rows: number): Layout {
  const T = cssWidth / (cols + PAD_TILES * 2);
  const pad = PAD_TILES * T;
  return { T, tileD: T, pad, width: cssWidth, height: pad * 2 + rows * T };
}

/** Coin haut-gauche de la case (x, y). */
export function cellOrigin(L: Layout, x: number, y: number): { x: number; y: number } {
  return { x: L.pad + x * L.T, y: L.pad + y * L.T };
}

export const PLAYER_COLORS = ['#ff3d8b', '#3ff5e0', '#ffc83d', '#b59cff'];
export const INK = '#0c0a24';
const FACE = '#fdf0dc';
const BOOTS = '#2a2770';
const MOUNT_ICON: Record<Mount, string> = { kangaroo: '🦘', dino: '🦖' };
const POWER_BG: Record<PowerKind, string> = {
  bomb: '#ff4f8b',
  flame: '#ffd23f',
  speed: '#5eead4',
  kangaroo: '#ecebe3',
  dino: '#9be86b',
};

// Palette des décors. Le feu suit trois teintes, du bord vers le cœur.
const GRASS_A = '#4fa23f';
const GRASS_B = '#58ad47';
const BLADE_DARK = '#3a7d2f';
const BLADE_LIGHT = '#72c25b';
const STONE = '#8a93a8';
const STONE_HI = '#c9d0de';
const STONE_LO = '#4a5266';
const JOINT = '#666f85';
const SOFT = '#d89a4e';
const SOFT_HI = '#f4cc86';
const SOFT_LO = '#7a4418';
const SOFT_JOINT = '#b56d2d';
const FIRE = { edge: '#e5461b', body: '#ff9a1f', core: '#ffe066', hot: '#fff8dc' };

// ---------------------------------------------------------------------------
// Particules
// ---------------------------------------------------------------------------

export type ParticleKind = 'spark' | 'dust' | 'smoke' | 'ring' | 'confetti';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  rot: number;
  vr: number;
}

export function updateParticles(list: Particle[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]!;
    p.life -= dt;
    if (p.life <= 0) {
      list.splice(i, 1);
      continue;
    }
    const gravity = p.kind === 'spark' || p.kind === 'dust' ? 900 : p.kind === 'confetti' ? 260 : 0;
    const drag = p.kind === 'smoke' ? 0.9 : 0.92;
    p.vx *= Math.pow(drag, dt * 60);
    p.vy = p.vy * Math.pow(drag, dt * 60) + gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
}

export function burstParticles(
  list: Particle[],
  x: number,
  y: number,
  kind: ParticleKind,
  count: number,
  color: string,
  speed: number,
  size: number,
  life: number,
): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.4 + Math.random() * 0.8);
    list.push({
      kind,
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - (kind === 'smoke' ? 10 : 0),
      life: life * (0.6 + Math.random() * 0.6),
      max: life,
      color,
      size: size * (0.7 + Math.random() * 0.6),
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 10,
    });
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, list: Particle[]): void {
  for (const p of list) {
    const k = Math.max(0, p.life / p.max);
    ctx.save();
    ctx.globalAlpha = k;
    if (p.kind === 'spark') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'dust') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'smoke') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (2.2 - k * 1.2), 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * k + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - k) + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Pixels : chaque décor est peint une fois, puis mis en cache.
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

const images = new Map<string, HTMLCanvasElement>();

/** Image peinte une seule fois, puis réutilisée à chaque image d'animation. */
export function image(key: string, w: number, h: number, paint: (g: Ctx) => void): HTMLCanvasElement {
  const hit = images.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) paint(g);
  images.set(key, c);
  return c;
}

/** Valeur pseudo-aléatoire stable pour une case : même décor à chaque image. */
export function hash(a: number, b: number): number {
  let h = Math.imul(a + 0x9e3779b1, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
}

export function rect(g: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function disc(g: Ctx, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function grassImage(parity: number, variant: number): HTMLCanvasElement {
  return image(`grass:${parity}:${variant}`, TILE_PX, TILE_PX, (g) => {
    rect(g, 0, 0, TILE_PX, TILE_PX, parity ? GRASS_A : GRASS_B);
    // Touches d'herbe, placées de façon fixe pour chaque variante : pas de répétition visible.
    for (let i = 0; i < 7; i++) {
      const px = 1 + Math.floor(hash(variant * 31 + i, 1) * 13);
      const py = 1 + Math.floor(hash(variant * 17 + i, 2) * 13);
      rect(g, px, py, 2, 1, i % 2 ? BLADE_LIGHT : BLADE_DARK);
    }
  });
}

function stoneImage(): HTMLCanvasElement {
  return image('stone', TILE_PX, TILE_PX, (g) => {
    rect(g, 0, 0, 16, 16, STONE);
    // Biseau : clair en haut et à gauche, sombre en bas et à droite.
    rect(g, 0, 0, 16, 1, STONE_HI);
    rect(g, 0, 0, 1, 16, STONE_HI);
    rect(g, 0, 15, 16, 1, STONE_LO);
    rect(g, 15, 0, 1, 16, STONE_LO);
    // Joints en briques, deux rangées décalées.
    rect(g, 1, 8, 14, 1, JOINT);
    rect(g, 8, 1, 1, 7, JOINT);
    rect(g, 4, 9, 1, 6, JOINT);
    rect(g, 12, 9, 1, 6, JOINT);
    rect(g, 2, 2, 3, 1, STONE_HI);
    rect(g, 9, 10, 3, 1, STONE_HI);
  });
}

function softImage(): HTMLCanvasElement {
  return image('soft', TILE_PX, TILE_PX, (g) => {
    rect(g, 0, 0, 16, 16, SOFT_LO);
    rect(g, 1, 1, 14, 14, SOFT);
    rect(g, 1, 1, 14, 1, SOFT_HI);
    rect(g, 1, 1, 1, 14, SOFT_HI);
    // Planches et clous : une caisse, pour qu'on la distingue des blocs de pierre.
    rect(g, 5, 1, 1, 14, SOFT_JOINT);
    rect(g, 10, 1, 1, 14, SOFT_JOINT);
    rect(g, 1, 8, 14, 1, SOFT_JOINT);
    for (const [x, y] of [
      [3, 3],
      [12, 3],
      [3, 12],
      [12, 12],
    ] as const) {
      rect(g, x, y, 1, 1, SOFT_LO);
    }
  });
}

/** Un bras de flamme (ou le centre) : le sens dépend des cases voisines en feu. */
type FlameKind = 'center' | 'h' | 'v' | 'right' | 'left' | 'up' | 'down';

function flameKind(x: number, y: number, has: (x: number, y: number) => boolean): FlameKind {
  const l = has(x - 1, y);
  const r = has(x + 1, y);
  const u = has(x, y - 1);
  const d = has(x, y + 1);
  const n = Number(l) + Number(r) + Number(u) + Number(d);
  if (n === 0) return 'center';
  if (n === 1) return l ? 'right' : r ? 'left' : u ? 'down' : 'up';
  if (n === 2 && l && r) return 'h';
  if (n === 2 && u && d) return 'v';
  return 'center';
}

/** Une bande de feu, du bord vers le cœur. La frange du haut et du bas ondule d'une image à l'autre. */
function flameBar(g: Ctx, x0: number, x1: number, f: number): void {
  const top = f ? 3 : 4;
  const bot = f ? 13 : 12;
  const w = x1 - x0;
  rect(g, x0, top, w, bot - top, FIRE.edge);
  rect(g, x0, top + 1, w, bot - top - 2, FIRE.body);
  rect(g, x0, top + 2, w, bot - top - 4, FIRE.core);
  rect(g, x0, 7, w, 2, FIRE.hot);
}

/** Pointe arrondie au bout d'un bras. */
function flameTip(g: Ctx, cx: number, cy: number, r: number): void {
  disc(g, cx, cy, r, FIRE.edge);
  disc(g, cx - 0.8, cy, r * 0.7, FIRE.body);
  disc(g, cx - 1.6, cy, r * 0.4, FIRE.core);
}

function paintFlame(g: Ctx, kind: FlameKind, f: number): void {
  if (kind === 'center') {
    disc(g, 8, 8, 7 + f * 0.5, FIRE.edge);
    disc(g, 8, 8, 5.2 + f * 0.4, FIRE.body);
    disc(g, 8, 8, 3, FIRE.core);
    disc(g, 8, 8, 1.3, FIRE.hot);
    return;
  }
  // Le bras est peint vers la droite, puis tourné selon son sens.
  const angle =
    kind === 'h' || kind === 'right'
      ? 0
      : kind === 'v' || kind === 'down'
        ? Math.PI / 2
        : kind === 'left'
          ? Math.PI
          : (Math.PI * 3) / 2;
  g.save();
  g.translate(8, 8);
  g.rotate(angle);
  g.translate(-8, -8);
  if (kind === 'h' || kind === 'v') {
    flameBar(g, 0, 16, f);
  } else {
    flameBar(g, 0, 9, f);
    flameTip(g, 9, 8, 4.2 + f * 0.5);
  }
  g.restore();
}

function flameImage(kind: FlameKind, frame: number): HTMLCanvasElement {
  return image(`flame:${kind}:${frame}`, TILE_PX, TILE_PX, (g) => paintFlame(g, kind, frame));
}

function paintBomb(g: Ctx, color: string, f: number): void {
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.ellipse(8, 14.5, 4.8, 1.5, 0, 0, Math.PI * 2);
  g.fill();
  disc(g, 8, 9.5, 5.4, '#05050c');
  disc(g, 8, 9.5, 4.4, '#2b2b40');
  // Reflet.
  rect(g, 5, 7, 2, 1, '#9b9bc0');
  rect(g, 5, 8, 1, 1, '#9b9bc0');
  // Mèche qui monte vers la droite ; l'étincelle prend la couleur du joueur, une image sur deux.
  rect(g, 8, 4, 1, 1, '#c9a46a');
  rect(g, 9, 3, 1, 1, '#c9a46a');
  rect(g, 10, 2, 1, 1, '#c9a46a');
  disc(g, 11, 2, 1.5, f ? FIRE.core : color);
}

function bombImage(colorIndex: number, frame: number): HTMLCanvasElement {
  const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? '#ff4f8b';
  return image(`bomb:${colorIndex}:${frame}`, TILE_PX, TILE_PX, (g) => paintBomb(g, color, frame));
}

function paintPower(g: Ctx, kind: PowerKind): void {
  disc(g, 8, 8, 7.4, INK);
  disc(g, 8, 8, 6.2, POWER_BG[kind]);
  if (kind === 'bomb') {
    disc(g, 7.5, 9.5, 3.4, '#15151f');
    rect(g, 6, 7, 1, 1, '#9b9bc0');
    rect(g, 9, 5, 1, 1, '#c9a46a');
    rect(g, 10, 4, 1, 1, '#c9a46a');
    disc(g, 11, 3, 1.1, '#ffe066');
  } else if (kind === 'flame') {
    g.fillStyle = FIRE.edge;
    g.beginPath();
    g.ellipse(8, 9.5, 3, 4.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = FIRE.core;
    g.beginPath();
    g.ellipse(8, 10.5, 1.4, 2.4, 0, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'speed') {
    rect(g, 5, 3, 4, 7, '#1d2a4a');
    rect(g, 5, 9, 7, 3, '#1d2a4a');
    rect(g, 6, 4, 2, 2, '#5eead4');
  }
}

function powerImage(kind: PowerKind): HTMLCanvasElement {
  return image(`power:${kind}`, TILE_PX, TILE_PX, (g) => paintPower(g, kind));
}

function mixHex(a: string, b: string, t: number): string {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [pa, pb] = [n(a), n(b)];
  const c = pa.map((v, i) => Math.round(v * (1 - t) + (pb[i] ?? 0) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function paintSprite(g: Ctx, rows: readonly string[], color: string): void {
  const palette: Record<string, string> = {
    o: INK,
    w: '#ffffff',
    f: FACE,
    e: INK,
    c: color,
    d: mixHex(color, INK, 0.35),
    b: BOOTS,
  };
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const fill = palette[row[c] ?? '.'];
      if (fill) rect(g, c, r, 1, 1, fill);
    }
  });
}

export function unitImage(
  colorIndex: number,
  pose: 'front' | 'back',
  step: number,
  facing: Dir | undefined,
): HTMLCanvasElement {
  return image(`unit:${colorIndex}:${pose}:${step}:${facing ?? '-'}`, SPRITE_W, SPRITE_H, (g) => {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? '#ff4f8b';
    const frames = pose === 'back' ? FRAMES.back : FRAMES.front;
    const rows = withFacing(frames[step] ?? frames[0], facing);
    paintSprite(g, rows, color);
  });
}

// ---------------------------------------------------------------------------
// Sol et blocs : peints une seule fois, rafraîchis seulement quand la grille change.
// ---------------------------------------------------------------------------

let floorCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function staticLayer(L: Layout, view: BoardView, dpr: number): HTMLCanvasElement {
  const key = `${L.width}|${L.height}|${L.T}|${dpr}|${view.grid.join('/')}`;
  if (floorCache && floorCache.key === key) return floorCache.canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(L.width * dpr);
  c.height = Math.round(L.height * dpr);
  const g = c.getContext('2d');
  if (g) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    rect(g, 0, 0, L.width, L.height, INK);
    for (let y = 0; y < view.height; y++) {
      for (let x = 0; x < view.width; x++) {
        const o = cellOrigin(L, x, y);
        const ch = view.grid[y]?.[x] ?? '#';
        if (ch === '#') g.drawImage(stoneImage(), o.x, o.y, L.T, L.T);
        else if (ch === 'x') g.drawImage(softImage(), o.x, o.y, L.T, L.T);
        else g.drawImage(grassImage((x + y) % 2, Math.floor(hash(x, y) * 3)), o.x, o.y, L.T, L.T);
      }
    }
  }
  floorCache = { key, canvas: c };
  return c;
}

// ---------------------------------------------------------------------------
// Personnages : glissement entre cases, marche, respiration.
// ---------------------------------------------------------------------------

interface Trail {
  /** Case cible, telle que reçue du serveur. */
  x: number;
  y: number;
  /** Position visuelle au début du dernier pas. */
  fromX: number;
  fromY: number;
  movedAt: number;
  /** Instant de la mort, tant que le personnage est hors jeu. */
  deadAt?: number;
}

/** Mémorise la position affichée de chaque joueur, pour glisser d'une case à l'autre. */
const trails = new Map<string, Trail>();

/** Durée d'un pas : la même que le serveur (plus court avec un bonus de vitesse). */
function stepMs(u: BoardUnitView): number {
  return Math.max(85, 150 - (u.speed ?? 0) * 22 - (u.mount === 'dino' ? 20 : 0));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function glide(tr: Trail, now: number, dur: number): { x: number; y: number; t: number } {
  const t = Math.min(1, Math.max(0, (now - tr.movedAt) / dur));
  const e = easeOut(t);
  return { x: tr.fromX + (tr.x - tr.fromX) * e, y: tr.fromY + (tr.y - tr.fromY) * e, t };
}

function drawUnit(
  ctx: Ctx,
  L: Layout,
  S: number,
  u: BoardUnitView,
  now: number,
  index: number,
  onBomb: boolean,
  skin: PackSkin | undefined,
): void {
  const dur = stepMs(u);
  let tr = trails.get(u.playerId);
  if (!tr) {
    tr = { x: u.x, y: u.y, fromX: u.x, fromY: u.y, movedAt: -1e9 };
    trails.set(u.playerId, tr);
  } else if (tr.x !== u.x || tr.y !== u.y) {
    // Un nouveau pas part de la position visible, pas de la case précédente : pas de saut.
    const cur = glide(tr, now, dur);
    tr.fromX = cur.x;
    tr.fromY = cur.y;
    tr.x = u.x;
    tr.y = u.y;
    tr.movedAt = now;
  }
  const v = glide(tr, now, dur);
  if (u.alive) tr.deadAt = undefined;
  else tr.deadAt ??= now;
  const walking = v.t < 1;
  const step = walking ? Math.floor(now / (dur / 2)) % 2 : 0;
  // Respiration d'un pixel quand il ne bouge pas, décalée d'un personnage à l'autre.
  const breath = walking || !u.alive ? 0 : Math.floor(now / 450 + index) % 2;

  const o = cellOrigin(L, v.x, v.y);
  const pose = u.facing === 'up' ? 'back' : 'front';
  const sprite = unitImage(u.color, pose, step, u.facing);
  const w = SPRITE_W * S;
  const h = SPRITE_H * S;
  // Centré dans la case, pieds sur le bord bas.
  const x0 = Math.round(o.x + ((TILE_PX - SPRITE_W) / 2) * S);
  const y0 = Math.round(o.y + (TILE_PX - SPRITE_H - 1) * S - breath * S + (u.alive ? 0 : 2 * S));

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(o.x + 8 * S, o.y + 15 * S, 5 * S, 1.5 * S, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mort : clignotement, puis le personnage s'efface au sol.
  let visible = true;
  if (!u.alive) {
    const since = now - (tr.deadAt ?? now);
    visible = since >= 900 || Math.floor(since / 90) % 2 === 0;
    ctx.globalAlpha = since < 900 ? 1 : 0.3;
  } else if (onBomb) {
    // Debout sur sa bombe : légèrement transparent, pour que la bombe reste lisible.
    ctx.globalAlpha = 0.7;
  }
  // Haut de la tête, pour placer le pseudo au-dessus.
  let headTop = y0;
  if (visible) {
    if (skin && skinReady(skin)) {
      const skinH = (SPRITE_H + 1) * S;
      // Le pas le plus haut rebondit d'un pixel.
      const bottom = o.y + (TILE_PX - 1) * S - breath * S - (walking && step ? S : 0) + (u.alive ? 0 : 2 * S);
      drawSkin(ctx, skin, o.x + L.T / 2, bottom, skinH, u.facing === 'left');
      headTop = bottom - skinH;
    } else {
      ctx.drawImage(sprite, x0, y0, w, h);
    }
  }

  if (u.mount) {
    ctx.font = `${Math.round(L.T * 0.55)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(MOUNT_ICON[u.mount], o.x + L.T * 0.82, o.y + L.T * 0.3);
  }

  // Initiale du pseudo au-dessus de la tête.
  ctx.fillStyle = '#ecebe3';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.font = `800 ${Math.round(L.T * 0.34)}px ${'"Archivo Variable", Archivo, system-ui, sans-serif'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = u.name.trim().charAt(0).toUpperCase() || '?';
  const lx = o.x + L.T / 2;
  const ly = headTop - S * 0.5;
  ctx.strokeText(label, lx, ly);
  ctx.fillText(label, lx, ly);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Objets : bombes, explosions, bonus.
// ---------------------------------------------------------------------------

function drawFlame(
  ctx: Ctx,
  L: Layout,
  f: { x: number; y: number },
  has: (x: number, y: number) => boolean,
  now: number,
): void {
  const kind = flameKind(f.x, f.y, has);
  // Scintillement : chaque case a son propre rythme, pour que le feu ne batte pas à l'unisson.
  const frame = (Math.floor(now / 110) + f.x * 3 + f.y * 5) % 2;
  const o = cellOrigin(L, f.x, f.y);
  ctx.drawImage(flameImage(kind, frame), o.x, o.y, L.T, L.T);
}

function drawBomb(ctx: Ctx, L: Layout, b: BoardView['bombs'][number], now: number): void {
  const o = cellOrigin(L, b.x, b.y);
  const remain = Math.max(0, b.endsAt - now);
  const urgency = 1 - Math.min(1, remain / 2500);
  // Plus la mèche se consume, plus la bombe palpite vite.
  const pulse = 1 + 0.06 * Math.sin(now / (150 - 90 * urgency));
  const size = L.T * pulse;
  const frame = Math.floor(now / 90) % 2;
  ctx.drawImage(bombImage(b.color, frame), o.x + (L.T - size) / 2, o.y + (L.T - size) / 2, size, size);
}

function drawPowerup(ctx: Ctx, L: Layout, S: number, p: BoardView['powerups'][number], now: number): void {
  const o = cellOrigin(L, p.x, p.y);
  // Léger battement d'un pixel : le bonus attire l'œil sans texte.
  const bob = Math.round(Math.sin(now / 280 + p.x * 2 + p.y)) * S;
  ctx.drawImage(powerImage(p.kind), o.x, o.y + bob, L.T, L.T);
  if (p.kind === 'kangaroo' || p.kind === 'dino') {
    ctx.save();
    ctx.font = `${Math.round(L.T * 0.55)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(MOUNT_ICON[p.kind], o.x + L.T / 2, o.y + L.T / 2 + bob);
    ctx.restore();
  }
}

export interface SceneOptions {
  now: number;
  particles: Particle[];
  /** Densité de pixels de l'écran : le plateau est peint net à cette résolution. */
  dpr?: number;
  /** Personnages importés, par identifiant de joueur. Absent pour les joueurs au sprite peint. */
  skins?: ReadonlyMap<string, PackSkin>;
}


/** Liseré sombre autour du plateau. */
function frameLine(ctx: Ctx, L: Layout): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, L.width - 3, L.height - 3);
}

/** Dessine une image complète du plateau. */
export function drawScene(ctx: Ctx, L: Layout, view: BoardView, opts: SceneOptions): void {
  const { now, particles } = opts;
  const dpr = opts.dpr ?? 1;
  const S = L.T / TILE_PX;
  ctx.imageSmoothingEnabled = false;

  // Sol et blocs, depuis le cache.
  ctx.drawImage(staticLayer(L, view, dpr), 0, 0, L.width, L.height);
  frameLine(ctx, L);

  // Explosions, au-dessus du sol.
  const flameSet = new Set(view.flames.map((f) => `${f.x},${f.y}`));
  const has = (x: number, y: number) => flameSet.has(`${x},${y}`);
  for (const f of view.flames) drawFlame(ctx, L, f, has, now);

  for (const p of view.powerups) drawPowerup(ctx, L, S, p, now);
  for (const b of view.bombs) drawBomb(ctx, L, b, now);

  // Personnages : de l'arrière vers l'avant, comme dans les vrais jeux de cases.
  const bombCells = new Set(view.bombs.map((b) => `${b.x},${b.y}`));
  const order = view.units.map((u, i) => ({ u, i })).sort((a, b) => a.u.y - b.u.y || a.i - b.i);
  for (const { u, i } of order) {
    drawUnit(ctx, L, S, u, now, i, bombCells.has(`${u.x},${u.y}`), opts.skins?.get(u.playerId));
  }

  ctx.save();
  drawParticles(ctx, particles);
  ctx.restore();
}
