import { PHRASES_JOB_KIND, runAventureJob, runPhrasesJob } from '@partyhub/games';
import type { GameContext, GameJob } from '@partyhub/shared';
import type { CodeJobRunner } from '../packages/code-runtime.js';

/** Taille maximale d'un travail demandé par un jeu de code, en octets (JSON). Au-delà, le travail est refusé. */
export const CODE_JOB_MAX_BYTES = 16 * 1024;

interface KnownJobs {
  /** Types de travail que ce jeu peut demander. */
  kinds: readonly string[];
  run: (job: GameJob, ctx: GameContext, signal: AbortSignal) => Promise<unknown>;
}

/**
 * Les seuls travaux d'IA qu'un jeu de code peut lancer : ceux des jeux intégrés qui ont une IA. Le serveur exécute
 * leur code (prompts, validation des réponses) avec sa clé ; le jeu de code ne fournit que l'entrée du travail.
 */
const KNOWN_JOBS: Record<string, KnownJobs> = {
  'aventure-ia': { kinds: ['roster', 'scene', 'epilogue'], run: runAventureJob },
  'phrases-trous': { kinds: [PHRASES_JOB_KIND], run: runPhrasesJob },
};

/** Vrai si ce jeu a un travail d'IA connu du serveur. */
export function hasKnownAiJobs(gameId: string): boolean {
  return gameId in KNOWN_JOBS;
}

/**
 * Exécuteur des travaux d'un jeu de code. Le jeu n'obtient le modèle que si l'administrateur a activé l'IA pour
 * lui (`enabled`, relu à chaque travail). Sinon, ou pour un travail inconnu, le travail échoue : le jeu prend son repli.
 */
export function codeJobRunner(gameId: string, enabled: () => boolean): CodeJobRunner {
  return async (job, ctx, signal) => {
    const known = KNOWN_JOBS[gameId];
    if (!known || !known.kinds.includes(job.kind)) throw new Error('Travail d’IA inconnu pour ce jeu.');
    if (!enabled()) throw new Error('L’IA n’est pas activée pour ce jeu.');
    if (Buffer.byteLength(JSON.stringify(job.input ?? null)) > CODE_JOB_MAX_BYTES) {
      throw new Error('Travail d’IA trop volumineux.');
    }
    return known.run(job, ctx, signal);
  };
}
