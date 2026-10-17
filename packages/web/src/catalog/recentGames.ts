/**
 * Jeux joués récemment, mémorisés sur cet appareil seulement (localStorage).
 * Chaque accès passe par un try/catch : navigation privée, stockage bloqué ou plein
 * ne doivent jamais empêcher l’accueil de s’afficher.
 */

export const RECENT_KEY = 'ph:recent-games';
export const RECENT_LIMIT = 12;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Identifiants des jeux récents, du plus récent au plus ancien. Liste vide si rien n’est lisible. */
export function readRecent(storage: StorageLike | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
    return [...new Set(ids)].slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/** Place un jeu en tête des récents et renvoie la liste à jour. */
export function rememberRecent(gameId: string, storage: StorageLike | null = defaultStorage()): string[] {
  const next = [gameId, ...readRecent(storage).filter((id) => id !== gameId)].slice(0, RECENT_LIMIT);
  if (storage) {
    try {
      storage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Stockage indisponible : la liste reste valable pour cette page seulement.
    }
  }
  return next;
}
