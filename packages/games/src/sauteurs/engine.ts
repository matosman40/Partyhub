/**
 * Moteur « Course des sauteurs » : pur, déterministe, sans DOM ni temps réel.
 *
 * Unités : les distances sont en CASES (une case = 1), les durées en PAS de 1/60 s,
 * les vitesses en cases par pas, les accélérations en cases par pas au carré.
 * L'axe y est dirigé vers le BAS (comme les lignes du niveau) : une vitesse verticale négative monte.
 * La position d'un coureur est le milieu de ses pieds : `x` = centre horizontal, `y` = plante des pieds.
 * Les coureurs sont des fantômes les uns pour les autres : aucune collision entre eux. Les pièces,
 * les blocs bonus et les ennemis écrasés sont comptés PAR coureur (chacun joue sa course) ; les ennemis
 * patrouillent de la même façon pour tous (leur trajet ne dépend que du pas).
 */

// ---------------------------------------------------------------------------------------------
// Constantes de physique
// ---------------------------------------------------------------------------------------------

/** Pas de simulation par seconde. */
export const TICKS_PER_SECOND = 60;
/** Demi-largeur de la boîte d'un coureur (largeur 0,56). */
export const PLAYER_HALF_WIDTH = 0.28;
/** Hauteur de la boîte d'un coureur. */
export const PLAYER_HEIGHT = 0.9;
/** Vitesse de course maximale (6,6 cases par seconde). */
export const MAX_RUN_SPEED = 0.11;
/** Accélération au sol quand on tient une direction. */
export const GROUND_ACCEL = 0.014;
/** Accélération en l'air (moins de contrôle). */
export const AIR_ACCEL = 0.009;
/** Frottement au sol quand on ne tient aucune direction. */
export const GROUND_FRICTION = 0.012;
/** Frottement en l'air. */
export const AIR_FRICTION = 0.003;
/** Multiplicateur d'accélération quand on freine au sol en inversant la direction. */
export const TURN_BOOST = 2;
/** Gravité. */
export const GRAVITY = 0.022;
/** Vitesse de chute maximale (inférieure à une case par pas, donc aucune traversée de sol). */
export const MAX_FALL_SPEED = 0.45;
/** Vitesse initiale d'un saut (hauteur maximale d'environ 3,4 cases bouton maintenu). */
export const JUMP_SPEED = 0.4;
/** Si on relâche le saut en montée, la vitesse montante est ramenée à cette valeur (hauteur mini d'environ 0,9 case). */
export const JUMP_CUT_SPEED = 0.19;
/** Pas de grâce après avoir quitté un bord pendant lesquels le saut reste possible. */
export const COYOTE_STEPS = 6;
/** Pas pendant lesquels une pression de saut trop tôt est mémorisée (tampon). */
export const JUMP_BUFFER_STEPS = 6;
/** Vitesse de décollage d'un ressort (environ 6,7 cases de haut). */
export const SPRING_SPEED = 0.54;
/** Rebond après avoir écrasé un ennemi. */
export const STOMP_BOUNCE = 0.28;
/** Rebond après avoir écrasé un ennemi en tenant le saut. */
export const STOMP_BOUNCE_HELD = 0.4;
/** Marge verticale (cases) sous le sommet d'un ennemi dans laquelle les pieds comptent comme « écraser ». */
export const STOMP_MARGIN = 0.5;
/** Vitesse de patrouille des ennemis. */
export const ENEMY_SPEED = 0.035;
/** Distance (cases) de part et d'autre de son point de départ sur laquelle un ennemi patrouille au plus. */
export const ENEMY_RANGE = 3;
/** Côté de la boîte carrée d'un ennemi. */
export const ENEMY_SIZE = 0.7;
/** Pas passés « au tapis » (animation hurt) après une mort avant de repartir. */
export const DEATH_TICKS = 45;
/** Pas d'invulnérabilité après un retour au point de contrôle. */
export const INVULN_TICKS = 120;
/** Un coureur dont les pieds dépassent le bas du niveau de cette marge est mort (chute dans le vide). */
export const VOID_MARGIN = 2;
/** Vitesse horizontale au-dessus de laquelle l'animation est « run ». */
export const RUN_ANIM_SPEED = 0.02;

