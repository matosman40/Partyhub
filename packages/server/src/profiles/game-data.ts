import type { ProfileDataStore } from '@partyhub/shared';
import type { Store } from '../db/store.js';

/**
 * Données de jeu par profil (par exemple les personnages de l’Aventure IA gardés d’une partie à l’autre).
 * Stockées dans la table clé-valeur, une entrée par jeu et par profil. Bornées en taille : un jeu ne peut pas
 * remplir la base. Supprimées avec le profil (voir `ProfileService.delete`).
 */

export const GAME_DATA_LIMIT_CHARS = 64 * 1024;

const PREFIX = 'game-data:';

export function gameDataKey(gameId: string, profileId: string): string {
  return `${PREFIX}${gameId}:${profileId}`;
}

/** Fabrique le magasin d’un jeu : chaque jeu ne voit que ses propres entrées. */
export function gameDataFor(store: Store): (gameId: string) => ProfileDataStore {
  return (gameId) => ({
    read(profileId) {
      const raw = store.getKv(gameDataKey(gameId, profileId));
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    write(profileId, value) {
      const raw = JSON.stringify(value);
      if (raw === undefined) throw new Error('Donnée de jeu non sérialisable');
      if (raw.length > GAME_DATA_LIMIT_CHARS) throw new Error('Donnée de jeu trop volumineuse');
      store.setKv(gameDataKey(gameId, profileId), raw);
    },
  });
}

/** Efface toutes les données de jeu d’un profil supprimé. Les identifiants de profil sont des UUID : pas de joker. */
export function purgeGameData(store: Store, profileId: string): void {
  store.db.prepare('DELETE FROM kv WHERE key LIKE ? AND key LIKE ?').run(`${PREFIX}%`, `%:${profileId}`);
}
