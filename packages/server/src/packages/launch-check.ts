import { createHash } from 'node:crypto';
import type { GameContext, GameModule, JobOutcome, PlayerRef } from '@partyhub/shared';

export type LaunchCheckResult = { ok: true; actions: number } | { ok: false; error: string };

export interface LaunchCheckOptions {
  /** Nombre maximal de pas (actions ou minuteurs) avant de déclarer la partie bloquée. */
  maxSteps?: number;
  /** Nombre de parties complètes jouées par les robots, chacune avec une graine différente. */
  games?: number;
}

/** Générateur pseudo-aléatoire reproductible : une même graine donne toujours la même partie. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Step = { kind: 'continue' } | { kind: 'done' } | { kind: 'fail'; error: string };
const CONTINUE: Step = { kind: 'continue' };

/**
 * Temps simulé écoulé pendant une action des robots (en ms). Sans cela, un jeu en temps réel dont les robots
 * jouent sans relâche ne verrait jamais sa limite de manche : ses minuteurs n'arriveraient jamais à échéance.
 */
const STEP_MS = 250;

/** Empreinte de tout ce que le jeu montre : vue publique, vue de l'hôte et vue de chaque joueur. */
function fingerprintOf(mod: GameModule, state: unknown, players: PlayerRef[]): string {
  const view = [
    mod.getPublicState(state),
    mod.getHostState(state),
    ...players.map((p) => mod.getPlayerState(state, p.id)),
  ];
  return createHash('sha256').update(JSON.stringify(view)).digest('hex');
}

/**
 * Une partie jouée par des robots, pas à pas. Le contrôle peut faire avancer plusieurs parties
 * en alternance sur le même module : c'est ce qui révèle un état gardé d'une partie à l'autre.
 */
class BotRun {
  /** Empreinte de l'état après chaque pas : deux parties identiques ont la même suite. */
  readonly trace: string[] = [];
  actions = 0;
  private state: unknown = undefined;
  private steps = 0;
  private idle = 0;
  private readonly random: () => number;
  /** Minuteurs en attente : clé -> échéance (horloge simulée). */
  private readonly timers = new Map<string, number>();
  private readonly clock = { t: 1_000_000 };
  private readonly players: PlayerRef[];
  private readonly ctx: GameContext;

  constructor(
    private readonly mod: GameModule,
    readonly seed: number,
    private readonly maxSteps: number,
  ) {
    this.random = seeded(seed);
    const count = Math.max(1, mod.manifest.minPlayers);
    const ids = Array.from({ length: count }, (_, i) => `bot-${i + 1}`);
    this.players = ids.map((id, i) => ({ id, name: `Robot ${i + 1}` }));
    this.ctx = {
      now: () => this.clock.t,
      schedule: (key, ms) => void this.timers.set(key, this.clock.t + ms),
      cancel: (key) => void this.timers.delete(key),
      random: this.random,
      connectedPlayerIds: () => ids,
    };
  }

  /** Démarre la partie. Renvoie le message d'erreur du jeu, ou null. */
  start(): string | null {
    const settings = this.mod.settingsSchema.parse(this.mod.defaultSettings);
    const started = this.mod.start(this.mod.initialize(settings, this.players, this.ctx), this.ctx);
    if (!started.ok) return started.error;
    this.state = started.state;
    this.record();
    return null;
  }