const EPS = 1e-6;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export type LevelTheme = 'prairie' | 'grotte' | 'ciel';

export interface Level {
  id: string;
  name: string;
  theme: LevelTheme;
  /** Lignes du niveau (voir la légende), toutes de longueur `width`. */
  tiles: string[];
  width: number;
  height: number;
  /** Limite de temps en secondes. */
  timeLimit: number;
  /** Nombre maximal de pièces qu'un coureur peut ramasser (pièces `o` + blocs `?`). */
  maxCoins: number;
}

export type Anim = 'idle' | 'run' | 'jump' | 'fall' | 'hurt' | 'win';

/** Codes des cases dans `World.map`. */
export const TILE_AIR = 0;
export const TILE_SOLID = 1; // # et B
export const TILE_ONEWAY = 2; // =
export const TILE_SPIKE = 3; // ^
export const TILE_SPRING = 4; // J
export const TILE_CHECKPOINT = 5; // C
export const TILE_FLAG = 6; // F
export const TILE_BONUS = 7; // ? (solide)

/** Caractères de la légende reconnus par `validateLevel`. */
export const LEVEL_LEGEND = '.#B?=^oeJCSF';

export type GameEvent =
  | { type: 'jump'; id: string; x: number; y: number }
  | { type: 'coin'; id: string; x: number; y: number; source: 'tile' | 'block' }
  | { type: 'stomp'; id: string; x: number; y: number; enemy: number }
  | { type: 'spring'; id: string; x: number; y: number; spring: number }
  | { type: 'death'; id: string; x: number; y: number; cause: 'enemy' | 'spikes' | 'void' }
  | { type: 'checkpoint'; id: string; x: number; y: number; index: number }
  | { type: 'finish'; id: string; x: number; y: number; rank: number }
  | { type: 'timeup' };

export interface Enemy {
  /** Centre horizontal. */
  x: number;
  /** Plante des pieds. */
  y: number;
  /** 1 vers la droite, -1 vers la gauche. */
  dir: 1 | -1;
  /** Bornes de la patrouille (centre horizontal) : l'ennemi fait demi-tour en les atteignant. */
  minX: number;
  maxX: number;
}

export interface Pickup {
  x: number;
  y: number;
}

export interface Spring {
  col: number;
  row: number;
  /** Dernier pas où un coureur a appuyé dessus (-1 : jamais) ; sert à l'animation. */
  pressedTick: number;
}

export interface Checkpoint {
  col: number;
  row: number;
  /** Position de repli : milieu de la case, pieds au bas de la case. */
  x: number;
  y: number;
}

export interface PlayerState {
  id: string;
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dir: 1 | -1;
  onGround: boolean;
  anim: Anim;
  coins: number;
  deaths: number;
  dead: boolean;
  finished: boolean;
  finishTick: number | null;
  /** Rang d'arrivée (1 = premier) ou null. */
  rank: number | null;
  /** Pas restants d'invulnérabilité. */
  invuln: number;
  /** Pas restants avant le retour après une mort. */
  respawn: number;
  /** Indice du dernier point de contrôle atteint (-1 : le départ). */
  checkpointIndex: number;
  checkpointX: number;
  checkpointY: number;
  /** Pièces libres déjà prises (même ordre que `World.coins`). */
  coinTaken: boolean[];
  /** Blocs bonus déjà frappés (même ordre que `World.blocks`). */
  blockHit: boolean[];
  /** Ennemis déjà écrasés (même ordre que `World.enemies`). */
  stomped: boolean[];
  // État interne des commandes.
  coyote: number;
  jumpBuffer: number;
  prevJump: boolean;
  cuttable: boolean;
}

