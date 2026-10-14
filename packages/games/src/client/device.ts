import { useEffect } from 'react';

/**
 * Fonctions de l'appareil, toujours vérifiées avant usage.
 * Chaque appel est sans effet si le navigateur ne sait pas faire (iOS ne vibre pas,
 * le mode silencieux peut couper la vibration, certains écrans refusent le maintien).
 */

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Vibration courte, par exemple pour signaler son tour. Ignorée si indisponible. */
export function vibrate(pattern: number | number[]): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Le navigateur peut refuser sans geste de l'utilisateur : on ignore.
  }
}

/**
 * Maintient l'écran allumé pendant une partie (écran TV ou téléphone).
 * Le verrou est relâché quand l'onglet est masqué, puis redemandé au retour.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const request = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (disposed) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
      } catch {
        // Refusé (batterie faible, économie d'énergie) : l'écran s'éteindra normalement.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinel) void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
