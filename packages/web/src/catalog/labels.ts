import type { GameCategory } from '@partyhub/shared';

/** Libellés des catégories. Source unique : le catalogue et les filtres les lisent ici. */
export const CATEGORY_LABEL: Record<GameCategory, string> = {
  cartes: 'Cartes',
  plateau: 'Ambiance',
  quiz: 'Quiz',
  role: 'Rôle',
  solo: 'Solo',
};

/** Ordre d’affichage des catégories dans les filtres : les jeux de groupe d’abord. */
export const CATEGORY_ORDER: GameCategory[] = ['quiz', 'role', 'plateau', 'cartes', 'solo'];

/** Nombre de joueurs maximal proposé dans le filtre. */
export const MAX_PLAYER_CHOICE = 12;

/** Choix du filtre « nombre de joueurs » : de 1 à MAX_PLAYER_CHOICE. */
export const PLAYER_CHOICES = Array.from({ length: MAX_PLAYER_CHOICE }, (_, i) => i + 1);
