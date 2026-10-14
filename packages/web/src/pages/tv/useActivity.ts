import { useEffect, useRef, useState } from 'react';

/** Délai sans action au bout duquel les commandes discrètes s'effacent. */
export const IDLE_MS = 3500;

/**
 * Minuterie d'inactivité : `wake()` relance le délai ; `onIdle` n'est appelé qu'une fois le délai
 * écoulé sans nouvel appel. `stop()` annule la minuterie en attente.
 */
export function createIdleTracker(
  onIdle: () => void,
  idleMs: number = IDLE_MS,
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): { wake: () => void; stop: () => void } {
  let pending: unknown;
  return {
    wake() {
      timers.clear(pending);
      pending = timers.set(onIdle, idleMs);
    },
    stop() {
      timers.clear(pending);
      pending = undefined;
    },
  };
}

/**
 * Vrai tant que l'écran a reçu une action récente (souris, toucher, clavier), ou tant qu'on le
 * demande (`keepVisible`, par exemple un tiroir ouvert). Sert à faire apparaître les commandes
 * au besoin, et à les laisser en retrait le reste du temps.
 */
export function useActivity(keepVisible: boolean): boolean {
  const [active, setActive] = useState(true);
  const tracker = useRef<ReturnType<typeof createIdleTracker> | null>(null);

  useEffect(() => {
    const idle = createIdleTracker(() => setActive(false));
    tracker.current = idle;
    const wake = () => {
      setActive(true);
      idle.wake();
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const;
    wake();
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, wake);
      idle.stop();
      tracker.current = null;
    };
  }, []);

  return active || keepVisible;
}
