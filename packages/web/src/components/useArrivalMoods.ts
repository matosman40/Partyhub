import { useEffect, useRef, useState } from 'react';
import type { CharacterMood } from '@partyhub/shared';

/** Durée du salut d'un personnage qui vient d'arriver. */
const WAVE_MS = 3000;

/**
 * Personnages qui viennent d'arriver dans la salle : ils saluent quelques secondes.
 * Les joueurs déjà présents au premier affichage ne saluent pas.
 */
export function useArrivalMoods(names: string[]): Record<string, CharacterMood> {
  const known = useRef<Set<string> | null>(null);
  const [waving, setWaving] = useState<Record<string, CharacterMood>>({});
  const key = names.join('\u0000');

  useEffect(() => {
    const current = new Set(names);
    if (known.current === null) {
      known.current = current;
      return;
    }
    const fresh = names.filter((name) => !known.current?.has(name));
    known.current = current;
    if (fresh.length === 0) return;

    setWaving((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((name) => [name, 'wave' as const])) }));
    setTimeout(() => {
      setWaving((prev) => {
        const next = { ...prev };
        for (const name of fresh) delete next[name];
        return next;
      });
    }, WAVE_MS);
    // Dépend du contenu de la liste (sa clé), pas de la référence du tableau.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return waving;
}
