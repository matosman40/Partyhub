import { useEffect, useRef, useState } from 'react';

/** Délai sans action au bout duquel les commandes discrètes s'effacent. */
const IDLE_MS = 3500;

/**
 * Vrai tant que l'écran a reçu une action récente (souris, toucher, clavier), ou tant qu'on le
 * demande (`keepVisible`, par exemple un tiroir ouvert). Sert à faire apparaître les commandes
 * au besoin, et à les laisser en retrait le reste du temps.
 */
export function useActivity(keepVisible: boolean): boolean {
  const [active, setActive] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const wake = () => {
      setActive(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setActive(false), IDLE_MS);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const;
    wake();
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, wake);
      window.clearTimeout(timer.current);
    };
  }, []);

  return active || keepVisible;
}
