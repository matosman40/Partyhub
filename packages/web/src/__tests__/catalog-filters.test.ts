import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  applyFilters,
  countActiveFilters,
  durationBucket,
  parseFilters,
  resetFilters,
  writeFilters,
  type CatalogFilters,
  type FilterableGame,
} from '../catalog/filters.js';
import { readRecent, rememberRecent, RECENT_KEY, RECENT_LIMIT, type StorageLike } from '../catalog/recentGames.js';

const games: FilterableGame[] = [
  {
    id: 'quiz-a',
    name: 'Quiz Alpha',
    description: 'Questions générales.',
    category: 'quiz',
    minPlayers: 2,
    maxPlayers: 12,
    durationMin: 12,
    ai: true,
  },
  {
    id: 'role-b',
    name: 'Loup Bavard',
    description: 'Village et loups.',
    category: 'role',
    minPlayers: 5,
    maxPlayers: 10,
    durationMin: 25,
    ai: false,
  },
  {
    id: 'plateau-c',
    name: 'Bombes',
    description: 'Plateau explosif.',
    category: 'plateau',
    minPlayers: 2,
    maxPlayers: 4,
    durationMin: 8,
    ai: false,
  },
  {
    id: 'cartes-d',
    name: 'Éclat de cartes',
    description: 'Cartes et ambiance.',
    category: 'cartes',
    minPlayers: 3,
    maxPlayers: 8,
    durationMin: 40,
    ai: true,
  },
  {
    id: 'solo-e',
    name: 'Réflexe',
    description: 'Seul contre le temps.',
    category: 'solo',
    minPlayers: 1,
    maxPlayers: 1,
    durationMin: 5,
    ai: false,
  },
];

function filters(patch: Partial<CatalogFilters>): CatalogFilters {
  return { ...DEFAULT_FILTERS, ...patch };
}

function ids(list: FilterableGame[]): string[] {
  return list.map((g) => g.id);
}

describe('durationBucket', () => {
  it('range chaque durée dans une tranche, bornes comprises', () => {
    expect(durationBucket(9)).toBe('short');
    expect(durationBucket(10)).toBe('medium');
    expect(durationBucket(25)).toBe('medium');
    expect(durationBucket(26)).toBe('long');
  });
});

describe('applyFilters', () => {
  it('garde tout le catalogue sans filtre, trié par nom en français', () => {
    // Bombes, Éclat de cartes, Loup Bavard, Quiz Alpha, Réflexe
    expect(ids(applyFilters(games, DEFAULT_FILTERS))).toEqual(['plateau-c', 'cartes-d', 'role-b', 'quiz-a', 'solo-e']);
  });

  it('filtre sur un nombre de joueurs que le jeu accepte', () => {
    expect(ids(applyFilters(games, filters({ players: 1 })))).toEqual(['solo-e']);
    expect(ids(applyFilters(games, filters({ players: 4 }))).sort()).toEqual(
      ['cartes-d', 'plateau-c', 'quiz-a'].sort(),
    );
    expect(ids(applyFilters(games, filters({ players: 12 })))).toEqual(['quiz-a']);
  });

  it('filtre sur plusieurs catégories à la fois', () => {
    const result = applyFilters(games, filters({ categories: ['quiz', 'solo'] }));
    expect(ids(result).sort()).toEqual(['quiz-a', 'solo-e']);
  });

  it('filtre sur la tranche de durée', () => {
    expect(ids(applyFilters(games, filters({ duration: 'short' }))).sort()).toEqual(['plateau-c', 'solo-e']);
    expect(ids(applyFilters(games, filters({ duration: 'medium' }))).sort()).toEqual(['quiz-a', 'role-b']);
    expect(ids(applyFilters(games, filters({ duration: 'long' })))).toEqual(['cartes-d']);
  });

  it('filtre les jeux avec ou sans IA', () => {
    expect(ids(applyFilters(games, filters({ ai: 'yes' }))).sort()).toEqual(['cartes-d', 'quiz-a']);
    expect(ids(applyFilters(games, filters({ ai: 'no' }))).sort()).toEqual(['plateau-c', 'role-b', 'solo-e']);
  });

  it('ne garde que les jeux récents, dans l’ordre de jeu le plus récent', () => {
    const result = applyFilters(games, filters({ recent: true, sort: 'recent' }), ['solo-e', 'quiz-a']);
    expect(ids(result)).toEqual(['solo-e', 'quiz-a']);
  });

  it('trie les jeux récents d’abord quand le tri est « récents », les autres à la fin', () => {
    const result = applyFilters(games, filters({ sort: 'recent' }), ['role-b']);
    expect(ids(result)[0]).toBe('role-b');
    expect(ids(result).slice(1)).toEqual(['plateau-c', 'cartes-d', 'quiz-a', 'solo-e']);
  });

  it('trie par durée puis par nom, et par nombre de joueurs', () => {
    expect(ids(applyFilters(games, filters({ sort: 'duration' })))).toEqual([
      'solo-e',
      'plateau-c',
      'quiz-a',
      'role-b',
      'cartes-d',
    ]);
    expect(ids(applyFilters(games, filters({ sort: 'players' })))[0]).toBe('solo-e');
  });

  it('cherche sans tenir compte des accents ni de la casse, tous les mots doivent correspondre', () => {
    expect(ids(applyFilters(games, filters({ query: 'eclat' })))).toEqual(['cartes-d']);
    expect(ids(applyFilters(games, filters({ query: 'LOUPS village' })))).toEqual(['role-b']);
    expect(ids(applyFilters(games, filters({ query: 'loups quiz' })))).toEqual([]);
  });

  it('combine les filtres : tous doivent être respectés', () => {
    const result = applyFilters(games, filters({ categories: ['quiz', 'cartes'], ai: 'yes', duration: 'medium' }));
    expect(ids(result)).toEqual(['quiz-a']);
  });

  it('renvoie une liste vide quand rien ne correspond', () => {
    expect(applyFilters(games, filters({ players: 1, categories: ['quiz'] }))).toEqual([]);
  });
});

