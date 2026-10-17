import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Vrai pendant une pause de l’écran principal (`lobby.paused`). Les décomptes gardent alors leur valeur :
 * le temps écoulé sur le téléphone ou la TV ne doit pas continuer à passer.
 */
export const PauseContext = createContext(false);

/**
 * Temps restant (ms) avant une échéance exprimée dans l’horloge serveur.
 * N’utilise pas l’horloge du navigateur : on ne mesure que le temps écoulé
 * depuis la réception de la vue, ce qui évite les écarts entre appareils.
 */
export function useRemaining(endsAt: number | undefined, serverNow: number): number {
  const [, setTick] = useState(0);
  const paused = useContext(PauseContext);
  // `serverNow` n’est pas lu ici : il sert à recaler l’instant de réception à chaque nouvelle vue du serveur.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const receivedAt = useMemo(() => performance.now(), [serverNow]);

  useEffect(() => {
    if (!endsAt || paused) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [endsAt, paused]);

  if (!endsAt) return 0;
  const elapsed = paused ? 0 : performance.now() - receivedAt;
  return Math.max(0, endsAt - serverNow - elapsed);
}

/**
 * Instant du début d’une manche, sur l’horloge locale (performance.now) de ce téléphone : l’heure serveur de
 * début, corrigée du temps de trajet de la vue. Calculé une fois par début : le décompte local reste régulier.
 */
export function localStartOf(startedAt: number, serverNow: number): number {
  return performance.now() - Math.max(0, serverNow - startedAt);
}

/** Même chose que `localStartOf`, mémorisé : le début ne change pas tant que le serveur ne l’a pas changé. */
export function useLocalStart(startedAt: number, serverNow: number): number {
  return useMemo(() => localStartOf(startedAt, serverNow), [startedAt]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Temps écoulé (ms) depuis un début exprimé dans l’horloge serveur, mis à jour à intervalle court tant que
 * `active` est vrai. Comme `useRemaining`, on ne mesure que le temps passé depuis la réception de la vue.
 */
export function useElapsed(startedAt: number, serverNow: number, active: boolean, everyMs = 50): number {
  const [, setTick] = useState(0);
  const paused = useContext(PauseContext);
  // `serverNow` n’est pas lu ici : il sert à recaler l’instant de réception à chaque nouvelle vue du serveur.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const receivedAt = useMemo(() => performance.now(), [serverNow]);

  useEffect(() => {
    if (!active || !startedAt || paused) return;
    const id = window.setInterval(() => setTick((t) => t + 1), everyMs);
    return () => window.clearInterval(id);
  }, [active, startedAt, everyMs, paused]);

  if (!active || !startedAt) return 0;
  const drift = paused ? 0 : performance.now() - receivedAt;
  return Math.max(0, serverNow - startedAt + drift);
}
