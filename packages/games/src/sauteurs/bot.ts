import {
  cloneWorld,
  step,
  TILE_AIR,
  TILE_BONUS,
  TILE_ONEWAY,
  TILE_SOLID,
  TILE_SPIKE,
  type PlayerInput,
  type PlayerState,
  type World,
} from './engine.js';

/**
 * Robot de test : calcule des commandes à chaque pas pour parcourir un niveau de bout en bout.
 * Il ne triche pas : il ne touche jamais à l'état du moteur, il ne fait que simuler des commandes
 * candidates sur une copie du monde (coureur seul) et applique la meilleure par `step`.
 *
 * Principe : il court à droite. Quand cette conduite simple échoue dans l'horizon (mort, mur, trou,
 * ennemi), il essaie des plans : sauter après d pas en maintenant h pas, attendre, reculer pour
 * prendre de l'élan. Il retient le plan qui avance le plus loin sans mourir.
 */

export interface BotOptions {
  /** Pas simulés en avance. */
  horizon?: number;
  /** Pas pendant lesquels un plan retenu est suivi avant de replanifier. */
  replan?: number;
  /** Probabilité, à chaque pas, de se laisser distraire (le robot s'arrête un instant). 0 par défaut : sans faute. */
  lapse?: number;
  /** Hasard utilisé pour les distractions. */
  random?: () => number;
}

const RIGHT: PlayerInput = { left: false, right: true, jump: false };
const RIGHT_JUMP: PlayerInput = { left: false, right: true, jump: true };
const LEFT: PlayerInput = { left: true, right: false, jump: false };
const WAIT: PlayerInput = { left: false, right: false, jump: false };

type Plan = (t: number, p: PlayerState, w: World) => PlayerInput;

function tileCode(w: World, col: number, row: number): number {
  if (col < 0 || col >= w.width || row < 0 || row >= w.height) return TILE_AIR;
  return w.map[row * w.width + col]!;
}

function groundAhead(w: World, p: PlayerState): boolean {
  const code = tileCode(w, Math.floor(p.x + 0.28 + 0.12), Math.floor(p.y + 0.1));
  return code === TILE_SOLID || code === TILE_BONUS || code === TILE_ONEWAY;
}

/** Conduite réactive : court à droite, saute devant un mur, un bord, des pointes ou un ennemi. */
function reactive(_t: number, p: PlayerState, w: World): PlayerInput {
  if (p.vy < 0) return RIGHT_JUMP; // tient le saut pendant la montée
  if (!p.onGround) return RIGHT;
  const body = Math.floor(p.y - 0.5);
  const front = Math.floor(p.x + 0.28 + 0.5);
  const wall = tileCode(w, front, body) === TILE_SOLID || tileCode(w, front, body) === TILE_BONUS;
  const spikes = tileCode(w, Math.floor(p.x + 0.28 + 0.9), body) === TILE_SPIKE;
  let enemy = false;
  for (let i = 0; i < w.enemies.length; i++) {
    const e = w.enemies[i]!;
    if (p.stomped[i]) continue;
    const dx = e.x - p.x;
    if (dx > -0.5 && dx < 2.6 && Math.abs(e.y - p.y) < 1) enemy = true;
  }
  return wall || spikes || enemy || !groundAhead(w, p) ? RIGHT_JUMP : RIGHT;
}

function buildPlans(): { name: string; plan: Plan }[] {
  const plans: { name: string; plan: Plan }[] = [{ name: 'course', plan: reactive }];
  for (const d of [
    0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52,
  ]) {
    for (const h of [4, 10, 18, 60]) {
      plans.push({
        name: `saut d${d} h${h}`,
        plan: (t, p, w) => (t >= d && t < d + h ? RIGHT_JUMP : reactive(t, p, w)),
      });
    }
  }
  for (const k of [20, 45]) {
    plans.push({ name: `attente ${k}`, plan: (t, p, w) => (t < k ? WAIT : reactive(t, p, w)) });
    for (const h of [18, 60]) {
      plans.push({
        name: `attente ${k} puis saut h${h}`,
        plan: (t, p, w) => (t < k ? WAIT : t < k + h ? RIGHT_JUMP : reactive(t, p, w)),
      });
    }
  }
  for (const k of [10, 20, 32]) {
    for (const h of [18, 60]) {
      plans.push({
        name: `élan ${k} saut h${h}`,
        plan: (t, p, w) => (t < k ? LEFT : t < k + h ? RIGHT_JUMP : reactive(t, p, w)),
      });
    }
  }
  return plans;
}

