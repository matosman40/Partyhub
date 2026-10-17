import type { CSSProperties } from 'react';
import type { CatalogGame, GameCategory } from '@partyhub/shared';
import { logoFor } from '../components/gameLogos.js';

/** Classe CSS associée à chaque catégorie (couleur des lignes de liste). */
export const CATEGORY_CLASS: Record<GameCategory, string> = {
  cartes: 'cards',
  plateau: 'plateau',
  quiz: 'quiz',
  role: 'role',
  solo: 'solo',
};

/** Couleurs de l'identité visuelle du jeu, utilisées pour la vignette. */
export function artStyle(id: string, name: string): CSSProperties {
  const [a, b] = logoFor(id, name).sky;
  return { '--sky-a': a, '--sky-b': b } as CSSProperties;
}

/** Nombre de joueurs affiché : « 4 » ou « 2 à 6 ». */
export function playersLabel(game: Pick<CatalogGame, 'minPlayers' | 'maxPlayers'>): string {
  return game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers} à ${game.maxPlayers}`;
}