  /** Fait avancer la partie d'un pas : une action, un minuteur, une manche, ou un travail asynchrone. */
  advance(): Step {
    try {
      if (this.mod.isFinished(this.state)) return { kind: 'done' };
      if (++this.steps > this.maxSteps) return { kind: 'fail', error: `non terminée après ${this.maxSteps} pas` };

      // Travail asynchrone (IA) : le contrôle ne l'exécute pas. Il simule son résultat sans fournisseur :
      // « IA non configurée » une partie sur deux, « erreur » l'autre, pour tester les deux replis.
      const job = this.mod.pendingJob?.(this.state) ?? null;
      if (job && this.mod.completeJob) {
        const outcome: JobOutcome =
          this.seed % 2 === 0 ? { ok: true, value: null } : { ok: false, error: 'résultat simulé pour le contrôle' };
        this.state = this.mod.completeJob(this.state, job.id, outcome, this.ctx);
        return this.moved();
      }

      // Les minuteurs échus se déclenchent avant les robots, comme dans une vraie partie.
      if (this.fireDue()) return this.moved();

      for (const player of this.players) {
        const suggestion = this.mod.suggest?.(this.state, player.id, this.random, this.clock.t) ?? null;
        if (!suggestion) continue;
        const result = this.mod.handleAction(this.state, player, suggestion.type, suggestion.payload, this.ctx);
        if (!result.ok) return { kind: 'fail', error: `action « ${suggestion.type} » refusée : ${result.error}` };
        this.state = result.state;
        this.actions++;
        this.clock.t += STEP_MS;
        return this.moved();
      }

      // Aucun robot ne joue : l'horloge saute au prochain minuteur.
      if (this.timers.size > 0) {
        this.clock.t = Math.max(this.clock.t, Math.min(...this.timers.values()));
        this.fireDue();
        return this.moved();
      }

      // Aucun robot ne joue et aucun minuteur n’attend : on tente la manche suivante.
      if (++this.idle > 3) {
        // La phase bloquée aide l'auteur à trouver l'étape qui ne mène nulle part (si le jeu la publie).
        const phase = (this.mod.getPublicState(this.state) as { phase?: unknown } | null)?.phase;
        const where = typeof phase === 'string' ? ` (phase « ${phase} »)` : '';
        return {
          kind: 'fail',
          error: `bloquée${where} : aucun robot ne peut jouer et aucun minuteur n’est en attente`,
        };
      }
      this.state = this.mod.nextRound(this.state, this.ctx);
      this.record();
      return CONTINUE;
    } catch (err) {
      return { kind: 'fail', error: `exception : ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** Fin de partie : les scores et les vues doivent être calculables et sérialisables pour tous. */
  finish(): string | null {
    try {
      this.mod.calculateScores(this.state);
      JSON.stringify([
        this.mod.getPublicState(this.state),
        this.mod.getHostState(this.state),
        ...this.players.map((p) => this.mod.getPlayerState(this.state, p.id)),
      ]);
      return null;
    } catch (err) {
      return `exception : ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private moved(): Step {
    this.idle = 0;
    this.record();
    return CONTINUE;
  }

  /** Déclenche les minuteurs dont l'échéance est atteinte, dans l'ordre des échéances. */
  private fireDue(): boolean {
    const due = [...this.timers.entries()]
      .filter(([, at]) => at <= this.clock.t)
      .sort((a, b) => a[1] - b[1]);
    for (const [key] of due) {
      this.timers.delete(key);
      this.state = this.mod.onTimer(this.state, key, this.ctx);
    }
    return due.length > 0;
  }

  private record(): void {
    this.trace.push(fingerprintOf(this.mod, this.state, this.players));
  }
}

const REPRODUCIBILITY =
  'une partie rejouée ne donne pas la même suite d’états. Le jeu garde peut-être des variables entre les parties, ' +
  'ou utilise Date.now() ou Math.random() : utilisez ctx.now() et ctx.random(), et ne gardez aucun état hors de la partie.';
const ISOLATION =
  'la partie change quand elle partage le module avec une autre partie. Le jeu garde probablement un état au niveau du module : ' +
  'tout l’état doit vivre dans l’objet de partie.';

/**
 * Joue des parties complètes avec les robots du jeu, sans réseau ni sortie de données. Fonctionne pour
 * tout module de jeu (cartes, plateau, questions) : les robots suivent `suggest`, et le nombre de joueurs
 * vient du manifeste du module. Détecte un jeu qui ne démarre pas, une action refusée, une partie bloquée,
 * une vue qui ne se sérialise pas, une partie non reproductible, et un état partagé entre parties.
 * Appelé avant chaque installation et chaque approbation.
 */
type Check = Generator<void, LaunchCheckResult, void>;

/**
 * Le contrôle, découpé en pas : une pause après chaque pas de partie. Les deux pilotes (`launchCheck` et
 * `launchCheckAsync`) suivent exactement les mêmes étapes : ils donnent donc le même résultat.
 */
function* checkSteps(mod: GameModule, options: LaunchCheckOptions = {}): Check {
  const maxSteps = options.maxSteps ?? 3000;
  const games = options.games ?? 2;

  // 1. Chaque partie, jouée seule, doit se terminer et se sérialiser.
  const solo: string[][] = [];
  let actions = 0;
  for (let seed = 1; seed <= games; seed++) {
    const run = new BotRun(mod, seed, maxSteps);
    const failure = yield* playToEnd(run);
    if (failure) return { ok: false, error: `partie ${seed} : ${failure}` };
    solo.push(run.trace);
    actions += run.actions;
  }

  // 2. Reproductibilité : la partie 1, rejouée après les autres, doit donner exactement la même suite d'états.
  const again = new BotRun(mod, 1, maxSteps);
  const againFailure = yield* playToEnd(again);
  if (againFailure) return { ok: false, error: `partie 1 (rejouée) : ${againFailure}` };
  if (!sameTrace(again.trace, solo[0] ?? [])) return { ok: false, error: `partie 1 : ${REPRODUCIBILITY}` };

  // 3. Isolation : des parties jouées en alternance sur le même module doivent donner les mêmes suites que jouées seules.
  const runs = Array.from({ length: games }, (_, i) => new BotRun(mod, i + 1, maxSteps));
  for (const run of runs) {
    const started = startOf(run);
    if (started) return { ok: false, error: `partie ${run.seed} : ${started}` };
  }
  let pending = [...runs];
  while (pending.length > 0) {
    const next: BotRun[] = [];
    for (const run of pending) {
      const step = run.advance();
      if (step.kind === 'fail') return { ok: false, error: `partie ${run.seed} : ${step.error}` };
      if (step.kind === 'continue') next.push(run);
      yield;
    }
    pending = next;
  }
  for (const run of runs) {
    const failure = run.finish();
    if (failure) return { ok: false, error: `partie ${run.seed} : ${failure}` };
    if (!sameTrace(run.trace, solo[run.seed - 1] ?? [])) {
      return { ok: false, error: `partie ${run.seed} : isolement : ${ISOLATION}` };
    }
  }

  return { ok: true, actions };
}

/** Sans pause : le contrôle s'exécute d'un bloc. Le CLI et les tests l'utilisent. */
export function launchCheck(mod: GameModule, options: LaunchCheckOptions = {}): LaunchCheckResult {
  const steps = checkSteps(mod, options);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** Nombre de pas joués avant de rendre la main à la boucle du serveur. */
export const LAUNCH_CHECK_YIELD_EVERY = 25;

/**
 * Le même contrôle, pour le serveur en fonctionnement : il rend la main à la boucle des événements toutes les
 * LAUNCH_CHECK_YIELD_EVERY étapes. Les salles et les autres requêtes restent servies pendant une installation.
 */
export async function launchCheckAsync(mod: GameModule, options: LaunchCheckOptions = {}): Promise<LaunchCheckResult> {
  const steps = checkSteps(mod, options);
  let count = 0;
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    if (++count % LAUNCH_CHECK_YIELD_EVERY === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Démarre puis fait avancer une partie jusqu'à sa fin. Renvoie le motif d'échec, ou null. */
function* playToEnd(run: BotRun): Generator<void, string | null, void> {
  const started = startOf(run);
  if (started) return started;
  for (;;) {
    const step = run.advance();
    if (step.kind === 'fail') return step.error;
    if (step.kind === 'done') break;
    yield;
  }
  return run.finish();
}

/** Démarrage d'une partie, avec les exceptions du jeu rendues en message. */
function startOf(run: BotRun): string | null {
  try {
    return run.start();
  } catch (err) {
    return `exception : ${err instanceof Error ? err.message : String(err)}`;
  }
}

function sameTrace(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
