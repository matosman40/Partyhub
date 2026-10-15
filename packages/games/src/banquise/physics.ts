/**
 * Banquise : physique de côté, en fonctions pures et déterministes.
 *
 * Unités : une colonne de glace vaut 1. Les personnages se déplacent en valeurs réelles
 * (x, y), y étant la hauteur au-dessus de la surface de la glace. Tout ce qui est aléatoire
 * passe par le générateur injecté, et tout ce qui dépend du temps par `now` : rien ici ne
 * lit l'horloge réelle. Les valeurs sont celles de docs/JEU-BANQUISE.md.
 */

export const WIDTH = 21;
export const TICK_MS = 50;

export const GRAVITY = 20;
export const JUMP_SPEED = 7.6;
export const WALK_SPEED = 4.2;
export const ICE_ACCEL = 13;
export const ICE_DRAG = 2;
export const AIR_ACCEL = 6;
export const WIND_ACCEL = 5;
export const PUSH_SPEED = 4.8;
export const PUSH_RANGE = 0.95;
export const PUSH_HEIGHT = 0.7;
export const PUSH_COOLDOWN_MS = 1200;
/** Durée pendant laquelle l'attitude « poussée » reste affichée. */
export const PUSH_FX_MS = 400;
export const BODY_HALF = 0.35;
export const FOOT = 0.3;
export const SINK_DEPTH = 0.6;
export const MAX_SPEED = 8;

/** Colonnes laissées libres de chaque côté au départ (et jamais occupées par un personnage). */
export const SPAWN_MARGIN = 3;
export const ICE = 'i';
export const WATER = '.';

export type Dir = -1 | 0 | 1;

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Sens du regard : la poussée s'applique de ce côté. */
  facing: -1 | 1;
  /** Direction demandée par le joueur (maintenue). */
  dir: Dir;
  grounded: boolean;
  alive: boolean;
  /** Instant à partir duquel une nouvelle poussée est permise. */
  pushReadyAt: number;
  /** Jusqu'à quand le personnage affiche l'attitude de poussée. */
  pushingUntil: number;
  /** Jusqu'à quand le personnage vient d'être poussé (affichage seulement). */
  pushedUntil: number;
  /** Instant de l'élimination, ou null. */
  diedAt: number | null;
}

export function newBody(x: number, facing: -1 | 1): Body {
  return {
    x,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    dir: 0,
    grounded: true,
    alive: true,
    pushReadyAt: 0,
    pushingUntil: 0,
    pushedUntil: 0,
    diedAt: null,
  };
}

export function isIce(ice: string, col: number): boolean {
  return col >= 0 && col < ice.length && ice[col] === ICE;
}

