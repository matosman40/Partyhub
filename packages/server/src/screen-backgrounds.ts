import { z } from 'zod';

/**
 * Fonds d’écran : une image de la médiathèque par écran de l’application (ou aucune, pour garder
 * le décor d’origine). Les identifiants désignent des fichiers de la médiathèque.
 */

export const SCREEN_KEYS = ['home', 'join', 'tv', 'player', 'spectator', 'profile'] as const;
export type ScreenKey = (typeof SCREEN_KEYS)[number];

/** Identifiant d’image de médiathèque, ou null pour le décor d’origine. */
export type ScreenBackgrounds = Record<ScreenKey, string | null>;

export const EMPTY_SCREEN_BACKGROUNDS: ScreenBackgrounds = {
  home: null,
  join: null,
  tv: null,
  player: null,
  spectator: null,
  profile: null,
};

/** Un écran : identifiant d’image, ou null (décor d’origine, aussi quand la clé est absente). */
const screenValue = z.string().min(1).max(64).nullable().default(null);

export const screenBackgroundsSchema = z.object({
  home: screenValue,
  join: screenValue,
  tv: screenValue,
  player: screenValue,
  spectator: screenValue,
  profile: screenValue,
});

/** Lit la valeur enregistrée ; tout ce qui ne se lit pas redonne l’état vide. */
export function parseScreenBackgrounds(raw: string | undefined): ScreenBackgrounds {
  if (!raw) return { ...EMPTY_SCREEN_BACKGROUNDS };
  try {
    const parsed = screenBackgroundsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { ...EMPTY_SCREEN_BACKGROUNDS };
  } catch {
    return { ...EMPTY_SCREEN_BACKGROUNDS };
  }
}

/** Adresse publique d’une image de médiathèque. */
export function screenBackgroundUrl(assetId: string): string {
  return `/api/assets/${assetId}`;
}