export interface World {
  level: Level;
  width: number;
  height: number;
  /** Codes `TILE_*`, indexés `row * width + col`. */
  map: Uint8Array;
  tick: number;
  timeLimitTicks: number;
  timeUp: boolean;
  /** Vrai quand la course est terminée (tous arrivés ou temps écoulé) : `step` ne fait plus rien. */
  over: boolean;
  starts: Pickup[];
  /** Pièces libres (`o`) : centre de la case. */
  coins: Pickup[];
  /** Blocs bonus (`?`) : coin haut-gauche de la case (col, row). */
  blocks: { col: number; row: number }[];
  springs: Spring[];
  checkpoints: Checkpoint[];
  enemies: Enemy[];
  players: PlayerState[];
  /** Identifiants dans l'ordre d'arrivée. */
  finishOrder: string[];
  /** Événements du dernier pas (vidé au début de chaque pas). */
  events: GameEvent[];
}

export interface PlayerSummary {
  x: number;
  y: number;
  coins: number;
  finished: boolean;
  finishTick: number | null;
  deaths: number;
  alive: boolean;
}

// ---------------------------------------------------------------------------------------------
// Niveaux
// ---------------------------------------------------------------------------------------------

/** Contrôle la forme d'un niveau ; renvoie la liste des erreurs (vide si valide). */
export function validateLevel(level: Level): string[] {
  const errors: string[] = [];
  const { tiles } = level;
  if (!level.id || !level.name) errors.push('id et nom requis');
  if (tiles.length !== level.height) errors.push(`hauteur ${tiles.length} différente de height ${level.height}`);
  let starts = 0;
  let coins = 0;
  const flagCells: [number, number][] = [];
  tiles.forEach((row, r) => {
    if (row.length !== level.width) errors.push(`ligne ${r} : longueur ${row.length} au lieu de ${level.width}`);
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (!LEVEL_LEGEND.includes(ch)) errors.push(`ligne ${r} colonne ${c} : caractère inconnu « ${ch} »`);
      if (ch === 'S') starts++;
      if (ch === 'o' || ch === '?') coins++;
      if (ch === 'F') flagCells.push([c, r]);
    }
  });
  if (starts < 1) errors.push('aucun départ S');
  if (flagCells.length < 1) errors.push('aucune arrivée F (fanion)');
  else {
    const col = flagCells[0]![0];
    if (flagCells.some(([c]) => c !== col)) errors.push('les F doivent être dans une seule colonne');
    const rows = flagCells.map(([, r]) => r).sort((a, b) => a - b);
    if (rows[rows.length - 1]! - rows[0]! !== rows.length - 1) errors.push('les F doivent être contigus');
  }
  if (level.maxCoins !== coins) errors.push(`maxCoins ${level.maxCoins} différent du nombre de pièces ${coins}`);
  if (!(level.timeLimit > 0)) errors.push('limite de temps invalide');
  return errors;
}

const CODES: Record<string, number> = {
  '#': TILE_SOLID,
  B: TILE_SOLID,
  '?': TILE_BONUS,
  '=': TILE_ONEWAY,
  '^': TILE_SPIKE,
  J: TILE_SPRING,
  C: TILE_CHECKPOINT,
  F: TILE_FLAG,
};

// ---------------------------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------------------------

