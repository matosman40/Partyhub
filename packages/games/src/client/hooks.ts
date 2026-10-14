import { useEffect, useMemo, useState } from 'react';

/**
 * Temps restant (ms) avant une échéance exprimée dans l'horloge serveur.
 * N'utilise pas l'horloge du navigateur : on ne mesure que le temps écoulé
 * depuis la réception de la vue, ce qui évite les écarts entre appareils.
 */
export function useRemaining(endsAt: number | undefined, serverNow: number): number {
  const [, setTick] = useState(0);
  const receivedAt = useMemo(() => Date.now(), [serverNow]);

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return 0;
  const elapsed = Date.now() - receivedAt;
  return Math.max(0, endsAt - serverNow - elapsed);
}
