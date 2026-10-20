/**
 * Filtres et recherche du magasin de jeux. Module sans React : testable à part.
 */

export type StoreStatus = 'integre' | 'non_installe' | 'a_jour' | 'mise_a_jour' | 'erreur' | 'en_revue';

export interface StoreGame {
  id: string;
  tag: string;
  latestVersion: string;
  name: string;
  description: string;
  author: string;
  moduleLabel: string;
  hasCover: boolean;
  error: string | null;
  builtin: boolean;
  status: StoreStatus;
  installedVersion: string | null;
  pendingVersion: string | null;
  autoUpdate: boolean;
  lastError: string | null;
}

export type StoreFilter = 'tous' | 'a_installer' | 'installes' | 'mises_a_jour' | 'revue';

export const FILTER_LABEL: Record<StoreFilter, string> = {
  tous: 'Tous',
  a_installer: 'À installer',
  installes: 'Installés',
  mises_a_jour: 'Mises à jour',
  revue: 'En revue',
};

/** Vrai si le jeu entre dans le filtre choisi. Les jeux intégrés n’entrent que dans « Tous ». */
export function matchesFilter(game: StoreGame, filter: StoreFilter): boolean {
  switch (filter) {
    case 'tous':
      return true;
    case 'a_installer':
      return !game.builtin && (game.status === 'non_installe' || game.status === 'erreur');
    case 'installes':
      return game.status === 'a_jour' || game.status === 'mise_a_jour';
    case 'mises_a_jour':
      return game.status === 'mise_a_jour';
    case 'revue':
      return game.status === 'en_revue';
  }
}

/** Vrai si le texte cherché apparaît dans le nom, l’auteur, le type ou la description. */
export function matchesQuery(game: StoreGame, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('fr-FR');
  if (!q) return true;
  return [game.name, game.author, game.moduleLabel, game.description].some((field) =>
    field.toLocaleLowerCase('fr-FR').includes(q),
  );
}