export function createWorld(level: Level, playerIds: string[]): World {
  const { width, height } = level;
  const map = new Uint8Array(width * height);
  const starts: Pickup[] = [];
  const coins: Pickup[] = [];
  const blocks: { col: number; row: number }[] = [];
  const springs: Spring[] = [];
  const checkpoints: Checkpoint[] = [];
  const enemies: Enemy[] = [];
  for (let r = 0; r < height; r++) {
    const line = level.tiles[r] ?? '';
    for (let c = 0; c < width; c++) {
      const ch = line[c] ?? '.';
      map[r * width + c] = CODES[ch] ?? TILE_AIR;
      if (ch === 'S') starts.push({ x: c + 0.5, y: r + 1 });
      else if (ch === 'o') coins.push({ x: c + 0.5, y: r + 0.5 });
      else if (ch === '?') blocks.push({ col: c, row: r });
      else if (ch === 'J') springs.push({ col: c, row: r, pressedTick: -1 });
      else if (ch === 'C') checkpoints.push({ col: c, row: r, x: c + 0.5, y: r + 1 });
      else if (ch === 'e')
        enemies.push({ x: c + 0.5, y: r + 1, dir: -1, minX: c + 0.5 - ENEMY_RANGE, maxX: c + 0.5 + ENEMY_RANGE });
    }
  }
  if (starts.length === 0) starts.push({ x: 1.5, y: height - 2 });
  const world: World = {
    level,
    width,
    height,
    map,
    tick: 0,
    timeLimitTicks: Math.round(level.timeLimit * TICKS_PER_SECOND),
    timeUp: false,
    over: false,
    starts,
    coins,
    blocks,
    springs,
    checkpoints,
    enemies,
    players: [],
    finishOrder: [],
    events: [],
  };
  playerIds.forEach((id, index) => {
    const s = starts[index % starts.length]!;
    world.players.push({
      id,
      index,
      x: s.x,
      y: s.y,
      vx: 0,
      vy: 0,
      dir: 1,
      onGround: standsOnGround(world, s.x, s.y),
      anim: 'idle',
      coins: 0,
      deaths: 0,
      dead: false,
      finished: false,
      finishTick: null,
      rank: null,
      invuln: 0,
      respawn: 0,
      checkpointIndex: -1,
      checkpointX: s.x,
      checkpointY: s.y,
      coinTaken: coins.map(() => false),
      blockHit: blocks.map(() => false),
      stomped: enemies.map(() => false),
      coyote: 0,
      jumpBuffer: 0,
      prevJump: false,
      cuttable: false,
    });
  });
  return world;
}

function standsOnGround(w: World, x: number, y: number): boolean {
  const below = tileAt(w, Math.floor(x), Math.round(y));
  return isSolid(below) || below === TILE_ONEWAY;
}

