/**
 * Captures d'écran des jeux, affichées dans la fiche. Deux sources :
 * - la première vraie partie de chaque jeu, gardée par le serveur (/api/game-photos) ;
 * - les captures des parties d'essai, générées par scripts/game-photos.py (public/game-photos/), en secours.
 * Pour un même jeu, les captures de la vraie partie priment.
 */

/** Adresses publiques des captures, par jeu, prêtes à afficher. */
export interface PhotoIndex {
  games: Record<string, string[]>;
}

/** Index écrit par scripts/game-photos.py : noms de fichiers à côté du jeu. */
export const PHOTO_INDEX_URL = '/game-photos/index.json';
/** Captures de la première partie, servies par le serveur. */
export const LIVE_PHOTOS_URL = '/api/game-photos';

const GAME_ID = /^[a-z0-9-]+$/;
const BOT_FILE = /^[a-z0-9-]+\.jpg$/;
const LIVE_FILE = /^\/api\/game-photos\/([a-z0-9-]+)\/([1-9][0-9]?\.jpg)$/;

/**
 * Lit l'index des parties d'essai sans lui faire confiance : une entrée mal formée est ignorée, les autres restent.
 * Les noms de fichiers doivent être simples, pour ne jamais sortir du dossier du jeu.
 */
export function parsePhotoIndex(raw: unknown): PhotoIndex {
  const games = (raw as { games?: unknown } | null)?.games;
  if (typeof games !== 'object' || games === null) return { games: {} };
  const out: Record<string, string[]> = {};
  for (const [id, files] of Object.entries(games)) {
    if (!GAME_ID.test(id) || !Array.isArray(files)) continue;
    const safe = files
      .filter((f): f is string => typeof f === 'string' && BOT_FILE.test(f))
      .map((f) => `/game-photos/${id}/${f}`);
    if (safe.length > 0) out[id] = safe;
  }
  return { games: out };
}

/** Lit la liste des captures de la première partie, telle que le serveur la donne. */
export function parseLivePhotos(raw: unknown): PhotoIndex {
  const games = (raw as { games?: unknown } | null)?.games;
  if (typeof games !== 'object' || games === null) return { games: {} };
  const out: Record<string, string[]> = {};
  for (const [id, urls] of Object.entries(games)) {
    if (!GAME_ID.test(id) || !Array.isArray(urls)) continue;
    const safe = urls.filter((u): u is string => typeof u === 'string' && LIVE_FILE.exec(u)?.[1] === id);
    if (safe.length > 0) out[id] = safe;
  }
  return { games: out };
}

/** Les captures de la première partie remplacent celles des parties d'essai, jeu par jeu. */
export function mergePhotoIndexes(bots: PhotoIndex, live: PhotoIndex): PhotoIndex {
  return { games: { ...bots.games, ...live.games } };
}

/** Adresses des captures d'un jeu, dans l'ordre. Liste vide si le jeu n'en a pas. */
export function photosFor(index: PhotoIndex, gameId: string): string[] {
  return index.games[gameId] ?? [];
}

/**
 * D'où viennent les captures d'un jeu : la première vraie partie (serveur) ou une partie d'essai (robots).
 * Un jeu n'a jamais des captures des deux sources : la première partie remplace les captures d'essai.
 */
export function photoOrigin(urls: string[]): 'partie' | 'essai' {
  return urls[0]?.startsWith('/api/game-photos/') ? 'partie' : 'essai';
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  try {
    const res = await fetchImpl(url, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Captures de la première partie seulement, telles que le serveur les connaît. */
export async function loadLivePhotos(fetchImpl: typeof fetch = fetch): Promise<PhotoIndex> {
  return parseLivePhotos(await fetchJson(LIVE_PHOTOS_URL, fetchImpl));
}

/**
 * Charge les deux sources. Un échec (fichier absent, réseau coupé) ne bloque jamais la fiche :
 * le jeu s'affiche sans captures.
 */
export async function loadPhotoIndex(fetchImpl: typeof fetch = fetch): Promise<PhotoIndex> {
  const [bots, live] = await Promise.all([
    fetchJson(PHOTO_INDEX_URL, fetchImpl).then(parsePhotoIndex),
    loadLivePhotos(fetchImpl),
  ]);
  return mergePhotoIndexes(bots, live);
}
