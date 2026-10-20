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
  /** Taille du paquet de la dernière version, en octets ; null si inconnue. */
  size: number | null;
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

export type StoreSort = 'statut' | 'nom';

export const SORT_LABEL: Record<StoreSort, string> = {
  statut: 'État (mises à jour d’abord)',
  nom: 'Nom (A à Z)',
};

/** Ordre d’affichage des états : ce qui demande une action vient en premier. */
const STATUS_RANK: Record<StoreStatus, number> = {
  mise_a_jour: 0,
  en_revue: 1,
  erreur: 2,
  non_installe: 3,
  a_jour: 4,
  integre: 5,
};

/** Trie les jeux sans modifier la liste d’origine. Le nom sert toujours de départage. */
export function sortGames(games: readonly StoreGame[], sort: StoreSort): StoreGame[] {
  const byName = (a: StoreGame, b: StoreGame) => a.name.localeCompare(b.name, 'fr-FR');
  return [...games].sort((a, b) => {
    if (sort === 'statut') {
      const diff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (diff !== 0) return diff;
    }
    return byName(a, b);
  });
}

/** Types de jeux présents dans le catalogue, dans l’ordre alphabétique. Sert de « genres » cliquables. */
export function storeTypes(games: readonly StoreGame[]): string[] {
  const seen = new Set(games.map((g) => g.moduleLabel).filter((label) => label.trim() !== ''));
  return [...seen].sort((a, b) => a.localeCompare(b, 'fr-FR'));
}

/** Vrai si le jeu appartient au type choisi (null = tous les types). */
export function matchesType(game: StoreGame, type: string | null): boolean {
  return type === null || game.moduleLabel === type;
}

/**
 * Jeu mis en avant en haut du magasin : le premier jeu téléchargeable qui a une couverture, sinon le premier
 * jeu du catalogue. Rien si le dépôt est vide.
 */
export function featuredGame(games: readonly StoreGame[]): StoreGame | null {
  return games.find((g) => !g.builtin && g.hasCover) ?? games[0] ?? null;
}

/** Taille lisible d’un paquet : « 840 o », « 412 Ko », « 2,4 Mo ». Tiret si inconnue. */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/** État du magasin dans l’adresse : ?q=…&f=…&t=…&s=… (seules les valeurs non par défaut sont écrites). */
export interface StoreParams {
  q: string;
  f: StoreFilter;
  t: string | null;
  s: StoreSort;
}

export const DEFAULT_STORE_PARAMS: StoreParams = { q: '', f: 'tous', t: null, s: 'statut' };

const FILTERS = Object.keys(FILTER_LABEL) as StoreFilter[];
const SORTS = Object.keys(SORT_LABEL) as StoreSort[];

/** Lit l’adresse. Une valeur inconnue revient à la valeur par défaut, sans erreur. */
export function parseStoreParams(search: URLSearchParams): StoreParams {
  const f = search.get('f') as StoreFilter | null;
  const s = search.get('s') as StoreSort | null;
  const t = search.get('t');
  return {
    q: (search.get('q') ?? '').slice(0, 100),
    f: f !== null && FILTERS.includes(f) ? f : DEFAULT_STORE_PARAMS.f,
    t: t !== null && t.trim() !== '' ? t : null,
    s: s !== null && SORTS.includes(s) ? s : DEFAULT_STORE_PARAMS.s,
  };
}

/** Écrit l’adresse : les valeurs par défaut n’y figurent pas, pour qu’un lien reste court. */
export function serializeStoreParams(params: StoreParams): URLSearchParams {
  const search = new URLSearchParams();
  // Pas de rognage : le champ de recherche est relié à l’adresse, une espace finale doit rester saisissable.
  if (params.q.trim() !== '') search.set('q', params.q);
  if (params.f !== DEFAULT_STORE_PARAMS.f) search.set('f', params.f);
  if (params.t !== null) search.set('t', params.t);
  if (params.s !== DEFAULT_STORE_PARAMS.s) search.set('s', params.s);
  return search;
}
