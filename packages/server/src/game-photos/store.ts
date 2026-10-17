import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Captures de la première partie de chaque jeu, montrées dans la fiche du jeu (ordinateur et téléphone).
 *
 * Une seule salle « source » par jeu : la première qui envoie une capture. Elle en envoie quelques-unes
 * pendant sa partie ; ensuite, plus aucune salle ne peut en ajouter pour ce jeu. Les parties d'essai (robots
 * seuls) n'en envoient pas : leurs images viennent de scripts/game-photos.py.
 *
 * Fichiers : <dataDir>/game-photos/index.json, et <dataDir>/game-photos/<jeu>/<n>.jpg.
 */

/** Nombre maximal de captures gardées pour un jeu. */
export const GAME_PHOTO_MAX = 4;
/** Taille maximale d'une capture : un JPEG 1280 × 720 de qualité moyenne tient largement dedans. */
export const GAME_PHOTO_MAX_BYTES = 400 * 1024;

const GAME_ID = /^[a-z0-9-]+$/;
const PHOTO_FILE = /^[1-9][0-9]?\.jpg$/;

export type GamePhotoRejection = 'invalid' | 'not-jpeg' | 'too-large' | 'closed' | 'full';

interface GameEntry {
  /** Code de la salle qui a fourni les captures. */
  room: string;
  files: string[];
}

interface PhotoIndex {
  games: Record<string, GameEntry>;
}

export class GamePhotoStore {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, 'game-photos');
  }

  /** Adresses publiques des captures gardées, par jeu. Un jeu sans capture n'apparaît pas. */
  urls(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [id, entry] of Object.entries(this.read().games)) {
      if (entry.files.length > 0) out[id] = entry.files.map((file) => `/api/game-photos/${id}/${file}`);
    }
    return out;
  }

  /** Chemin d'une capture gardée, ou null : seul un fichier listé dans l'index est servi. */
  filePath(gameId: string, file: string): string | null {
    if (!GAME_ID.test(gameId) || !PHOTO_FILE.test(file)) return null;
    const entry = this.read().games[gameId];
    if (!entry?.files.includes(file)) return null;
    return path.join(this.root, gameId, file);
  }

  /** Dit si cette salle peut encore ajouter une capture pour ce jeu, sans rien enregistrer. */
  check(gameId: string, room: string): GamePhotoRejection | null {
    if (!GAME_ID.test(gameId)) return 'invalid';
    const entry = this.read().games[gameId];
    if (!entry || entry.files.length === 0) return null;
    if (entry.room !== room) return 'closed';
    if (entry.files.length >= GAME_PHOTO_MAX) return 'full';
    return null;
  }

  /** Garde une capture JPEG envoyée par la salle source du jeu. */
  add(gameId: string, room: string, bytes: Uint8Array): { count: number } | { rejected: GamePhotoRejection } {
    if (!GAME_ID.test(gameId)) return { rejected: 'invalid' };
    if (bytes.byteLength > GAME_PHOTO_MAX_BYTES) return { rejected: 'too-large' };
    if (!isJpeg(bytes)) return { rejected: 'not-jpeg' };
    const blocked = this.check(gameId, room);
    if (blocked) return { rejected: blocked };

    const index = this.read();
    const entry = index.games[gameId] ?? { room, files: [] };
    const file = `${nextNumber(entry.files)}.jpg`;
    const dir = path.join(this.root, gameId);
    mkdirSync(dir, { recursive: true });
    writeAtomic(path.join(dir, file), bytes);

    entry.files.push(file);
    index.games[gameId] = entry;
    this.write(index);
    return { count: entry.files.length };
  }

  private read(): PhotoIndex {
    const file = path.join(this.root, 'index.json');
    if (!existsSync(file)) return { games: {} };
    try {
      return sanitize(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return { games: {} };
    }
  }

  private write(index: PhotoIndex): void {
    mkdirSync(this.root, { recursive: true });
    writeAtomic(path.join(this.root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  }
}

/** Relit l'index sans lui faire confiance : une entrée mal formée est ignorée. */
function sanitize(raw: unknown): PhotoIndex {
  const games: Record<string, GameEntry> = {};
  const source = (raw as { games?: unknown } | null)?.games;
  if (typeof source !== 'object' || source === null) return { games };
  for (const [id, entry] of Object.entries(source)) {
    if (!GAME_ID.test(id) || typeof entry !== 'object' || entry === null) continue;
    const { room, files } = entry as { room?: unknown; files?: unknown };
    if (typeof room !== 'string' || !Array.isArray(files)) continue;
    const safe = files.filter((f): f is string => typeof f === 'string' && PHOTO_FILE.test(f));
    if (safe.length > 0) games[id] = { room, files: safe };
  }
  return { games };
}

/** Un JPEG commence par FF D8 FF et se termine par FF D9. */
export function isJpeg(bytes: Uint8Array): boolean {
  const n = bytes.byteLength;
  return (
    n > 100 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[n - 2] === 0xff &&
    bytes[n - 1] === 0xd9
  );
}

function nextNumber(files: string[]): number {
  return files.reduce((max, f) => Math.max(max, Number.parseInt(f, 10)), 0) + 1;
}

/** Écrit dans un fichier temporaire puis renomme : un arrêt en cours d'écriture ne laisse pas de fichier cassé. */
function writeAtomic(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}
