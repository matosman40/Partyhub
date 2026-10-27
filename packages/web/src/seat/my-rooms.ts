/**
 * Salles auxquelles cet appareil participe : leurs codes, pour afficher « Parties en cours » sur l’accueil.
 * Stocké sur l’appareil seulement (jamais une liste publique de salles). Les codes sont retirés quand la
 * salle n’existe plus ou est terminée, lors de l’affichage de l’accueil.
 */
export const MY_ROOMS_KEY = 'ph:mes-salles';
export const MAX_MY_ROOMS = 12;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Liste des codes mémorisés, du plus récent au plus ancien. Vide si rien ou si le contenu est illisible. */
export function readMyRooms(store: Store | null = defaultStore()): string[] {
  try {
    const raw = store?.getItem(MY_ROOMS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(list)) return [];
    return list.filter((c): c is string => typeof c === 'string' && c.length > 0).slice(0, MAX_MY_ROOMS);
  } catch {
    return [];
  }
}

/** Ajoute (ou remonte en tête) un code de salle. */
export function rememberMyRoom(code: string, store: Store | null = defaultStore()): void {
  if (!code) return;
  const next = [code, ...readMyRooms(store).filter((c) => c !== code)].slice(0, MAX_MY_ROOMS);
  try {
    store?.setItem(MY_ROOMS_KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : l’accueil ne proposera simplement pas la salle */
  }
}

/** Remplace la liste (utilisé après vérification des salles encore ouvertes). */
export function saveMyRooms(codes: string[], store: Store | null = defaultStore()): void {
  try {
    store?.setItem(MY_ROOMS_KEY, JSON.stringify(codes.slice(0, MAX_MY_ROOMS)));
  } catch {
    /* sans effet */
  }
}
