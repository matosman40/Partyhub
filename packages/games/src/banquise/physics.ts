/**
 * Banquise : physique en deux dimensions, en fonctions pures et déterministes.
 *
 * Unités : une case de glace vaut 1. Un personnage est en (x, z) sur le plan : la case (col, row) a son centre
 * en (col + 0.5, row + 0.5). `y` est sa hauteur au-dessus de la surface de la glace. Tout ce qui est aléatoire
 * passe par le générateur injecté, et tout ce qui dépend du temps par `now` : rien ici ne lit l'horloge réelle.
 * Les valeurs sont celles de docs/JEU-BANQUISE.md.
 */

/** Taille de la grille : l'îlot tient dedans, avec des coins vides (contour arrondi). */
export const COLS = 11;
export const ROWS = 9;
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
/** Écart latéral maximal entre le pousseur et sa cible, perpendiculairement à la poussée. */
export const PUSH_LATERAL = 0.6;
export const PUSH_HEIGHT = 0.7;
export const PUSH_COOLDOWN_MS = 1200;
/** Durée pendant laquelle l'attitude « poussée » reste affichée. */
export const PUSH_FX_MS = 400;
export const BODY_HALF = 0.35;
export const FOOT = 0.3;
export const SINK_DEPTH = 0.6;
export const MAX_SPEED = 8;
export const ICE = 'i';
export const WATER = '.';

export type Dir = -1 | 0 | 1;

