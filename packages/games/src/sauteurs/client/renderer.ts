import {
  PIXEL_PALETTE,
  bitmapToRgba,
  drawFace,
  type CharacterSpec,
  type PixelBitmap,
  type SfxName,
} from '@partyhub/shared';
import type { GameEvent, PlayerState, World } from '../engine.js';
import {
  backdropFor,
  bonusBlock,
  brick,
  checkpoint,
  coin,
  coinGhost,
  finishPole,
  groundFill,
  groundTop,
  oneWay,
  slime,
  spikes,
  spring,
  sun,
  BL,
  CY,
  G,
  GR,
  O,
  PU,
  R,
  W,
  Y,
  type Backdrop,
} from './art.js';
import {
  TILE_PX,
  clampCamera,
  computeCamera,
  easeCamera,
  followSet,
  indicatorFor,
  type CameraTarget,
} from './camera.js';
import { countdownLabel, formatTicks, hudLayout, liveRanking, shortName, type HudLayout } from './hud.js';
import { Particles } from './particles.js';
import { SpriteCache, chooseSprite, makeSprite, spriteKey, type SpriteChoice } from './sprites.js';

/** Couleur d'équipe de chaque joueur (indices de la palette) : point du nom, flèche hors champ, classement. */
export const PLAYER_COLORS: readonly number[] = [R, BL, GR, Y, PU, O, CY, W];

export interface RacerInfo {
  id: string;
  name: string;
  spec: CharacterSpec;
  specKey: string;
  /** Joueur parti en cours de route : on ne le dessine plus. */
  left: boolean;
}

export interface HudInfo {
  levelName: string;
  step: number;
  levelCount: number;
  /** Millisecondes avant le départ (négatif : la course a commencé). */
  countdownMs: number;
  /** Secondes de la limite de temps. */
  timeLimit: number;
}

export interface RendererOptions {
  reducedMotion: boolean;
  sfx?: (name: SfxName) => void;
}

const HEX = PIXEL_PALETTE;
const FONT_UI = "'Outfit Variable', 'Outfit', system-ui, sans-serif";
const FONT_TITLE = "'Dela Gothic One', 'Outfit Variable', system-ui, sans-serif";

function toCanvas(b: PixelBitmap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = b.width;
  c.height = b.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(b.width, b.height);
  img.data.set(bitmapToRgba(b, 1, null));
  ctx.putImageData(img, 0, 0);
  return c;
}

// Natures de tuile (clé de dessin).
const K_NONE = 0;
const K_TOP0 = 1;
const K_TOP1 = 2;
const K_FILL0 = 3;
const K_FILL1 = 4;
const K_BRICK = 5;
const K_BONUS = 6;
const K_ONEWAY = 7;
const K_SPIKES = 8;
const K_SPRING = 9;
const K_CHECK = 10;
const K_POLE = 11;
const K_POLETOP = 12;

interface SpriteImage {
  canvas: HTMLCanvasElement;
  foot: number;
  width: number;
}

export class RaceRenderer {
  readonly world: World;
  readonly racers: RacerInfo[];
  private readonly main: CanvasRenderingContext2D;
  private readonly low: HTMLCanvasElement;
  private readonly lowCtx: CanvasRenderingContext2D;
  private readonly kinds: Uint8Array;
  private readonly blockIndex = new Map<number, number>();
  private readonly springIndex = new Map<number, number>();
  private readonly checkIndex = new Map<number, number>();
  private readonly backdrop: Backdrop;
  private readonly layerImages: HTMLCanvasElement[];
  private readonly sunImage: HTMLCanvasElement;
  private readonly tiles: Record<number, HTMLCanvasElement> = {};
  private readonly bonusUsed: HTMLCanvasElement;
  private readonly springs: HTMLCanvasElement[];
  private readonly checks: HTMLCanvasElement[];
  private readonly poles: HTMLCanvasElement[][];
  private readonly coins: HTMLCanvasElement[];
  private readonly coinGhostImage: HTMLCanvasElement;
  private readonly slimes: HTMLCanvasElement[];
  private readonly sprites = new SpriteCache<SpriteImage>();
  private readonly faces = new Map<string, HTMLCanvasElement>();
  private readonly particles = new Particles();
  private readonly opts: RendererOptions;

