import { randomBytes } from 'node:crypto';
import { createBoardGame } from '@partyhub/games';
import { boardGameDefinitionSchema, type BoardGameDefinition } from '@partyhub/shared';
import type { Store } from '../db/store.js';
import { setCustomGames } from '../games-registry.js';

/** Préfixe des identifiants de jeux de plateau créés dans l'administration. */
export const BOARD_GAME_PREFIX = 'board-';

export interface BoardGameRecord {
  id: string;
  definition: BoardGameDefinition;
  updatedAt: string;
}

/**
 * Gère les jeux de plateau personnalisés : stockage, validation et reconstruction des
 * modules jouables. Une ligne illisible ou invalide est ignorée sans bloquer le démarrage.
 */
export class BoardGameService {
  constructor(private readonly store: Store) {
    this.reload();
  }

  reload(): void {
    const modules = this.list().map((r) => createBoardGame(r.definition, { id: r.id }));
    setCustomGames('boards', modules);
  }

  list(): BoardGameRecord[] {
    const records: BoardGameRecord[] = [];
    for (const row of this.store.listBoardGames()) {
      try {
        const parsed = boardGameDefinitionSchema.safeParse(JSON.parse(row.definition));
        if (parsed.success) records.push({ id: row.id, definition: parsed.data, updatedAt: row.updatedAt });
      } catch {
        // Ligne illisible : ignorée, comme au démarrage.
      }
    }
    return records;
  }

  exists(id: string): boolean {
    return this.store.listBoardGames().some((row) => row.id === id);
  }

  /** Crée un jeu (id absent) ou remplace la définition d'un jeu existant. */
  save(id: string | null, input: unknown): { ok: true; id: string } | { ok: false; error: string } {
    const parsed = boardGameDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, error: issue?.message ?? 'Plateau invalide.' };
    }
    if (id !== null && !this.exists(id)) return { ok: false, error: 'Jeu inconnu.' };
    const gameId = id ?? `${BOARD_GAME_PREFIX}${randomBytes(4).toString('hex')}`;
    this.store.saveBoardGame(gameId, JSON.stringify(parsed.data));
    this.store.setGameEnabled(gameId, true);
    this.reload();
    return { ok: true, id: gameId };
  }

  remove(id: string): boolean {
    if (!this.exists(id)) return false;
    this.store.deleteBoardGame(id);
    this.reload();
    return true;
  }

  /** Copie d'un plateau, nommée « … (copie) ». */
  duplicate(id: string): { ok: true; id: string } | { ok: false; error: string } {
    const original = this.list().find((r) => r.id === id);
    if (!original) return { ok: false, error: 'Jeu inconnu.' };
    const suffix = ' (copie)';
    const name = `${original.definition.name.slice(0, 40 - suffix.length)}${suffix}`;
    return this.save(null, { ...original.definition, name });
  }
}