export interface Body {
  x: number;
  z: number;
  /** Hauteur au-dessus de la glace (saut). */
  y: number;
  vx: number;
  vz: number;
  vy: number;
  /** Sens horizontal du regard, pour le dessin. */
  facing: -1 | 1;
  /** Direction demandée par le joueur (maintenue), sur chaque axe. */
  dirX: Dir;
  dirZ: Dir;
  /** Dernière direction de marche : la poussée part de ce côté. */
  aimX: Dir;
  aimZ: Dir;
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

export function newBody(x: number, z: number, facing: -1 | 1): Body {
  return {
    x,
    z,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    facing,
    dirX: 0,
    dirZ: 0,
    aimX: facing,
    aimZ: 0,
    grounded: true,
    alive: true,
    pushReadyAt: 0,
    pushingUntil: 0,
    pushedUntil: 0,
    diedAt: null,
  };
}

const NEIGHBORS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Carré du rayon normalisé du centre de l'îlot : 0 au centre, 1 sur le contour. */
function radius2(col: number, row: number): number {
  const nx = (col + 0.5 - COLS / 2) / (COLS / 2);
  const nz = (row + 0.5 - ROWS / 2) / (ROWS / 2);
  return nx * nx + nz * nz;
}

/** Vrai si la case (col, row) fait partie de l'îlot : une ellipse, donc un contour arrondi. */
export function inMask(col: number, row: number): boolean {
  return radius2(col, row) <= 1;
}

/** Vrai si la case (col, row) est dans la partie centrale, loin du bord. */
function isInner(col: number, row: number): boolean {
  return radius2(col, row) <= 0.5;
}

/** Glace sous le point (x, z) : hors de la grille, c'est de l'eau. */
export function iceAt(ice: string, x: number, z: number): boolean {
  const col = Math.floor(x);
  const row = Math.floor(z);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
  return ice[row * COLS + col] === ICE;
}

/** Vrai si au moins un pied repose sur la glace. */
export function supported(ice: string, x: number, z: number): boolean {
  return (
    iceAt(ice, x - FOOT, z - FOOT) ||
    iceAt(ice, x + FOOT, z - FOOT) ||
    iceAt(ice, x - FOOT, z + FOOT) ||
    iceAt(ice, x + FOOT, z + FOOT)
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Rapproche `v` de `target` d'au plus `maxDelta`, sans le dépasser. */
function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

export function setInput(b: Body, dx: Dir, dz: Dir): Body {
  if (!b.alive) return b;
  const moving = dx !== 0 || dz !== 0;
  return {
    ...b,
    dirX: dx,
    dirZ: dz,
    facing: dx !== 0 ? dx : b.facing,
    aimX: moving ? dx : b.aimX,
    aimZ: moving ? dz : b.aimZ,
  };
}

/** Saut : seulement au sol, pour un personnage vivant. */
export function jump(b: Body): Body {
  if (!b.alive || !b.grounded) return b;
  return { ...b, grounded: false, vy: JUMP_SPEED };
}

/** Direction de la poussée : le dernier mouvement, ramené à une longueur de 1. */
export function aimVector(b: Body): { ax: number; az: number } {
  const len = Math.hypot(b.aimX, b.aimZ) || 1;
  return { ax: b.aimX / len, az: b.aimZ / len };
}

/**
 * Avance un personnage de `dt` secondes. `windAccel` est l'accélération horizontale du vent
 * (0 hors rafale). Renvoie un nouveau personnage ; un personnage éliminé ne bouge plus.
 */
export function stepBody(b: Body, ice: string, now: number, dt: number, windAccel: number): Body {
  if (!b.alive) return b;
  // En diagonale, la vitesse reste la même que tout droit.
  const diag = b.dirX !== 0 && b.dirZ !== 0 ? Math.SQRT1_2 : 1;
  const targetX = b.dirX * WALK_SPEED * diag;
  const targetZ = b.dirZ * WALK_SPEED * diag;
  let vx = b.vx;
  let vz = b.vz;
  let vy = b.vy;
  let y = b.y;
  let grounded = b.grounded;

  if (grounded) {
    vx = b.dirX !== 0 ? approach(vx, targetX, ICE_ACCEL * dt) : vx * Math.max(0, 1 - ICE_DRAG * dt);
    vz = b.dirZ !== 0 ? approach(vz, targetZ, ICE_ACCEL * dt) : vz * Math.max(0, 1 - ICE_DRAG * dt);
    vx += windAccel * dt;
  } else {
    vx = approach(vx, targetX, AIR_ACCEL * dt) + windAccel * dt;
    vz = approach(vz, targetZ, AIR_ACCEL * dt);
    vy -= GRAVITY * dt;
    y += vy * dt;
  }
  vx = clamp(vx, -MAX_SPEED, MAX_SPEED);
  vz = clamp(vz, -MAX_SPEED, MAX_SPEED);
  const x = b.x + vx * dt;
  const z = b.z + vz * dt;

  if (!grounded) {
    if (y <= 0 && vy <= 0 && supported(ice, x, z)) {
      y = 0;
      vy = 0;
      grounded = true;
    } else if (y <= -SINK_DEPTH) {
      return { ...b, x, z, y, vx, vz, vy, grounded: false, alive: false, diedAt: now };
    }
  } else if (!supported(ice, x, z)) {
    // Le bord de la glace est passé sous les pieds : le personnage tombe.
    grounded = false;
    vy = 0;
  }

  return { ...b, x, z, y, vx, vz, vy, grounded };
}

/**
 * Pousse le personnage devant `pusher` (dans sa direction de marche), si la cible est à portée,
 * à la bonne hauteur, et si la poussée est prête. Renvoie les deux personnages mis à jour, ou null.
 */
export function push(pusher: Body, target: Body, now: number): { pusher: Body; target: Body } | null {
  if (!pusher.alive || !target.alive || now < pusher.pushReadyAt) return null;
  const { ax, az } = aimVector(pusher);
  const dx = target.x - pusher.x;
  const dz = target.z - pusher.z;
  const along = dx * ax + dz * az;
  const lateral = Math.abs(-dx * az + dz * ax);
  if (along <= 0 || along > PUSH_RANGE || lateral > PUSH_LATERAL) return null;
  if (Math.abs(target.y - pusher.y) > PUSH_HEIGHT) return null;
  return {
    pusher: {
      ...pusher,
      pushReadyAt: now + PUSH_COOLDOWN_MS,
      pushingUntil: now + PUSH_FX_MS,
    },
    target: {
      ...target,
      vx: clamp(target.vx + ax * PUSH_SPEED, -MAX_SPEED, MAX_SPEED),
      vz: clamp(target.vz + az * PUSH_SPEED, -MAX_SPEED, MAX_SPEED),
      pushedUntil: now + PUSH_FX_MS,
    },
  };
}

/**
 * Empêche les personnages de se traverser. Quand deux personnages se heurtent, leur vitesse le long
 * de la ligne qui les relie se partage : c'est ainsi qu'une poussée se transmet à la file. L'ordre de
 * traitement suit l'ordre du tableau, donc il doit être stable (le serveur le trie par identifiant).
 */
export function separate(bodies: Body[]): Body[] {
  const out = bodies.map((b) => ({ ...b }));
  const minDist = 2 * BODY_HALF;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!;
      const b = out[j]!;
      if (!a.alive || !b.alive) continue;
      if (Math.abs(a.y - b.y) >= 0.8) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= minDist) continue;
      // Normale de a vers b. Deux personnages au même point : on les sépare vers la droite.
      const nx = d < 1e-6 ? 1 : dx / d;
      const nz = d < 1e-6 ? 0 : dz / d;
      const half = (minDist - d) / 2;
      a.x -= nx * half;
      a.z -= nz * half;
      b.x += nx * half;
      b.z += nz * half;
      const va = a.vx * nx + a.vz * nz;
      const vb = b.vx * nx + b.vz * nz;
      if (va > vb) {
        const shared = (va + vb) / 2;
        a.vx += (shared - va) * nx;
        a.vz += (shared - va) * nz;
        b.vx += (shared - vb) * nx;
        b.vz += (shared - vb) * nz;
      }
    }
  }
  return out;
}

