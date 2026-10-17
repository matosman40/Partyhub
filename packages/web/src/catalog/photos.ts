/**
 * Captures d'écran des jeux, produites par scripts/game-photos.py et rangées dans
 * public/game-photos/<identifiant>/. L'index liste les fichiers disponibles par jeu.
 */

export interface PhotoIndex {
  games: Record<string, string[]>;
}

export const PHOTO_INDEX_URL = '/game-photos/index.json';

const GAME_ID = /^[a-z0-9-]+$/;
const PHOTO_FILE = /^[a-z0-9-]+\.jpg$/;

/**
 * Lit l'index sans lui faire confiance : une entrée mal formée est ignorée, les autres restent.
 * Les noms de fichiers doivent être simples, pour ne jamais sortir du dossier du jeu.
 */
export function parsePhotoIndex(raw: unknown): PhotoIndex {
  if (typeof raw !== 'object' || raw === null || !('games' in raw)) return { games: {} };
  const games = (raw as { games: unknown }).games;
  if (typeof games !== 'object' || games === null) return { games: {} };
  const out: Record<string, string[]> = {};
  for (const [id, files] of Object.entries(games)) {
    if (!GAME_ID.test(id) || !Array.isArray(files)) continue;
    const safe = files.filter((f): f is string => typeof f === 'string' && PHOTO_FILE.test(f));
    if (safe.length > 0) out[id] = safe;
  }
  return { games: out };
}

/** Adresses des captures d'un jeu, dans l'ordre de l'index. Liste vide si le jeu n'en a pas. */
export function photosFor(index: PhotoIndex, gameId: string): string[] {
  return (index.games[gameId] ?? []).map((file) => `/game-photos/${gameId}/${file}`);
}

/** Charge l'index. Un échec (fichier absent, réseau coupé) ne bloque jamais la fiche : pas de captures. */
export async function loadPhotoIndex(fetchImpl: typeof fetch = fetch): Promise<PhotoIndex> {
  try {
    const res = await fetchImpl(PHOTO_INDEX_URL, { cache: 'no-cache' });
    if (!res.ok) return { games: {} };
    return parsePhotoIndex(await res.json());
  } catch {
    return { games: {} };
  }
}
