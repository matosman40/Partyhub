/**
 * Tennis party : un terrain carré vu du dessus. Chaque joueur défend un côté avec sa raquette, qui glisse le long
 * de ce côté. Le téléphone la commande par son inclinaison (ou par des boutons).
 *
 * Ce fichier est pur (ni DOM ni réseau) : l’écran principal fait avancer la balle à chaque image, le serveur
 * valide chaque coup et chaque balle perdue, et les tests vérifient les règles sans navigateur.
 *
 * Coordonnées : le terrain va de 0 à 1 sur les deux axes, l’axe y descend vers le bas de l’écran. Une commande
 * de raquette `aim` vaut -1 pour le côté le plus proche du haut ou de la gauche de l’écran, +1 pour l’autre.
 */

export type Side = 0 | 1 | 2 | 3;
/** Ordre des sièges : bas, haut, gauche, droite. Deux joueurs occupent bas et haut, face à face. */
export const SIDES: readonly Side[] = [0, 1, 2, 3];
export const SIDE_NAMES = ['bas', 'haut', 'gauche', 'droite'] as const;

/** Distance entre le bord et la ligne de frappe de la raquette. */
export const INSET = 0.035;
/** Demi-longueur de la raquette, le long de son côté. */
export const RACKET_HALF = 0.1;
export const BALL_R = 0.016;
export const BASE_SPEED = 0.42;
export const MAX_SPEED = 1.05;
/** Accélération de la balle à chaque coup. */
export const SPEED_UP = 1.04;
/** Vitesse de déplacement d’une raquette commandée, en fraction du terrain par seconde. */
export const RACKET_SPEED = 2.4;
/** Vitesse d’une raquette automatique (joueur sans téléphone, robot) : plus lente, donc elle rate parfois. */
export const AUTO_SPEED = 0.95;
/** Erreur de visée maximale de l’automate, tirée à chaque service. */
export const AUTO_BIAS = 0.1;
/**
 * Chance qu’un automate rate une balle qui arrive devant lui. Sans cette erreur, un robot renvoie presque toute la
 * balle : un échange dure deux minutes, et un match aux règles du tennis ne se termine pas.
 */
export const AUTO_MISS = 0.18;
export const SERVE_DELAY_MS = 1000;
/** Pas de calcul maximal, en secondes : au-delà, la balle pourrait franchir une ligne sans la voir. */
export const MAX_STEP_S = 0.05;
/** Effet de la position de frappe sur la direction de la balle. */
const SPIN = 0.45;
/** Gain de l’inclinaison : le téléphone penché à fond fait parcourir presque tout le côté à la raquette. */
export const TILT_GAIN = 1.4;

/** Sens de l’inclinaison pour chaque côté, vu par le joueur (sa droite). */
const TILT_SIGN: Record<Side, number> = { 0: 1, 1: -1, 2: 1, 3: -1 };
/** Sens vers l’extérieur du terrain, pour chaque côté. */
const OUT: Record<Side, number> = { 0: 1, 1: -1, 2: -1, 3: 1 };
/** Ligne de frappe, et mur quand le côté n’est plus défendu. */
const PLANE: Record<Side, number> = { 0: 1 - INSET, 1: INSET, 2: INSET, 3: 1 - INSET };
const WALL: Record<Side, number> = { 0: 1 - BALL_R, 1: BALL_R, 2: BALL_R, 3: 1 - BALL_R };
/** Direction de départ de la balle vers chaque côté. */
const DIR: Record<Side, { x: number; y: number }> = {
  0: { x: 0, y: 1 },
  1: { x: 0, y: -1 },
  2: { x: -1, y: 0 },
  3: { x: 1, y: 0 },
};

export const isHorizontal = (side: Side): boolean => side === 0 || side === 1;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Commande de raquette à partir de l’inclinaison du téléphone (de -1 à 1 sur chaque axe). Horizontal pour les côtés
 * bas et haut, en avant ou en arrière pour les côtés gauche et droite.
 */
export function aimFromTilt(side: Side, tilt: { x: number; y: number }): number {
  const raw = isHorizontal(side) ? tilt.x : tilt.y;
  return clamp(raw * TILT_SIGN[side] * TILT_GAIN, -1, 1);
}

/** Position de la raquette le long de son côté, pour une commande donnée. */
export function racketTarget(aim: number): number {
  return 0.5 + clamp(aim, -1, 1) * (0.5 - RACKET_HALF);
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Vitesse courante, en fraction du terrain par seconde. */
  speed: number;
}

export type RallyEvent = { type: 'hit'; side: Side } | { type: 'lost'; side: Side };

/** Un échange en cours. Muable, car l’écran principal le fait avancer à chaque image. */
export interface Rally {
  ball: Ball;
  /** Côtés défendus par une raquette (joueur vivant). Les autres sont des murs. */
  active: boolean[];
  /** Position de chaque raquette le long de son côté, entre RACKET_HALF et 1 - RACKET_HALF. */
  pos: number[];
  /** Commande du téléphone, de -1 à 1 ; null quand il ne répond pas : la raquette devient automatique. */
  aim: (number | null)[];
  /** Erreur de visée de l’automate, par côté, tirée à chaque service. */
  bias: number[];
  /** Tirage de l’automate pour ses ratés (AUTO_MISS). Absent : pas de raté, donc un échange déterministe. */
  rng?: () => number;
}

