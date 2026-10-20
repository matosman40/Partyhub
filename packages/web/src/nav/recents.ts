/**
 * Pages ouvertes récemment, gardées sur l’appareil (localStorage). Jamais bloquant : sans stockage (navigation
 * privée, blocage), la liste reste vide.
 */

export interface Recent {
  title: string;
  to: string;
}

const KEY = 'ph:recents';
const MAX = 6;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readRecents(store: Store | null = defaultStore()): Recent[] {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Recent => typeof item?.title === 'string' && typeof item?.to === 'string')
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** Met la page en tête de la liste, sans doublon. */
export function rememberRecent(entry: Recent, store: Store | null = defaultStore()): void {
  try {
    const next = [entry, ...readRecents(store).filter((item) => item.to !== entry.to)].slice(0, MAX);
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Stockage indisponible : rien à garder.
  }
}
