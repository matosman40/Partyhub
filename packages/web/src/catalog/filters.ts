import type { GameCategory, GameInfo } from '@partyhub/shared';
import { CATEGORY_ORDER, MAX_PLAYER_CHOICE } from './labels.js';

/**
 * Logique pure du catalogue : filtres, recherche, tri et lecture de l'URL.
 * Aucune dépendance à React ni au navigateur, pour pouvoir la tester seule.
 */

export type Duration = 'any' | 'short' | 'medium' | 'long';
export type AiChoice = 'any' | 'yes' | 'no';
export type SortKey = 'name' | 'duration' | 'players' | 'recent';
export type ViewMode = 'cards' | 'list';

export interface CatalogFilters {
  /** Texte cherché dans le nom et la description. */
  query: string;
  /** Catégories retenues ; vide = toutes. */
  categories: GameCategory[];
  /** Nombre de joueurs souhaité ; le jeu doit l'accepter. null = indifférent. */
  players: number | null;
  duration: Duration;
  ai: AiChoice;
  /** Ne garder que les jeux joués récemment sur cet appareil. */
  recent: boolean;
  sort: SortKey;
  view: ViewMode;
}

export const DEFAULT_FILTERS: CatalogFilters = {
  query: '',
  categories: [],
  players: null,
  duration: 'any',
  ai: 'any',
  recent: false,
  sort: 'name',
  view: 'cards',
};

/** Champs que le jeu doit fournir pour être filtré et trié. */
export type FilterableGame = Pick<
  GameInfo,
  'id' | 'name' | 'description' | 'category' | 'minPlayers' | 'maxPlayers' | 'durationMin' | 'ai'
>;

export const DURATION_LABEL: Record<Duration, string> = {
  any: 'Toutes durées',
  short: 'Moins de 10 min',
  medium: 'De 10 à 25 min',
  long: 'Plus de 25 min',
};

export const AI_LABEL: Record<AiChoice, string> = {
  any: 'Peu importe',
  yes: 'Avec IA',
  no: 'Sans IA',
};

export const SORT_LABEL: Record<SortKey, string> = {
  name: 'Nom',
  duration: 'Durée',
  players: 'Nombre de joueurs',
  recent: 'Joués récemment',
};

const DURATIONS: Duration[] = ['any', 'short', 'medium', 'long'];
const AI_CHOICES: AiChoice[] = ['any', 'yes', 'no'];
const SORTS: SortKey[] = ['name', 'duration', 'players', 'recent'];
const VIEWS: ViewMode[] = ['cards', 'list'];

/** Tranche de durée d'un jeu : moins de 10 min, de 10 à 25 min (bornes comprises), plus de 25 min. */
export function durationBucket(minutes: number): Exclude<Duration, 'any'> {
  if (minutes < 10) return 'short';
  if (minutes <= 25) return 'medium';
  return 'long';
}

/** Minuscules, sans accents ni espaces superflus : la recherche ne dépend pas de la saisie. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Nombre de filtres actifs, recherche comprise (le tri et l'affichage ne comptent pas). */
export function countActiveFilters(f: CatalogFilters): number {
  return (
    (f.query.trim() ? 1 : 0) +
    (f.categories.length > 0 ? 1 : 0) +
    (f.players !== null ? 1 : 0) +
    (f.duration !== 'any' ? 1 : 0) +
    (f.ai !== 'any' ? 1 : 0) +
    (f.recent ? 1 : 0)
  );
}

/** Remet les filtres à zéro, en gardant le tri et l'affichage choisis. */
export function resetFilters(current: CatalogFilters): CatalogFilters {
  return { ...DEFAULT_FILTERS, sort: current.sort, view: current.view };
}

/** Garde les jeux qui respectent tous les filtres, puis les trie. `recentIds` est du plus récent au plus ancien. */
export function applyFilters<T extends FilterableGame>(
  games: readonly T[],
  f: CatalogFilters,
  recentIds: readonly string[] = [],
): T[] {
  const terms = normalize(f.query).split(' ').filter(Boolean);
  const recentRank = new Map<string, number>(recentIds.map((id, index) => [id, index]));

  const matched = games.filter((g) => {
    if (f.categories.length > 0 && !f.categories.includes(g.category)) return false;
    if (f.players !== null && (f.players < g.minPlayers || f.players > g.maxPlayers)) return false;
    if (f.duration !== 'any' && durationBucket(g.durationMin) !== f.duration) return false;
    if (f.ai === 'yes' && !g.ai) return false;
    if (f.ai === 'no' && g.ai) return false;
    if (f.recent && !recentRank.has(g.id)) return false;
    if (terms.length > 0) {
      const haystack = normalize(`${g.name} ${g.description}`);
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });

  return sortGames(matched, f.sort, recentRank);
}

function sortGames<T extends FilterableGame>(games: T[], sort: SortKey, recentRank: Map<string, number>): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'fr');
  const rank = (g: T) => recentRank.get(g.id) ?? Number.MAX_SAFE_INTEGER;
  const list = [...games];
  switch (sort) {
    case 'duration':
      return list.sort((a, b) => a.durationMin - b.durationMin || byName(a, b));
    case 'players':
      return list.sort((a, b) => a.minPlayers - b.minPlayers || a.maxPlayers - b.maxPlayers || byName(a, b));
    case 'recent':
      return list.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    default:
      return list.sort(byName);
  }
}

/**
 * Lit les filtres dans les paramètres d'URL. Une valeur inconnue revient à la valeur par défaut,
 * ce qui protège l'écran contre une URL modifiée à la main.
 */
export function parseFilters(params: URLSearchParams): CatalogFilters {
  const categories = [...new Set((params.get('cat') ?? '').split(','))].filter((c): c is GameCategory =>
    (CATEGORY_ORDER as string[]).includes(c),
  );
  const players = Number(params.get('joueurs'));
  return {
    query: (params.get('q') ?? '').slice(0, 80),
    categories,
    players: Number.isInteger(players) && players >= 1 && players <= MAX_PLAYER_CHOICE ? players : null,
    duration: pick(params.get('duree'), DURATIONS, 'any'),
    ai: pick(params.get('ia'), AI_CHOICES, 'any'),
    recent: params.get('recent') === '1',
    sort: pick(params.get('tri'), SORTS, 'name'),
    view: pick(params.get('vue'), VIEWS, 'cards'),
  };
}

/**
 * Écrit les filtres dans les paramètres d'URL. Une valeur par défaut n'apparaît pas dans l'URL,
 * les paramètres étrangers sont conservés.
 */
export function writeFilters(f: CatalogFilters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const out = new URLSearchParams(base);
  const set = (key: string, value: string | null) => {
    if (value === null || value === '') out.delete(key);
    else out.set(key, value);
  };
  const categories = CATEGORY_ORDER.filter((c) => f.categories.includes(c));
  // La saisie est gardée telle quelle : couper les espaces ici empêcherait de taper plusieurs mots.
  set('q', f.query.trim() === '' ? null : f.query);
  set('cat', categories.length > 0 ? categories.join(',') : null);
  set('joueurs', f.players === null ? null : String(f.players));
  set('duree', f.duration === 'any' ? null : f.duration);
  set('ia', f.ai === 'any' ? null : f.ai);
  set('recent', f.recent ? '1' : null);
  set('tri', f.sort === 'name' ? null : f.sort);
  set('vue', f.view === 'cards' ? null : f.view);
  return out;
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}
