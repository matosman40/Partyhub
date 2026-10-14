import { useEffect, useRef, useState } from 'react';
import { nextSquare } from '../board.js';

/**
 * Positions affichées des pions : chaque pion avance d'une case à la fois jusqu'à sa
 * position réelle (donnée par le serveur). Avec `instant`, il saute directement à l'arrivée.
 * Un nouveau joueur apparaît sur sa case ; un changement de cible en cours de route
 * reprend le déplacement depuis la case où le pion se trouve.
 */
export function useSteppedPositions(
  target: Record<string, number>,
  stepMs: number,
  instant: boolean,
): Record<string, number> {
  const targetKey = JSON.stringify(target);
  const shownRef = useRef<Record<string, number>>(target);
  const [shown, setShown] = useState<Record<string, number>>(target);

  useEffect(() => {
    const goal = JSON.parse(targetKey) as Record<string, number>;
    let timer = 0;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      const current = shownRef.current;
      const next: Record<string, number> = {};
      let moving = false;
      for (const id of Object.keys(goal)) {
        const to = goal[id] ?? 0;
        const at = current[id] ?? to;
        if (instant || at === to) {
          next[id] = to;
        } else {
          next[id] = nextSquare(at);
          moving = true;
        }
      }
      shownRef.current = next;
      setShown(next);
      if (moving) timer = window.setTimeout(tick, stepMs);
    };

    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [targetKey, stepMs, instant]);

  return shown;
}
