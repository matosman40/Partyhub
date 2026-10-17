import type { SensorEvent } from '@partyhub/shared';
import type { SensorReading } from '@partyhub/games/client';

/**
 * Regroupement des échantillons des téléphones, pour l'écran principal : au plus un envoi à l'écran par image.
 * Pour chaque joueur, seul le dernier échantillon du lot est gardé. Son heure (`at`) est celle de la réception
 * (c'est elle qui dit si la mesure est encore fraîche), pas celle de l'envoi du lot.
 *
 * Le lot part à la prochaine image : un échantillon n'attend pas plus d'une image avant d'être dessiné, et
 * l'écran ne se met jamais à jour plus souvent qu'il ne peut peindre.
 */

/** Planifie `run` pour la prochaine image ; renvoie la fonction qui annule cette planification. */
export function nextFrame(run: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => run());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(run, 16);
  return () => clearTimeout(id);
}

export interface SampleBatcherOptions {
  /** Reçoit le lot : l'état de chaque joueur qui a envoyé depuis le lot précédent. */
  onFlush: (batch: Record<string, SensorReading>) => void;
  /** Planifie l'envoi du lot. Par défaut, la prochaine image ; les tests fournissent le leur. */
  schedule?: (run: () => void) => () => void;
}

export interface SampleBatcher {
  /** Enregistre un échantillon reçu à l'instant `at` (horloge de la page). */
  push(sample: SensorEvent, at: number): void;
  /** Abandonne le lot en attente (fin de vie du composant). */
  dispose(): void;
}

export function createSampleBatcher({ onFlush, schedule = nextFrame }: SampleBatcherOptions): SampleBatcher {
  let pending = new Map<string, SensorReading>();
  let cancel: (() => void) | null = null;

  const flush = () => {
    cancel = null;
    if (pending.size === 0) return;
    const batch = Object.fromEntries(pending);
    pending = new Map();
    onFlush(batch);
  };

  return {
    push(sample, at) {
      pending.set(sample.playerId, { x: sample.x, y: sample.y, energy: sample.energy, at });
      if (cancel === null) cancel = schedule(flush);
    },
    dispose() {
      cancel?.();
      cancel = null;
      pending = new Map();
    },
  };
}
