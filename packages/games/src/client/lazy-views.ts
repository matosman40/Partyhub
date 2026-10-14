import { lazy } from 'react';
import type { GameClientViews } from './types.js';

/**
 * Vues d'un jeu chargées à la première utilisation : le code d'un jeu n'est téléchargé
 * que lorsqu'on le règle, l'affiche ou le joue. Les composants sont créés une seule fois,
 * donc leur identité reste stable entre deux rendus.
 *
 * Les composants renvoyés suspendent le rendu le temps du téléchargement : l'appelant
 * doit les rendre sous une frontière `Suspense`.
 */
export function lazyViews(load: () => Promise<GameClientViews>): GameClientViews {
  let pending: Promise<GameClientViews> | undefined;
  const get = (): Promise<GameClientViews> => {
    pending ??= load().catch((error: unknown) => {
      // Un échec de téléchargement (réseau coupé) ne doit pas rester en cache : la prochaine tentative réessaie.
      pending = undefined;
      throw error;
    });
    return pending;
  };
  return {
    Settings: lazy(async () => ({ default: (await get()).Settings })),
    Host: lazy(async () => ({ default: (await get()).Host })),
    Player: lazy(async () => ({ default: (await get()).Player })),
  };
}