const PLANS = buildPlans();

function solo(world: World, id: string): World {
  const w = cloneWorld(world);
  w.players = w.players.filter((p) => p.id === id);
  w.finishOrder = [];
  return w;
}

interface Outcome {
  score: number;
  dead: boolean;
  dx: number;
}

function evaluate(world: World, id: string, plan: Plan, horizon: number): Outcome {
  const w = solo(world, id);
  const p = w.players[0]!;
  const x0 = p.x;
  const deaths0 = p.deaths;
  const coins0 = p.coins;
  let t = 0;
  for (; t < horizon; t++) {
    step(w, { [id]: plan(t, p, w) });
    if (p.deaths > deaths0 || p.finished || w.over) break;
  }
  const dead = p.deaths > deaths0;
  const dx = p.x - x0;
  let score = dx * 10 + (p.coins - coins0) * 4;
  if (p.finished) score += 100000 - t;
  if (dead) score -= 10000 - t;
  // Finir en l'air au-dessus du vide ou sans appui est suspect.
  if (!p.onGround && !p.finished && p.y > w.height - 1) score -= 2000;
  return { score, dead, dx };
}

export interface Bot {
  /** Commande à appliquer pour le pas qui vient. */
  act(world: World): PlayerInput;
  /** Nom du dernier plan retenu (aide au réglage). */
  readonly lastPlan: string;
}

export function createBot(id: string, options: BotOptions = {}): Bot {
  const horizon = options.horizon ?? 85;
  const replan = options.replan ?? 3;
  const lapse = options.lapse ?? 0;
  const random = options.random ?? Math.random;
  let lapseLeft = 0;
  let queue: PlayerInput[] = [];
  let lastPlan = 'course';
  return {
    get lastPlan() {
      return lastPlan;
    },
    act(world: World): PlayerInput {
      // Une distraction fait lâcher les commandes quelques instants : le robot ralentit, rate un saut, tombe.
      if (lapseLeft > 0) {
        lapseLeft--;
        return WAIT;
      }
      if (lapse > 0 && random() < lapse) {
        lapseLeft = 8 + Math.floor(random() * 28);
        queue = [];
        return WAIT;
      }
      const p: PlayerState | undefined = world.players.find((q) => q.id === id);
      if (!p || p.dead || p.finished) {
        queue = [];
        return WAIT;
      }
      if (queue.length > 0) return queue.shift()!;
      // Conduite simple d'abord : si elle avance librement jusqu'à l'horizon, on la garde.
      const base = evaluate(world, id, PLANS[0]!.plan, horizon);
      let best = PLANS[0]!;
      if (base.dead || base.dx < horizon * 0.09) {
        let bestScore = -Infinity;
        for (const cand of PLANS) {
          const o = evaluate(world, id, cand.plan, horizon);
          if (o.score > bestScore + 1e-9) {
            bestScore = o.score;
            best = cand;
          }
        }
      }
      lastPlan = best.name;
      for (let i = 0; i < replan; i++) queue.push(best.plan(i, p, world));
      return queue.shift()!;
    },
  };
}

export interface RunResult {
  finished: boolean;
  ticks: number;
  trajectory: { x: number; y: number }[][];
}

/** Fait courir `count` robots dans un monde déjà créé jusqu'à la fin de la course. */
export function runBots(
  world: World,
  options: (index: number) => BotOptions = () => ({}),
  keepTrajectory = false,
): RunResult {
  const bots = world.players.map((p, i) => ({ id: p.id, bot: createBot(p.id, options(i)) }));
  const trajectory: { x: number; y: number }[][] = world.players.map(() => []);
  while (!world.over) {
    const inputs: Record<string, PlayerInput> = {};
    for (const b of bots) inputs[b.id] = b.bot.act(world);
    step(world, inputs);
    if (keepTrajectory && world.tick % 4 === 0)
      world.players.forEach((p, i) => trajectory[i]!.push({ x: p.x, y: p.y }));
  }
  return { finished: world.players.every((p) => p.finished), ticks: world.tick, trajectory };
}