  /** Taille de l'écran en pixels d'appareil. */
  width = 0;
  height = 0;
  private lw = 0;
  private lh = 0;
  cam: CameraTarget;
  private prevCam: CameraTarget;
  private prevX: Float64Array;
  private prevY: Float64Array;
  private hasCam = false;
  private stepsSinceZoom = 999;
  private leader = 0;
  private shake = 0;
  private time = 0;
  private lastSfx = new Map<string, number>();
  /** Instants des dernières images (pour mesurer la fluidité). */
  frames = 0;

  constructor(canvas: HTMLCanvasElement, world: World, racers: RacerInfo[], opts: RendererOptions) {
    this.world = world;
    this.racers = racers;
    this.opts = opts;
    this.main = canvas.getContext('2d', { alpha: false })!;
    this.low = document.createElement('canvas');
    this.lowCtx = this.low.getContext('2d', { alpha: false })!;
    const theme = world.level.theme;
    this.backdrop = backdropFor(theme);
    this.layerImages = this.backdrop.layers.map((l) => toCanvas(l.bitmap));
    this.sunImage = toCanvas(sun());
    this.tiles[K_TOP0] = toCanvas(groundTop(theme, 0));
    this.tiles[K_TOP1] = toCanvas(groundTop(theme, 1));
    this.tiles[K_FILL0] = toCanvas(groundFill(theme, 0));
    this.tiles[K_FILL1] = toCanvas(groundFill(theme, 1));
    this.tiles[K_BRICK] = toCanvas(brick());
    this.tiles[K_BONUS] = toCanvas(bonusBlock(false));
    this.tiles[K_ONEWAY] = toCanvas(oneWay());
    this.tiles[K_SPIKES] = toCanvas(spikes());
    this.bonusUsed = toCanvas(bonusBlock(true));
    this.springs = [toCanvas(spring(false)), toCanvas(spring(true))];
    this.checks = [toCanvas(checkpoint(false)), toCanvas(checkpoint(true))];
    this.poles = [
      [toCanvas(finishPole(false, 0)), toCanvas(finishPole(false, 1))],
      [toCanvas(finishPole(true, 0)), toCanvas(finishPole(true, 1))],
    ];
    this.coins = ([0, 1, 2, 3] as const).map((f) => toCanvas(coin(f)));
    this.coinGhostImage = toCanvas(coinGhost());
    this.slimes = [toCanvas(slime(0)), toCanvas(slime(1))];

    // Nature de chaque case.
    const { width: w, height: h, level } = world;
    this.kinds = new Uint8Array(w * h);
    const solid = (c: number, r: number) => {
      const ch = level.tiles[r]?.[c];
      return ch === '#' || ch === 'B' || ch === '?';
    };
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const ch = level.tiles[r]![c]!;
        const v = (c * 7 + r * 13) % 2;
        let k = K_NONE;
        if (ch === '#') k = solid(c, r - 1) ? (v ? K_FILL1 : K_FILL0) : v ? K_TOP1 : K_TOP0;
        else if (ch === 'B') k = K_BRICK;
        else if (ch === '?') k = K_BONUS;
        else if (ch === '=') k = K_ONEWAY;
        else if (ch === '^') k = K_SPIKES;
        else if (ch === 'J') k = K_SPRING;
        else if (ch === 'C') k = K_CHECK;
        else if (ch === 'F') k = level.tiles[r - 1]?.[c] === 'F' ? K_POLE : K_POLETOP;
        this.kinds[r * w + c] = k;
      }
    }
    world.blocks.forEach((b, i) => this.blockIndex.set(b.row * w + b.col, i));
    world.springs.forEach((s, i) => this.springIndex.set(s.row * w + s.col, i));
    world.checkpoints.forEach((k, i) => this.checkIndex.set(k.row * w + k.col, i));

    this.prevX = new Float64Array(world.players.length);
    this.prevY = new Float64Array(world.players.length);
    this.cam = { scale: 2, cx: world.starts[0]?.x ?? 1, cy: (world.starts[0]?.y ?? 1) - 2 };
    this.prevCam = this.cam;
    this.snapshot();
  }

  // -------------------------------------------------------------------------------------------
  // Taille
  // -------------------------------------------------------------------------------------------

  /** Cale le canvas sur sa taille d'affichage (et la densité de pixels de l'écran). Renvoie vrai si la taille a changé. */
  resize(canvas: HTMLCanvasElement): boolean {
    const dpr = Math.max(1, Math.min(2, Math.floor(window.devicePixelRatio || 1)));
    const w = Math.max(160, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(90, Math.round(canvas.clientHeight * dpr));
    if (w === this.width && h === this.height) return false;
    this.width = w;
    this.height = h;
    canvas.width = w;
    canvas.height = h;
    this.main.imageSmoothingEnabled = false;
    this.hasCam = false;
    return true;
  }

  private ensureLow(): void {
    const s = this.cam.scale;
    const lw = Math.ceil(this.width / s);
    const lh = Math.ceil(this.height / s);
    if (lw !== this.lw || lh !== this.lh) {
      this.lw = lw;
      this.lh = lh;
      this.low.width = lw;
      this.low.height = lh;
      this.lowCtx.imageSmoothingEnabled = false;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Simulation -> affichage
  // -------------------------------------------------------------------------------------------

  private active(): PlayerState[] {
    const out: PlayerState[] = [];
    this.world.players.forEach((p, i) => {
      if (!this.racers[i]?.left) out.push(p);
    });
    return out;
  }

  /** Mémorise les positions avant un pas (pour interpoler l'affichage entre deux pas). */
  snapshot(): void {
    this.world.players.forEach((p, i) => {
      this.prevX[i] = p.x;
      this.prevY[i] = p.y;
    });
    this.prevCam = this.cam;
  }

  /** À appeler après chaque pas de simulation : caméra, particules, événements. */
  afterStep(): void {
    this.time++;
    this.stepsSinceZoom++;
    if (this.width > 0) this.updateCamera();
    this.particles.update();
    if (this.shake > 0) this.shake--;
    for (const ev of this.world.events) this.handle(ev);
  }

  private updateCamera(): void {
    const act = this.active();
    const { points, leader } = followSet(act);
    if (leader) this.leader = this.world.players.indexOf(leader);
    let target = computeCamera({
      points,
      leader,
      viewW: this.width,
      viewH: this.height,
      levelW: this.world.width,
      levelH: this.world.height,
      scale: this.cam.scale,
    });
    if (!this.hasCam) {
      this.cam = target;
      this.prevCam = target;
      this.hasCam = true;
      this.stepsSinceZoom = 0;
      return;
    }
    // On ne zoome pas deux fois de suite à moins d'une seconde d'intervalle (on dézoome tout de suite si besoin).
    if (target.scale > this.cam.scale && this.stepsSinceZoom < 60) {
      target = clampCamera(
        { scale: this.cam.scale, cx: target.cx, cy: target.cy },
        this.width,
        this.height,
        this.world.width,
        this.world.height,
      );
    }
    if (target.scale !== this.cam.scale) this.stepsSinceZoom = 0;
    this.cam = easeCamera(this.cam, target);
  }

  private visible(x: number, y: number, margin = 2): boolean {
    const c = this.cam;
    const tw = this.width / (TILE_PX * c.scale) / 2 + margin;
    const th = this.height / (TILE_PX * c.scale) / 2 + margin;
    return Math.abs(x - c.cx) <= tw && Math.abs(y - c.cy) <= th;
  }

  private sfx(name: SfxName): void {
    const now = performance.now();
    if (now - (this.lastSfx.get(name) ?? 0) < 90) return;
    this.lastSfx.set(name, now);
    this.opts.sfx?.(name);
  }

  private burst(
    x: number,
    y: number,
    colors: readonly number[],
    n: number,
    speed: number,
    up: number,
    life = 28,
    gravity = 0.06,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.particles.spawn(
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s - up,
        life * (0.6 + Math.random() * 0.5),
        colors[i % colors.length]!,
        1 + (i % 3 === 0 ? 1 : 0),
        gravity,
      );
    }
  }

  private handle(ev: GameEvent): void {
    if (ev.type === 'timeup') {
      this.sfx('final');
      return;
    }
    const px = ev.x * TILE_PX;
    const py = ev.y * TILE_PX;
    const seen = this.visible(ev.x, ev.y);
    switch (ev.type) {
      case 'jump':
        this.burst(px, py - 1, [G, W], 4, 0.5, 0.2, 14, 0.01);
        break;
      case 'coin':
        this.burst(px, py, [Y, W, O], 8, 1.1, 0.8, 24);
        if (seen) this.sfx('pickup');
        break;
      case 'stomp':
        this.burst(px, py - 4, [GR, W, GR], 10, 1.2, 0.9, 22);
        if (seen) this.sfx('hit');
        break;
      case 'spring':
        this.burst(px, py - 2, [W, G], 6, 0.9, 0.3, 14, 0.01);
        break;
      case 'checkpoint':
        this.burst(px, py - 8, [Y, W], 10, 1, 0.8, 26);
        if (seen) this.sfx('place');
        break;
      case 'death':
        this.burst(px, Math.min(py, this.world.height * TILE_PX) - 6, [R, O, W, Y], 18, 1.6, 1, 34);
        if (seen) {
          this.sfx('die');
          if (!this.opts.reducedMotion) this.shake = 14;
        }
        break;
      case 'finish':
        this.burst(px, py - 12, [R, Y, BL, GR, PU, O, W], 30, 1.8, 1.8, 50, 0.05);
        if (seen) this.sfx(ev.rank === 1 ? 'win' : 'pickup');
        break;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Dessin
  // -------------------------------------------------------------------------------------------

  draw(alpha: number, hud: HudInfo): void {
    if (this.width === 0) return;
    if (!this.hasCam) this.updateCamera();
    this.frames++;
    this.ensureLow();
    const s = this.cam.scale;
    const c0 = this.prevCam.scale === this.cam.scale ? this.prevCam : this.cam;
    const cx = c0.cx + (this.cam.cx - c0.cx) * alpha;
    const cy = c0.cy + (this.cam.cy - c0.cy) * alpha;
    let shakeX = 0;
    let shakeY = 0;
    if (this.shake > 0 && !this.opts.reducedMotion) {
      const amp = Math.ceil((this.shake / 14) * 3);
      shakeX = Math.round((Math.random() - 0.5) * 2 * amp);
      shakeY = Math.round((Math.random() - 0.5) * 2 * amp);
    }
    const camX = Math.round(cx * TILE_PX - this.lw / 2) + shakeX;
    const camY = Math.round(cy * TILE_PX - this.lh / 2) + shakeY;

    const ctx = this.lowCtx;
    this.drawBackdrop(ctx, camX, camY);
    this.drawTiles(ctx, camX, camY);
    this.drawThings(ctx, camX, camY);
    const labels = this.drawPlayers(ctx, camX, camY, alpha);
    this.drawParticles(ctx, camX, camY);

    // Mise à l'échelle entière, sans lissage : tous les pixels ont la même taille.
    this.main.imageSmoothingEnabled = false;
    this.main.drawImage(this.low, 0, 0, this.lw, this.lh, 0, 0, this.lw * s, this.lh * s);

    const layout = hudLayout(this.width, this.height, this.racers.length);
    this.drawLabels(layout, labels, s);
    this.drawIndicators(layout, cx, cy);
    this.drawHud(layout, hud);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const { lw, lh } = this;
    ctx.fillStyle = HEX[this.backdrop.sky]!;
    ctx.fillRect(0, 0, lw, lh);
    let prev = this.backdrop.sky;
    this.backdrop.bands.forEach((band, i) => {
      const y0 = Math.floor(band.from * lh);
      const next = this.backdrop.bands[i + 1];
      const y1 = next ? Math.floor(next.from * lh) : lh;
      if (band.dither) {
        for (let y = y0; y < y1; y += 4) {
          ctx.fillStyle = HEX[band.color]!;
          ctx.fillRect(0, y, lw, 2);
          ctx.fillStyle = HEX[prev]!;
          ctx.fillRect(0, y + 2, lw, 2);
        }
      } else {
        ctx.fillStyle = HEX[band.color]!;
        ctx.fillRect(0, y0, lw, Math.max(0, y1 - y0));
      }
      if (!band.dither) prev = band.color;
    });
    if (this.world.level.theme === 'prairie') {
      ctx.drawImage(this.sunImage, Math.round(lw * 0.62), 18);
    }
    const t = this.time / 60;
    const midY = (this.world.height / 2) * TILE_PX;
    this.backdrop.layers.forEach((layer, i) => {
      const img = this.layerImages[i]!;
      const period = img.width;
      const off = camX * layer.factor + (this.opts.reducedMotion ? 0 : t * layer.drift);
      const x0 = -(((Math.round(off) % period) + period) % period);
      const lift = Math.max(0, Math.min(36, Math.round((midY - (camY + lh / 2)) * layer.factor * 0.3)));
      let y: number;
      if (layer.anchor === 'bottom') y = lh - img.height + lift;
      else if (layer.anchor === 'top') y = 0;
      else y = 6 + Math.round(lift * 0.5);
      for (let x = x0; x < lw; x += period) ctx.drawImage(img, x, y);
    });
  }

  private drawTiles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const { world } = this;
    const c0 = Math.max(0, Math.floor(camX / TILE_PX));
    const c1 = Math.min(world.width - 1, Math.floor((camX + this.lw) / TILE_PX));
    const r0 = Math.max(0, Math.floor(camY / TILE_PX));
    const r1 = Math.min(world.height - 1, Math.floor((camY + this.lh) / TILE_PX));
    const lead = world.players[this.leader];
    const tick = world.tick;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = this.kinds[r * world.width + c]!;
        if (k === K_NONE) continue;
        const x = c * TILE_PX - camX;
        const y = r * TILE_PX - camY;
        let img: HTMLCanvasElement | undefined;
        if (k === K_BONUS) {
          const bi = this.blockIndex.get(r * world.width + c);
          img = bi !== undefined && lead?.blockHit[bi] ? this.bonusUsed : this.tiles[K_BONUS];
        } else if (k === K_SPRING) {
          const si = this.springIndex.get(r * world.width + c);
          const pressed =
            si !== undefined && tick - world.springs[si]!.pressedTick < 8 && world.springs[si]!.pressedTick >= 0;
          img = this.springs[pressed ? 1 : 0];
        } else if (k === K_CHECK) {
          const ki = this.checkIndex.get(r * world.width + c);
          img = this.checks[ki !== undefined && lead && lead.checkpointIndex >= ki ? 1 : 0];
        } else if (k === K_POLE) {
          img = this.poles[0]![Math.floor(tick / 14) % 2];
        } else if (k === K_POLETOP) {
          img = this.poles[1]![Math.floor(tick / 14) % 2];
        } else img = this.tiles[k];
        if (img) ctx.drawImage(img, x, y);
      }
    }
  }

  private drawThings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const { world } = this;
    const lead = world.players[this.leader];
    const left = camX - TILE_PX;
    const right = camX + this.lw + TILE_PX;
    const tick = world.tick;
    // Pièces : vives tant que le premier ne les a pas prises ; anneau gris s'il l'a fait mais que d'autres peuvent encore.
    for (let i = 0; i < world.coins.length; i++) {
      const cn = world.coins[i]!;
      const px = cn.x * TILE_PX;
      if (px < left || px > right) continue;
      let takenBy = 0;
      for (const p of world.players) if (p.coinTaken[i]) takenBy++;
      if (takenBy === world.players.length) continue;
      const img = lead?.coinTaken[i] ? this.coinGhostImage : this.coins[(Math.floor(tick / 7) + i) % 4]!;
      ctx.drawImage(img, Math.round(px - 8 - camX), Math.round(cn.y * TILE_PX - 8 - camY));
    }
    // Ennemis : tant qu'un coureur peut encore se faire toucher.
    for (let i = 0; i < world.enemies.length; i++) {
      const e = world.enemies[i]!;
      const px = e.x * TILE_PX;
      if (px < left || px > right) continue;
      if (world.players.every((p) => p.stomped[i])) continue;
      const img = this.slimes[Math.floor((tick + i * 9) / 16) % 2]!;
      ctx.drawImage(img, Math.round(px - 8 - camX), Math.round(e.y * TILE_PX - 16 - camY));
    }
  }

  private spriteOf(racer: RacerInfo, choice: SpriteChoice, facingLeft: boolean): SpriteImage {
    return this.sprites.get(spriteKey(racer.specKey, choice, facingLeft), () => {
      const art = makeSprite(racer.spec, choice, facingLeft);
      return { canvas: toCanvas(art.bitmap), foot: art.foot, width: art.bitmap.width };
    });
  }

  private labelBuf: { name: string; x: number; y: number; color: number; leader: boolean }[] = [];

  private drawPlayers(ctx: CanvasRenderingContext2D, camX: number, camY: number, alpha: number) {
    const { world } = this;
    const order: number[] = [];
    world.players.forEach((_, i) => {
      if (!this.racers[i]?.left) order.push(i);
    });
    // Les arrivés au fond, puis du dernier au premier : le premier passe devant.
    order.sort((a, b) => {
      const pa = world.players[a]!;
      const pb = world.players[b]!;
      if (pa.finished !== pb.finished) return pa.finished ? -1 : 1;
      return pa.x - pb.x;
    });
    this.labelBuf.length = 0;
    for (const i of order) {
      const p = world.players[i]!;
      const racer = this.racers[i]!;
      let x = p.x;
      let y = p.y;
      const jump = Math.hypot(p.x - this.prevX[i]!, p.y - this.prevY[i]!);
      if (jump < 3) {
        x = this.prevX[i]! + (p.x - this.prevX[i]!) * alpha;
        y = this.prevY[i]! + (p.y - this.prevY[i]!) * alpha;
      }
      const choice = chooseSprite(p.anim, x);
      const sprite = this.spriteOf(racer, choice, p.dir === -1);
      const dx = Math.round(x * TILE_PX - sprite.width / 2 - camX);
      const dy = Math.round(y * TILE_PX - (sprite.foot + 1) - camY);
      const blink = p.invuln > 0 && !p.dead && (world.tick >> 2) % 2 === 0;
      if (!blink && !(p.dead && y > world.height + 1)) ctx.drawImage(sprite.canvas, dx, dy);
      this.labelBuf.push({
        name: racer.name,
        x: dx + sprite.width / 2,
        y: dy,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length]!,
        leader: i === this.leader,
      });
    }
    return this.labelBuf;
  }

  private drawParticles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.particles.each((x, y, color, size) => {
      ctx.fillStyle = HEX[color]!;
      ctx.fillRect(Math.round(x - camX), Math.round(y - camY), size, size);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Texte et interface (pixels d'écran)
  // -------------------------------------------------------------------------------------------

  private text(
    s: string,
    x: number,
    y: number,
    size: number,
    opts: { align?: CanvasTextAlign; title?: boolean; color?: string; baseline?: CanvasTextBaseline } = {},
  ): number {
    const ctx = this.main;
    ctx.font = `${opts.title ? '400' : '800'} ${size}px ${opts.title ? FONT_TITLE : FONT_UI}`;
    ctx.textAlign = opts.align ?? 'left';
    ctx.textBaseline = opts.baseline ?? 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, Math.round(size / 6));
    ctx.strokeStyle = HEX[0]!;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = opts.color ?? HEX[1]!;
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
  }

  private panel(x: number, y: number, w: number, h: number, k: number): void {
    const ctx = this.main;
    ctx.fillStyle = 'rgba(16, 16, 16, 0.72)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = HEX[1]!;
    ctx.lineWidth = Math.max(2, Math.round(3 * k));
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  private face(racer: RacerInfo): HTMLCanvasElement {
    let f = this.faces.get(racer.specKey);
    if (!f) {
      f = toCanvas(drawFace(racer.spec, 'content'));
      this.faces.set(racer.specKey, f);
    }
    return f;
  }

  private drawLabels(layout: HudLayout, labels: typeof this.labelBuf, s: number): void {
    const ctx = this.main;
    const size = layout.font;
    const placed: { x0: number; x1: number; y: number }[] = [];
    // Du plus haut au plus bas : un nom qui en chevauche un autre monte d'une ligne.
    const list = labels.slice().sort((a, b) => a.y - b.y);
    for (const l of list) {
      const text = shortName(l.name);
      ctx.font = `800 ${size}px ${FONT_UI}`;
      const w = ctx.measureText(text).width + size * 0.9;
      const sx = l.x * s;
      let sy = l.y * s - size * 0.4;
      const x0 = sx - w / 2;
      const x1 = sx + w / 2;
      for (let guard = 0; guard < 8; guard++) {
        const clash = placed.find((p) => p.x0 < x1 && p.x1 > x0 && Math.abs(p.y - sy) < size * 1.05);
        if (!clash) break;
        sy = clash.y - size * 1.1;
      }
      placed.push({ x0, x1, y: sy });
      // Pastille de couleur d'équipe, puis le nom.
      const dot = Math.round(size * 0.5);
      ctx.fillStyle = HEX[0]!;
      ctx.fillRect(Math.round(x0 - 2), Math.round(sy - size * 0.55 - 2), dot + 4, dot + 4);
      ctx.fillStyle = HEX[l.color]!;
      ctx.fillRect(Math.round(x0), Math.round(sy - size * 0.55), dot, dot);
      this.text(text, x0 + dot + size * 0.3, sy - size * 1.0, size, { color: l.leader ? HEX[Y]! : HEX[W]! });
    }
  }

  private drawIndicators(layout: HudLayout, cx: number, cy: number): void {
    const ctx = this.main;
    const cam: CameraTarget = { scale: this.cam.scale, cx, cy };
    const m = Math.round(70 * layout.k);
    this.world.players.forEach((p, i) => {
      if (this.racers[i]?.left || p.finished) return;
      const ind = indicatorFor({ x: p.x, y: Math.min(p.y, this.world.height) }, cam, this.width, this.height, m);
      if (!ind) return;
      const r = Math.round(18 * layout.k);
      const color = HEX[PLAYER_COLORS[i % PLAYER_COLORS.length]!]!;
      // Flèche : un triangle orienté vers le coureur.
      const ax = ind.dx;
      const ay = ind.dy;
      ctx.beginPath();
      ctx.moveTo(ind.x + ax * r * 1.3, ind.y + ay * r * 1.3);
      ctx.lineTo(ind.x - ay * r - ax * r * 0.6, ind.y + ax * r - ay * r * 0.6);
      ctx.lineTo(ind.x + ay * r - ax * r * 0.6, ind.y - ax * r - ay * r * 0.6);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = Math.max(3, Math.round(4 * layout.k));
      ctx.strokeStyle = HEX[0]!;
      ctx.lineJoin = 'round';
      ctx.stroke();
      const name = shortName(this.racers[i]!.name, 8);
      const tx = ind.side === 'right' ? ind.x - r * 1.6 : ind.side === 'left' ? ind.x + r * 1.6 : ind.x;
      const align: CanvasTextAlign = ind.side === 'right' ? 'right' : ind.side === 'left' ? 'left' : 'center';
      const ty =
        ind.side === 'top'
          ? ind.y + r * 1.6
          : ind.side === 'bottom'
            ? ind.y - r * 1.6 - layout.font
            : ind.y - layout.font / 2;
      this.text(name, tx, ty, layout.font, { align });
    });
  }

  private drawHud(layout: HudLayout, hud: HudInfo): void {
    const ctx = this.main;
    const { k, font, margin } = layout;
    // Titre du niveau, en haut à gauche.
    const title = `${hud.levelName}`;
    const sub = `Niveau ${hud.step} sur ${hud.levelCount}`;
    ctx.font = `800 ${font}px ${FONT_UI}`;
    const tw = Math.max(ctx.measureText(title).width, ctx.measureText(sub).width) + font;
    const ty = this.height - margin - font * 2.5;
    this.panel(margin, ty, tw, font * 2.5, k);
    this.text(title, margin + font * 0.5, ty + font * 0.25, font);
    this.text(sub, margin + font * 0.5, ty + font * 1.3, font, { color: HEX[G]! });

    // Chronomètre au centre.
    const clock = formatTicks(this.world.tick);
    const limit = formatTicks(hud.timeLimit * 60).replace(/\.\d$/, '');
    const cw = font * 9;
    this.panel(layout.timer.cx - cw / 2, margin, cw, layout.fontTimer + font * 1.2, k);
    this.text(clock, layout.timer.cx, margin + font * 0.2, layout.fontTimer, { align: 'center', title: true });
    this.text(`limite ${limit}`, layout.timer.cx, margin + font * 0.25 + layout.fontTimer, font * 0.9, {
      align: 'center',
      color: HEX[G]!,
    });

    // Classement en direct.
    const rk = layout.ranking;
    this.panel(rk.x, rk.y, rk.w, rk.h, k);
    this.text('Classement', rk.x + font * 0.5, rk.y + (rk.headerH - font) / 2, font, { color: HEX[Y]! });
    const standing = liveRanking(
      this.world.players
        .map((p, i) => ({ p, i, id: p.id, x: p.x, finished: p.finished, rank: p.rank }))
        .filter((e) => !this.racers[e.i]?.left),
    ).slice(0, 8);
    standing.forEach((e, row) => {
      const y = rk.y + rk.headerH + row * rk.rowH;
      const racer = this.racers[e.i]!;
      ctx.fillStyle = HEX[PLAYER_COLORS[e.i % PLAYER_COLORS.length]!]!;
      ctx.fillRect(rk.x + 8, y + 6, Math.round(6 * k), rk.rowH - 12);
      const fs = layout.faceScale;
      const fy = y + (rk.rowH - 32 * fs) / 2;
      this.main.imageSmoothingEnabled = false;
      ctx.drawImage(this.face(racer), rk.x + 22, fy, 32 * fs, 32 * fs);
      const label = e.finished ? `${e.rank}. ${shortName(racer.name, 8)}` : `${row + 1}. ${shortName(racer.name, 8)}`;
      this.text(label, rk.x + 22 + 32 * fs + 10, y + (rk.rowH - font) / 2, font, {
        color: e.finished ? HEX[Y]! : HEX[W]!,
      });
      const coins = String(e.p.coins);
      const cw2 = this.text(coins, rk.x + rk.w - font * 0.6, y + (rk.rowH - font) / 2, font, { align: 'right' });
      const ci = Math.round(font * 0.9);
      ctx.drawImage(this.coins[0]!, rk.x + rk.w - font * 0.6 - cw2 - ci - 6, y + (rk.rowH - ci) / 2, ci, ci);
    });

    // Compte à rebours.
    const label = countdownLabel(hud.countdownMs);
    if (label) {
      const phase = hud.countdownMs > 0 ? (hud.countdownMs % 1000) / 1000 : Math.max(0, 1 + hud.countdownMs / 900);
      const bump = this.opts.reducedMotion ? 1 : 0.85 + 0.3 * phase;
      this.text(label, this.width / 2, this.height * 0.42, layout.fontBig * bump, {
        align: 'center',
        baseline: 'middle',
        title: true,
        color: label === 'GO !' ? HEX[GR]! : HEX[Y]!,
      });
    }
    if (this.world.over) {
      const msg = this.world.timeUp ? 'Temps écoulé !' : 'Course terminée !';
      this.text(msg, this.width / 2, this.height * 0.42, layout.fontBig * 0.3, {
        align: 'center',
        baseline: 'middle',
        title: true,
      });
    }
  }

  /** Position d'écran du premier coureur (pour les tests). */
  get leaderIndex(): number {
    return this.leader;
  }

  get spriteCacheStats(): { size: number; hits: number; misses: number } {
    return { size: this.sprites.size, hits: this.sprites.hits, misses: this.sprites.misses };
  }
}