/** Vrai si au moins un pied repose sur la glace. */
export function supported(ice: string, x: number): boolean {
  return isIce(ice, Math.floor(x - FOOT)) || isIce(ice, Math.floor(x + FOOT));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Rapproche `v` de `target` d'au plus `maxDelta`, sans le dépasser. */
function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

export function setInput(b: Body, dir: Dir): Body {
  if (!b.alive) return b;
  return { ...b, dir, facing: dir !== 0 ? dir : b.facing };
}

/** Saut : seulement au sol, pour un personnage vivant. */
export function jump(b: Body): Body {
  if (!b.alive || !b.grounded) return b;
  return { ...b, grounded: false, vy: JUMP_SPEED };
}

/**
 * Avance un personnage de `dt` secondes. `windAccel` est l'accélération horizontale du vent
 * (0 hors rafale). Renvoie un nouveau personnage ; un personnage éliminé ne bouge plus.
 */
export function stepBody(b: Body, ice: string, now: number, dt: number, windAccel: number): Body {
  if (!b.alive) return b;
  const target = b.dir * WALK_SPEED;
  let vx = b.vx;
  let vy = b.vy;
  let y = b.y;
  let grounded = b.grounded;

  if (grounded) {
    if (b.dir !== 0) vx = approach(vx, target, ICE_ACCEL * dt);
    else vx *= Math.max(0, 1 - ICE_DRAG * dt);
    vx += windAccel * dt;
  } else {
    vx = approach(vx, target, AIR_ACCEL * dt) + windAccel * dt;
    vy -= GRAVITY * dt;
    y += vy * dt;
  }
  vx = clamp(vx, -MAX_SPEED, MAX_SPEED);
  const x = b.x + vx * dt;

  if (!grounded) {
    if (y <= 0 && vy <= 0 && supported(ice, x)) {
      y = 0;
      vy = 0;
      grounded = true;
    } else if (y <= -SINK_DEPTH) {
      return { ...b, x, y, vx, vy, grounded: false, alive: false, diedAt: now };
    }
  } else if (!supported(ice, x)) {
    // Le bord de la glace est passé sous les pieds : le personnage tombe.
    grounded = false;
    vy = 0;
  }

  return { ...b, x, y, vx, vy, grounded };
}

/**
 * Pousse le personnage devant `pusher` (dans son sens du regard), si la cible est à portée,
 * à la bonne hauteur, et si la poussée est prête. Renvoie les deux personnages mis à jour, ou null.
 */
export function push(pusher: Body, target: Body, now: number): { pusher: Body; target: Body } | null {
  if (!pusher.alive || !target.alive || now < pusher.pushReadyAt) return null;
  const dx = target.x - pusher.x;
  if (Math.sign(dx) !== pusher.facing || Math.abs(dx) > PUSH_RANGE) return null;
  if (Math.abs(target.y - pusher.y) > PUSH_HEIGHT) return null;
  return {
    pusher: {
      ...pusher,
      pushReadyAt: now + PUSH_COOLDOWN_MS,
      pushingUntil: now + PUSH_FX_MS,
    },
    target: {
      ...target,
      vx: clamp(target.vx + pusher.facing * PUSH_SPEED, -MAX_SPEED, MAX_SPEED),
      pushedUntil: now + PUSH_FX_MS,
    },
  };
}

/**
 * Empêche les personnages de se traverser. Quand deux personnages se heurtent, leur vitesse
 * horizontale se partage : c'est ainsi qu'une poussée se transmet à la file. L'ordre de
 * traitement suit l'ordre du tableau, donc il doit être stable (le serveur le trie par identifiant).
 */
export function separate(bodies: Body[]): Body[] {
  const out = bodies.map((b) => ({ ...b }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!;
      const b = out[j]!;
      if (!a.alive || !b.alive) continue;
      if (Math.abs(a.y - b.y) >= 0.8) continue;
      const dx = b.x - a.x;
      const gap = 2 * BODY_HALF - Math.abs(dx);
      if (gap <= 0) continue;
      const sign = dx >= 0 ? 1 : -1;
      // Le personnage de gauche part vers la gauche, celui de droite vers la droite.
      a.x -= (sign * gap) / 2;
      b.x += (sign * gap) / 2;
      if (a.vx > b.vx && sign > 0) {
        const shared = (a.vx + b.vx) / 2;
        a.vx = shared;
        b.vx = shared;
      } else if (a.vx < b.vx && sign < 0) {
        const shared = (a.vx + b.vx) / 2;
        a.vx = shared;
        b.vx = shared;
      }
    }
  }
  return out;
}

/** Glace de départ d'un niveau. Niveau 1 : pleine. Niveaux 2 et 3 : des trous de 1 ou 2 colonnes. */
export function makeIce(withHoles: boolean, random: () => number): string {
  const cells = new Array<string>(WIDTH).fill(ICE);
  if (!withHoles) return cells.join('');
  // Trois colonnes pleines à chaque bord ; entre deux trous, au moins deux colonnes de glace.
  let col = 3;
  for (;;) {
    const run = 2 + Math.floor(random() * 2);
    const width = random() < 0.5 ? 1 : 2;
    if (col + run + width > WIDTH - 3) break;
    col += run;
    for (let k = 0; k < width; k++) cells[col + k] = WATER;
    col += width;
  }
  return cells.join('');
}

/** Largeur de chaque trou de la glace, dans l'ordre (pour les tests et l'affichage). */
export function holeWidths(ice: string): number[] {
  const widths: number[] = [];
  let run = 0;
  for (const c of ice) {
    if (c === WATER) run++;
    else if (run > 0) {
      widths.push(run);
      run = 0;
    }
  }
  return widths;
}

/**
 * Positions de départ : `n` colonnes de glace, réparties sur la partie centrale de la banquise.
 * Les bords ne servent jamais de départ : la fonte les emporte en premier.
 */
export function spawnColumns(ice: string, n: number): number[] {
  const inner: number[] = [];
  for (let c = SPAWN_MARGIN; c < ice.length - SPAWN_MARGIN; c++) if (ice[c] === ICE) inner.push(c);
  const ground = inner.length >= n ? inner : Array.from(ice.split('').keys()).filter((c) => ice[c] === ICE);
  if (n <= 1) return ground.slice(0, 1);
  const cols: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (ground.length - 1)) / (n - 1));
    cols.push(ground[idx]!);
  }
  return cols;
}

/** Fonte : retire la colonne de glace la plus au bord, à gauche ou à droite (au hasard). */
export function erode(ice: string, random: () => number): string {
  const first = ice.indexOf(ICE);
  if (first === -1) return ice;
  const last = ice.lastIndexOf(ICE);
  const takeLeft = random() < 0.5;
  const col = takeLeft ? first : last;
  return ice.slice(0, col) + WATER + ice.slice(col + 1);
}

/** Phase du vent : calme, annonce (la direction est montrée) puis rafale (elle souffle). */
export type WindPhase = 'calm' | 'warning' | 'gust';

export interface Wind {
  phase: WindPhase;
  dir: -1 | 1;
  strength: number;
  until: number;
}

/** Accélération horizontale du vent à cet instant (0 hors rafale). */
export function windAccel(wind: Wind | null): number {
  if (!wind || wind.phase !== 'gust') return 0;
  return wind.dir * wind.strength * WIND_ACCEL;
}