/** Glace de départ d'un niveau : un îlot arrondi. Avec trous : quatre à six trous au centre. */
export function makeIce(withHoles: boolean, random: () => number): string {
  const cells: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) cells.push(inMask(col, row) ? ICE : WATER);
  }
  if (withHoles) {
    const inner: number[] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (isInner(col, row) && inMask(col, row)) inner.push(row * COLS + col);
      }
    }
    const count = 4 + Math.floor(random() * 3);
    for (let k = 0; k < count && inner.length > 0; k++) {
      const idx = inner[Math.floor(random() * inner.length)]!;
      const before = cells.join('');
      cells[idx] = WATER;
      // Une fois sur deux, le trou fait deux cases de large.
      const next = idx + 1;
      if (random() < 0.5 && inner.includes(next) && cells[next] === ICE) cells[next] = WATER;
      // Un trou qui couperait l'îlot en deux n'est pas gardé : il reste un seul morceau de glace.
      if (keepMainIsland(cells.join('')) !== cells.join('')) {
        for (let i = 0; i < cells.length; i++) cells[i] = before[i]!;
      }
    }
  }
  return cells.join('');
}

/** Nombre de trous (cases d'eau à l'intérieur de l'îlot). */
export function holeCount(ice: string): number {
  let n = 0;
  for (let i = 0; i < ice.length; i++) {
    if (ice[i] === WATER && inMask(i % COLS, Math.floor(i / COLS))) n++;
  }
  return n;
}

/**
 * Positions de départ : `n` cases de glace, réparties en anneau autour du centre, à l'écart du bord.
 * Renvoie l'indice de chaque case (row * COLS + col).
 */
export function spawnCells(ice: string, n: number): number[] {
  const ring: number[] = [];
  const all: number[] = [];
  for (let i = 0; i < ice.length; i++) {
    if (ice[i] !== ICE) continue;
    all.push(i);
    const r2 = radius2(i % COLS, Math.floor(i / COLS));
    if (r2 >= 0.2 && r2 <= 0.75) ring.push(i);
  }
  const pool = ring.length >= n ? ring : all;
  const angle = (i: number) => Math.atan2(Math.floor(i / COLS) + 0.5 - ROWS / 2, (i % COLS) + 0.5 - COLS / 2);
  pool.sort((a, b) => angle(a) - angle(b));
  if (n <= 1) return pool.slice(0, 1);
  const step = pool.length / n;
  return Array.from({ length: n }, (_, k) => pool[Math.floor(k * step)]!);
}

/** Garde seulement la plus grande partie de glace reliée ; le reste part à l'eau. */
export function keepMainIsland(ice: string): string {
  const seen = new Array<boolean>(ice.length).fill(false);
  let best: number[] = [];
  for (let i = 0; i < ice.length; i++) {
    if (ice[i] !== ICE || seen[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = true;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      const col = cur % COLS;
      const row = Math.floor(cur / COLS);
      for (const [dc, dr] of NEIGHBORS) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
        const j = r * COLS + c;
        if (!seen[j] && ice[j] === ICE) {
          seen[j] = true;
          stack.push(j);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  const keep = new Set(best);
  let out = '';
  for (let i = 0; i < ice.length; i++) out += ice[i] === ICE && !keep.has(i) ? WATER : ice[i];
  return out;
}

/** Vrai si la case est au bord de la glace : une case vide ou la sortie de la grille est voisine. */
function isRim(ice: string, col: number, row: number): boolean {
  return NEIGHBORS.some(([dc, dr]) => {
    const c = col + dc;
    const r = row + dr;
    return c < 0 || c >= COLS || r < 0 || r >= ROWS || ice[r * COLS + c] !== ICE;
  });
}

/** Fonte : une case de glace du bord, prise au hasard, passe à l'eau. Les morceaux coupés suivent. */
export function erode(ice: string, random: () => number): string {
  const rim: number[] = [];
  for (let i = 0; i < ice.length; i++) {
    if (ice[i] === ICE && isRim(ice, i % COLS, Math.floor(i / COLS))) rim.push(i);
  }
  if (rim.length === 0) return ice;
  const idx = rim[Math.floor(random() * rim.length)]!;
  return keepMainIsland(ice.slice(0, idx) + WATER + ice.slice(idx + 1));
}

/** Phase du vent : calme, annonce (la direction est montrée) puis rafale (elle souffle). */
export type WindPhase = 'calm' | 'warning' | 'gust';

export interface Wind {
  phase: WindPhase;
  dir: -1 | 1;
  strength: number;
  until: number;
}

/** Accélération horizontale du vent à cet instant (0 hors rafale). Le vent ne souffle que sur l'axe x. */
export function windAccel(wind: Wind | null): number {
  if (!wind || wind.phase !== 'gust') return 0;
  return wind.dir * wind.strength * WIND_ACCEL;
}