describe('URL des filtres', () => {
  it('ne met dans l’URL que les valeurs différentes de la valeur par défaut', () => {
    expect(writeFilters(DEFAULT_FILTERS).toString()).toBe('');
    const params = writeFilters(filters({ players: 4, categories: ['solo', 'quiz'], ai: 'yes', view: 'list' }));
    expect(params.get('joueurs')).toBe('4');
    expect(params.get('cat')).toBe('quiz,solo');
    expect(params.get('ia')).toBe('yes');
    expect(params.get('vue')).toBe('list');
    expect(params.has('duree')).toBe(false);
    expect(params.has('tri')).toBe(false);
  });

  it('relit ce qu’elle a écrit', () => {
    const original = filters({
      query: 'loup',
      players: 6,
      categories: ['role'],
      duration: 'medium',
      ai: 'no',
      recent: true,
      sort: 'duration',
      view: 'list',
    });
    expect(parseFilters(writeFilters(original))).toEqual(original);
  });

  it('garde les espaces saisis en cours de frappe', () => {
    expect(parseFilters(writeFilters(filters({ query: 'loup ' }))).query).toBe('loup ');
  });

  it('garde les paramètres étrangers à l’écran', () => {
    const base = new URLSearchParams('utm=abc');
    const params = writeFilters(filters({ players: 2 }), base);
    expect(params.get('utm')).toBe('abc');
    expect(params.get('joueurs')).toBe('2');
  });

  it('revient aux valeurs par défaut quand l’URL contient n’importe quoi', () => {
    const parsed = parseFilters(
      new URLSearchParams('joueurs=99&duree=trop&ia=peut-etre&tri=zz&vue=grille&cat=quiz,inconnu,quiz&recent=oui'),
    );
    expect(parsed.players).toBeNull();
    expect(parsed.duration).toBe('any');
    expect(parsed.ai).toBe('any');
    expect(parsed.sort).toBe('name');
    expect(parsed.view).toBe('cards');
    expect(parsed.categories).toEqual(['quiz']);
    expect(parsed.recent).toBe(false);
  });

  it('limite la recherche à 80 caractères', () => {
    expect(parseFilters(new URLSearchParams(`q=${'a'.repeat(200)}`)).query).toHaveLength(80);
  });
});

describe('compte et remise à zéro', () => {
  it('compte les filtres actifs sans compter le tri ni l’affichage', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters(filters({ sort: 'players', view: 'list' }))).toBe(0);
    expect(countActiveFilters(filters({ query: 'x', players: 2, categories: ['quiz'], recent: true }))).toBe(4);
  });

  it('remet les filtres à zéro en gardant le tri et l’affichage', () => {
    const cleared = resetFilters(filters({ query: 'x', players: 2, sort: 'duration', view: 'list' }));
    expect(cleared).toEqual({ ...DEFAULT_FILTERS, sort: 'duration', view: 'list' });
  });
});

describe('jeux récents', () => {
  function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
    const data = { ...initial };
    return {
      data,
      getItem: (key) => (key in data ? data[key]! : null),
      setItem: (key, value) => {
        data[key] = value;
      },
    };
  }

  it('renvoie une liste vide sans stockage ou sans valeur', () => {
    expect(readRecent(memoryStorage())).toEqual([]);
    expect(readRecent(null)).toEqual([]);
  });

  it('place le jeu lancé en tête, sans doublon', () => {
    const storage = memoryStorage();
    rememberRecent('quiz-a', storage);
    rememberRecent('solo-e', storage);
    expect(rememberRecent('quiz-a', storage)).toEqual(['quiz-a', 'solo-e']);
    expect(JSON.parse(storage.data[RECENT_KEY]!)).toEqual(['quiz-a', 'solo-e']);
  });

  it(`ne garde que les ${RECENT_LIMIT} derniers jeux`, () => {
    const storage = memoryStorage();
    for (let i = 0; i < RECENT_LIMIT + 5; i++) rememberRecent(`jeu-${i}`, storage);
    const list = readRecent(storage);
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toBe(`jeu-${RECENT_LIMIT + 4}`);
  });

  it('ignore une valeur stockée abîmée ou d’un autre format', () => {
    expect(readRecent(memoryStorage({ [RECENT_KEY]: '{pas du json' }))).toEqual([]);
    expect(readRecent(memoryStorage({ [RECENT_KEY]: '{"a":1}' }))).toEqual([]);
    expect(readRecent(memoryStorage({ [RECENT_KEY]: '["quiz-a", 3, "", "quiz-a"]' }))).toEqual(['quiz-a']);
  });

  it('ne plante pas quand le stockage refuse l’accès', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readRecent(broken)).toEqual([]);
    expect(rememberRecent('quiz-a', broken)).toEqual(['quiz-a']);
  });
});
