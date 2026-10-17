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

/**
 * Joue une ou plusieurs parties complètes avec les robots du jeu, sans réseau ni sortie
 * de données. Fonctionne pour tout module de jeu (cartes, plateau, questions) : les robots
 * suivent `suggest`, et le nombre de joueurs vient du manifeste du module.
 * Détecte un jeu qui ne démarre pas, une action refusée, une partie bloquée et une vue
 * qui ne se sérialise pas. Appelé avant chaque installation.
 */
export function launchCheck(mod: GameModule, options: LaunchCheckOptions = {}): LaunchCheckResult {
  const maxSteps = options.maxSteps ?? 3000;
  const games = options.games ?? 2;
  let actions = 0;
  for (let game = 1; game <= games; game++) {
    const result = playOne(mod, game, maxSteps);
    if (!result.ok) return result;
    actions += result.actions;
  }
  return { ok: true, actions };
}

function playOne(mod: GameModule, seed: number, maxSteps: number): LaunchCheckResult {
  const fail = (reason: string): LaunchCheckResult => ({ ok: false, error: `partie ${seed} : ${reason}` });
  const random = seeded(seed);
  const timers = new Map<string, number>();
  const clock = { t: 1_000_000 };
  const count = Math.max(1, mod.manifest.minPlayers);
  const ids = Array.from({ length: count }, (_, i) => `bot-${i + 1}`);
  const players: PlayerRef[] = ids.map((id, i) => ({ id, name: `Robot ${i + 1}` }));
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random,
    connectedPlayerIds: () => ids,
  };

  try {
    const settings = mod.settingsSchema.parse(mod.defaultSettings);
    const started = mod.start(mod.initialize(settings, players, ctx), ctx);
    if (!started.ok) return fail(started.error);
    let state = started.state;

    let steps = 0;
    let actions = 0;
    let idle = 0;
    while (!mod.isFinished(state)) {
      if (++steps > maxSteps) return fail(`non terminée après ${maxSteps} pas`);

      // Travail asynchrone (IA) : le contrôle ne l'exécute pas. Il simule son résultat sans fournisseur :
      // « IA non configurée » une partie sur deux, « erreur » l'autre, pour tester les deux replis.
      const job = mod.pendingJob?.(state) ?? null;
      if (job && mod.completeJob) {
        const outcome: JobOutcome =
          seed % 2 === 0 ? { ok: true, value: null } : { ok: false, error: 'résultat simulé pour le contrôle' };
        state = mod.completeJob(state, job.id, outcome, ctx);
        idle = 0;
        continue;
      }

      let acted = false;
      for (const player of players) {
        const suggestion = mod.suggest?.(state, player.id, random, clock.t) ?? null;
        if (!suggestion) continue;
        const result = mod.handleAction(state, player, suggestion.type, suggestion.payload, ctx);
        if (!result.ok) return fail(`action « ${suggestion.type} » refusée : ${result.error}`);
        state = result.state;
        actions++;
        acted = true;
        break;
      }
      if (acted) {
        idle = 0;
        continue;
      }

      if (timers.size > 0) {
        for (const key of [...timers.keys()]) {
          timers.delete(key);
          state = mod.onTimer(state, key, ctx);
        }
        idle = 0;
        continue;
      }

      // Aucun robot ne joue et aucun minuteur n’attend : on tente la manche suivante.
      if (++idle > 3) return fail('bloquée : aucun robot ne peut jouer et aucun minuteur n’est en attente');
      state = mod.nextRound(state, ctx);
    }

    // Les vues doivent être constructibles et sérialisables pour tous les destinataires.
    mod.calculateScores(state);
    JSON.stringify([
      mod.getPublicState(state),
      mod.getHostState(state),
      ...players.map((p) => mod.getPlayerState(state, p.id)),
    ]);
    return { ok: true, actions };
  } catch (err) {
    return fail(`exception : ${err instanceof Error ? err.message : String(err)}`);
  }
}