/** Copie profonde du monde (la carte et le niveau, immuables, sont partagés). Sert aux simulations d'essai. */
export function cloneWorld(world: World): World {
  return {
    ...world,
    springs: world.springs.map((s) => ({ ...s })),
    enemies: world.enemies.map((e) => ({ ...e })),
    players: world.players.map((p) => ({
      ...p,
      coinTaken: p.coinTaken.slice(),
      blockHit: p.blockHit.slice(),
      stomped: p.stomped.slice(),
    })),
    finishOrder: world.finishOrder.slice(),
    events: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

function tileAt(w: World, c: number, r: number): number {
  if (c < 0 || c >= w.width) return TILE_SOLID; // murs invisibles de chaque côté
  if (r < 0 || r >= w.height) return TILE_AIR;
  return w.map[r * w.width + c]!;
}

function isSolid(code: number): boolean {
  return code === TILE_SOLID || code === TILE_BONUS;
}

// ---------------------------------------------------------------------------------------------
// Ennemis
// ---------------------------------------------------------------------------------------------

function stepEnemies(w: World): void {
  const half = ENEMY_SIZE / 2;
  for (const e of w.enemies) {
    const nx = e.x + e.dir * ENEMY_SPEED;
    const front = Math.floor(nx + e.dir * half);
    const bodyRow = Math.floor(e.y - half);
    const groundRow = Math.floor(e.y + 0.1);
    const wall = isSolid(tileAt(w, front, bodyRow));
    const below = tileAt(w, front, groundRow);
    const ground = isSolid(below) || below === TILE_ONEWAY;
    if (wall || !ground || nx < e.minX || nx > e.maxX) e.dir = (e.dir === 1 ? -1 : 1) as 1 | -1;
    else e.x = nx;
  }
}

// ---------------------------------------------------------------------------------------------
// Coureurs
// ---------------------------------------------------------------------------------------------

const NEUTRAL: PlayerInput = { left: false, right: false, jump: false };

function die(w: World, p: PlayerState, cause: 'enemy' | 'spikes' | 'void'): void {
  p.dead = true;
  p.deaths++;
  p.respawn = DEATH_TICKS;
  p.vx = 0;
  p.vy = 0;
  p.anim = 'hurt';
  p.jumpBuffer = 0;
  w.events.push({ type: 'death', id: p.id, x: p.x, y: p.y, cause });
}

function respawn(p: PlayerState): void {
  p.dead = false;
  p.x = p.checkpointX;
  p.y = p.checkpointY;
  p.vx = 0;
  p.vy = 0;
  p.onGround = true;
  p.coyote = 0;
  p.jumpBuffer = 0;
  p.invuln = INVULN_TICKS;
  p.anim = 'idle';
}

function moveX(w: World, p: PlayerState): void {
  if (p.vx === 0) return;
  p.x += p.vx;
  const top = Math.floor(p.y - PLAYER_HEIGHT + EPS);
  const bottom = Math.floor(p.y - EPS);
  if (p.vx > 0) {
    const col = Math.floor(p.x + PLAYER_HALF_WIDTH);
    for (let r = top; r <= bottom; r++) {
      if (isSolid(tileAt(w, col, r))) {
        p.x = col - PLAYER_HALF_WIDTH - EPS;
        p.vx = 0;
        return;
      }
    }
  } else {
    const col = Math.floor(p.x - PLAYER_HALF_WIDTH);
    for (let r = top; r <= bottom; r++) {
      if (isSolid(tileAt(w, col, r))) {
        p.x = col + 1 + PLAYER_HALF_WIDTH + EPS;
        p.vx = 0;
        return;
      }
    }
  }
}

function moveY(w: World, p: PlayerState): void {
  const prevY = p.y;
  p.y += p.vy;
  const c0 = Math.floor(p.x - PLAYER_HALF_WIDTH + EPS);
  const c1 = Math.floor(p.x + PLAYER_HALF_WIDTH - EPS);
  if (p.vy > 0) {
    const row = Math.floor(p.y);
    for (let c = c0; c <= c1; c++) {
      const code = tileAt(w, c, row);
      if (isSolid(code) || (code === TILE_ONEWAY && prevY <= row + EPS)) {
        p.y = row;
        p.vy = 0;
        p.onGround = true;
        return;
      }
    }
  } else if (p.vy < 0) {
    const row = Math.floor(p.y - PLAYER_HEIGHT);
    let hit = false;
    let bonusCol = -1;
    for (let c = c0; c <= c1; c++) {
      const code = tileAt(w, c, row);
      if (isSolid(code)) {
        hit = true;
        // Bloc bonus frappé : celui qui est sous le centre du coureur en priorité.
        if (code === TILE_BONUS && (bonusCol < 0 || c === Math.floor(p.x))) bonusCol = c;
      }
    }
    if (hit) {
      p.y = row + 1 + PLAYER_HEIGHT + EPS;
      p.vy = 0;
      if (bonusCol >= 0) hitBlock(w, p, bonusCol, row);
    }
  }
}

function hitBlock(w: World, p: PlayerState, col: number, row: number): void {
  const i = w.blocks.findIndex((b) => b.col === col && b.row === row);
  if (i < 0 || p.blockHit[i]) return;
  p.blockHit[i] = true;
  p.coins++;
  w.events.push({ type: 'coin', id: p.id, x: col + 0.5, y: row + 0.5, source: 'block' });
}

function updateAnim(p: PlayerState): void {
  if (p.dead) p.anim = 'hurt';
  else if (p.finished) p.anim = 'win';
  else if (!p.onGround) p.anim = p.vy < 0 ? 'jump' : 'fall';
  else p.anim = Math.abs(p.vx) > RUN_ANIM_SPEED ? 'run' : 'idle';
}

function stepPlayer(w: World, p: PlayerState, rawInput: PlayerInput): void {
  if (p.dead) {
    p.respawn--;
    if (p.respawn <= 0) respawn(p);
    updateAnim(p);
    return;
  }
  const input = p.finished ? NEUTRAL : rawInput;
  const axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // Saut : tampon et temps de grâce.
  if (input.jump && !p.prevJump) p.jumpBuffer = JUMP_BUFFER_STEPS;
  else if (p.jumpBuffer > 0) p.jumpBuffer--;
  p.prevJump = input.jump;
  p.coyote = p.onGround ? COYOTE_STEPS : Math.max(0, p.coyote - 1);
  if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = -JUMP_SPEED;
    p.jumpBuffer = 0;
    p.coyote = 0;
    p.cuttable = true;
    p.onGround = false;
    w.events.push({ type: 'jump', id: p.id, x: p.x, y: p.y });
  }
  if (p.cuttable && !input.jump && p.vy < -JUMP_CUT_SPEED) p.vy = -JUMP_CUT_SPEED;

  // Course.
  if (axis !== 0) {
    const accel = p.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const boost = p.onGround && p.vx * axis < 0 ? TURN_BOOST : 1;
    p.vx += axis * accel * boost;
    if (p.vx > MAX_RUN_SPEED) p.vx = MAX_RUN_SPEED;
    if (p.vx < -MAX_RUN_SPEED) p.vx = -MAX_RUN_SPEED;
    p.dir = axis > 0 ? 1 : -1;
  } else {
    const f = p.onGround ? GROUND_FRICTION : AIR_FRICTION;
    if (Math.abs(p.vx) <= f) p.vx = 0;
    else p.vx -= Math.sign(p.vx) * f;
  }

  // Gravité puis déplacement par axes séparés.
  p.vy = Math.min(p.vy + GRAVITY, MAX_FALL_SPEED);
  p.onGround = false;
  moveX(w, p);
  moveY(w, p);

  // Ressorts.
  if (p.vy >= 0) checkSprings(w, p);

  if (p.y - PLAYER_HEIGHT > w.height + VOID_MARGIN) {
    die(w, p, 'void');
    return;
  }

  const wasFinished = p.finished;
  if (!wasFinished) {
    if (p.invuln > 0) p.invuln--;
    else if (touchesSpikes(w, p)) {
      die(w, p, 'spikes');
      return;
    }
    collectCoins(w, p);
    touchCheckpoints(w, p);
    if (!hitEnemies(w, p)) return;
    touchFlag(w, p);
  }
  updateAnim(p);
}

function checkSprings(w: World, p: PlayerState): void {
  const row = Math.floor(p.y - EPS);
  if (p.y - row < 0.5) return; // pieds dans la moitié haute de la case : pas encore appuyé
  const c0 = Math.floor(p.x - PLAYER_HALF_WIDTH + EPS);
  const c1 = Math.floor(p.x + PLAYER_HALF_WIDTH - EPS);
  for (let c = c0; c <= c1; c++) {
    if (tileAt(w, c, row) !== TILE_SPRING) continue;
    const i = w.springs.findIndex((s) => s.col === c && s.row === row);
    p.vy = -SPRING_SPEED;
    p.onGround = false;
    p.cuttable = false;
    if (i >= 0) w.springs[i]!.pressedTick = w.tick;
    w.events.push({ type: 'spring', id: p.id, x: c + 0.5, y: row + 1, spring: i });
    return;
  }
}

function touchesSpikes(w: World, p: PlayerState): boolean {
  const l = p.x - 0.22;
  const r = p.x + 0.22;
  const t = p.y - PLAYER_HEIGHT + 0.1;
  const b = p.y - EPS;
  for (let row = Math.floor(t); row <= Math.floor(b); row++) {
    for (let c = Math.floor(l); c <= Math.floor(r); c++) {
      if (tileAt(w, c, row) !== TILE_SPIKE) continue;
      // Pointes : bande basse de la case, un peu rentrée sur les côtés.
      if (r > c + 0.12 && l < c + 0.88 && b > row + 0.55 && t < row + 1) return true;
    }
  }
  return false;
}

function collectCoins(w: World, p: PlayerState): void {
  const l = p.x - PLAYER_HALF_WIDTH;
  const r = p.x + PLAYER_HALF_WIDTH;
  const t = p.y - PLAYER_HEIGHT;
  const b = p.y;
  for (let i = 0; i < w.coins.length; i++) {
    if (p.coinTaken[i]) continue;
    const c = w.coins[i]!;
    if (r > c.x - 0.35 && l < c.x + 0.35 && b > c.y - 0.35 && t < c.y + 0.35) {
      p.coinTaken[i] = true;
      p.coins++;
      w.events.push({ type: 'coin', id: p.id, x: c.x, y: c.y, source: 'tile' });
    }
  }
}

function touchCheckpoints(w: World, p: PlayerState): void {
  for (let i = p.checkpointIndex + 1; i < w.checkpoints.length; i++) {
    const k = w.checkpoints[i]!;
    if (
      p.x + PLAYER_HALF_WIDTH > k.col &&
      p.x - PLAYER_HALF_WIDTH < k.col + 1 &&
      p.y > k.row &&
      p.y - PLAYER_HEIGHT < k.row + 1
    ) {
      p.checkpointIndex = i;
      p.checkpointX = k.x;
      p.checkpointY = k.y;
      w.events.push({ type: 'checkpoint', id: p.id, x: k.x, y: k.y, index: i });
    }
  }
}

/** Renvoie faux si le coureur vient de mourir. */
function hitEnemies(w: World, p: PlayerState): boolean {
  const half = ENEMY_SIZE / 2;
  const l = p.x - PLAYER_HALF_WIDTH;
  const r = p.x + PLAYER_HALF_WIDTH;
  const t = p.y - PLAYER_HEIGHT;
  for (let i = 0; i < w.enemies.length; i++) {
    if (p.stomped[i]) continue;
    const e = w.enemies[i]!;
    if (!(r > e.x - half && l < e.x + half && p.y > e.y - ENEMY_SIZE && t < e.y)) continue;
    if (p.vy > 0 && p.y - (e.y - ENEMY_SIZE) <= STOMP_MARGIN + p.vy) {
      p.stomped[i] = true;
      p.vy = p.prevJump ? -STOMP_BOUNCE_HELD : -STOMP_BOUNCE;
      p.onGround = false;
      p.cuttable = false;
      w.events.push({ type: 'stomp', id: p.id, x: e.x, y: e.y, enemy: i });
    } else if (p.invuln <= 0) {
      die(w, p, 'enemy');
      return false;
    }
  }
  return true;
}

function touchFlag(w: World, p: PlayerState): void {
  const c0 = Math.floor(p.x - PLAYER_HALF_WIDTH);
  const c1 = Math.floor(p.x + PLAYER_HALF_WIDTH);
  const r0 = Math.floor(p.y - PLAYER_HEIGHT);
  const r1 = Math.floor(p.y - EPS);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tileAt(w, c, r) !== TILE_FLAG) continue;
      p.finished = true;
      p.finishTick = w.tick;
      w.finishOrder.push(p.id);
      p.rank = w.finishOrder.length;
      w.events.push({ type: 'finish', id: p.id, x: p.x, y: p.y, rank: p.rank });
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Pas de simulation
// ---------------------------------------------------------------------------------------------

/** Avance le monde d'un pas (1/60 s). Mute `world`. Les identifiants sans commande restent au repos. */
export function step(world: World, inputs: Record<string, PlayerInput>): void {
  world.events.length = 0;
  if (world.over) return;
  world.tick++;
  stepEnemies(world);
  for (const p of world.players) stepPlayer(world, p, inputs[p.id] ?? NEUTRAL);
  if (world.players.length > 0 && world.players.every((p) => p.finished)) {
    world.over = true;
  } else if (world.tick >= world.timeLimitTicks) {
    world.over = true;
    world.timeUp = true;
    world.events.push({ type: 'timeup' });
  }
}

export function summary(world: World, id: string): PlayerSummary {
  const p = world.players.find((q) => q.id === id);
  if (!p) return { x: 0, y: 0, coins: 0, finished: false, finishTick: null, deaths: 0, alive: false };
  return {
    x: p.x,
    y: p.y,
    coins: p.coins,
    finished: p.finished,
    finishTick: p.finishTick,
    deaths: p.deaths,
    alive: !p.dead,
  };
}