/**
 * Balle de service : au centre, vers un côté défendu. Le côté `toward` (celui du joueur qui reçoit) si on le connaît
 * et qu’il est défendu ; sinon un côté défendu tiré au hasard.
 */
export function serve(active: boolean[], rng: () => number, toward?: Side): Ball {
  const open = SIDES.filter((s) => active[s]);
  const pool = open.length > 0 ? open : SIDES;
  const side = toward !== undefined && active[toward] ? toward : (pool[Math.floor(rng() * pool.length)] ?? 0);
  const dir = DIR[side];
  const angle = Math.atan2(dir.y, dir.x) + (rng() - 0.5) * 1.0;
  return {
    x: 0.5,
    y: 0.5,
    vx: Math.cos(angle) * BASE_SPEED,
    vy: Math.sin(angle) * BASE_SPEED,
    speed: BASE_SPEED,
  };
}

/** Un échange neuf : raquettes au centre, service vers le côté `toward` (ou vers un côté défendu au hasard). */
export function createRally(active: boolean[], rng: () => number, toward?: Side): Rally {
  return {
    ball: serve(active, rng, toward),
    active: [...active],
    pos: SIDES.map(() => 0.5),
    aim: SIDES.map(() => null),
    bias: SIDES.map(() => (rng() * 2 - 1) * AUTO_BIAS),
    rng,
  };
}

/** Écrit les composantes de la balle pour un côté : profondeur, vitesse en profondeur, vitesse le long du côté. */
function put(side: Side, b: Ball, depth: number, vDepth: number, vAlong: number): void {
  if (isHorizontal(side)) {
    b.y = depth;
    b.vy = vDepth;
    b.vx = vAlong;
  } else {
    b.x = depth;
    b.vx = vDepth;
    b.vy = vAlong;
  }
}

/** Déplace les raquettes de `h` secondes : vers la commande du téléphone, ou vers la balle pour un automate. */
export function moveRackets(r: Rally, h: number): void {
  const b = r.ball;
  for (const side of SIDES) {
    if (!r.active[side]) continue;
    const horiz = isHorizontal(side);
    const along = horiz ? b.x : b.y;
    const aim = r.aim[side];
    let target: number;
    let speed: number;
    if (aim !== null) {
      target = racketTarget(aim);
      speed = RACKET_SPEED;
    } else {
      const vDepth = horiz ? b.vy : b.vx;
      const toward = OUT[side] * vDepth > 0;
      target = toward ? clamp(along + (r.bias[side] ?? 0), RACKET_HALF, 1 - RACKET_HALF) : 0.5;
      speed = AUTO_SPEED;
    }
    const current = r.pos[side] ?? 0.5;
    const step = speed * h;
    r.pos[side] = clamp(current + clamp(target - current, -step, step), RACKET_HALF, 1 - RACKET_HALF);
  }
}

/**
 * Fait avancer l’échange de `dt` secondes. Renvoie les coups réussis, et une balle perdue qui termine l’échange
 * (le ou les événements suivants n’ont alors plus de sens : l’appelant relance un service).
 */
export function stepRally(r: Rally, dt: number): RallyEvent[] {
  const h = clamp(dt, 0, MAX_STEP_S);
  moveRackets(r, h);
  const b = r.ball;
  b.x += b.vx * h;
  b.y += b.vy * h;

  const events: RallyEvent[] = [];
  for (const side of SIDES) {
    const horiz = isHorizontal(side);
    const out = OUT[side];
    const depth = horiz ? b.y : b.x;
    const vDepth = horiz ? b.vy : b.vx;
    const vAlong = horiz ? b.vx : b.vy;
    // Seul un mouvement vers l’extérieur peut franchir la ligne.
    if (out * vDepth <= 0) continue;

    if (!r.active[side]) {
      // Côté sans raquette : la balle rebondit contre le bord.
      const wall = WALL[side];
      if (out * (depth - wall) < 0) continue;
      put(side, b, wall, -vDepth, vAlong);
      continue;
    }

    const plane = PLANE[side];
    if (out * (depth - plane) < 0) continue;
    const along = horiz ? b.x : b.y;
    const offset = along - (r.pos[side] ?? 0.5);
    // Un automate (sans téléphone) peut rater la balle, même bien placé.
    const automatic = r.aim[side] === null;
    const missed = automatic && r.rng !== undefined && r.rng() < AUTO_MISS;
    if (missed || Math.abs(offset) > RACKET_HALF + BALL_R) {
      events.push({ type: 'lost', side });
      return events;
    }

    // Coup : la balle repart vers l’intérieur, plus vite, et son angle dépend de l’endroit touché.
    const k = clamp(offset / RACKET_HALF, -1, 1);
    const speed = Math.min(MAX_SPEED, b.speed * SPEED_UP);
    const vA = vAlong + k * SPIN * speed;
    const vD = -vDepth;
    const mag = Math.hypot(vA, vD) || 1;
    b.speed = speed;
    put(side, b, plane, (vD * speed) / mag, (vA * speed) / mag);
    events.push({ type: 'hit', side });
  }
  return events;
}
