import type { CardGameDefinition } from '@partyhub/shared';

/** État public du mémo, tel que produit par getPublicState (voir cards/memory.ts). */
export interface MemoryCellPublic {
  uid: string;
  /** Identifiant de la carte, visible seulement si elle est retournée ou trouvée. */
  entry: string | null;
  owner: string | null;
}

export interface MemoryPublic {
  kind: 'memory';
  phase: 'play' | 'peek' | 'final';
  started: boolean;
  def: CardGameDefinition;
  settings: { targetScore: number; turnSeconds: number };
  order: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  current: string | null;
  pairs: number;
  matches: number;
  board: MemoryCellPublic[];
  open: string[];
  lastEvent: string;
  turnEndsAt: number | null;
}

export interface MemoryPlayerState {
  spectator: boolean;
  isMyTurn: boolean;
  canFlip: boolean;
}

/**
 * Colonnes du plateau : une grille proche du ratio de l’écran, sans dépasser le nombre de cartes.
 * `ratio` est la largeur d’écran rapportée à la hauteur (le téléphone est plus étroit que la TV).
 */
export function memoryColumns(cards: number, ratio: number): number {
  if (cards <= 1) return 1;
  const ideal = Math.min(cards, Math.max(2, Math.ceil(Math.sqrt(cards * ratio))));
  // Une grille pleine vaut mieux qu’une dernière rangée à moitié vide : on prend, si possible,
  // un nombre de colonnes qui divise le nombre de cartes, au plus près de l’idéal.
  for (const delta of [0, 1, -1]) {
    const columns = ideal + delta;
    if (columns >= 2 && columns <= cards && cards % columns === 0) return columns;
  }
  return ideal;
}

export function isHidden(cell: MemoryCellPublic): boolean {
  return cell.entry === null && cell.owner === null;
}
