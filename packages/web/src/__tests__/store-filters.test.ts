import { describe, expect, it } from 'vitest';
import {
  featuredGame,
  formatSize,
  matchesFilter,
  matchesQuery,
  matchesType,
  sortGames,
  storeTypes,
  type StoreGame,
  type StoreStatus,
} from '../admin/store-filters.js';

function game(overrides: Partial<StoreGame> = {}): StoreGame {
  return {
    id: 'quiz-party',
    tag: 'quiz-party-v1.0.0',
    latestVersion: '1.0.0',
    name: 'Quiz Party',
    description: 'Des questions entre amis.',
    author: 'Camille',
    moduleLabel: 'Questions',
    hasCover: false,
    error: null,
    builtin: false,
    status: 'non_installe' as StoreStatus,
    installedVersion: null,
    pendingVersion: null,
    autoUpdate: false,
    lastError: null,
    size: null,
    ...overrides,
  };
}

describe('filtres du magasin', () => {
  it('« Tous » garde chaque jeu, y compris les jeux intégrés', () => {
    expect(matchesFilter(game({ builtin: true, status: 'integre' }), 'tous')).toBe(true);
  });

  it('« À installer » : jeux jamais installés ou en échec, jamais les jeux intégrés', () => {
    expect(matchesFilter(game({ status: 'non_installe' }), 'a_installer')).toBe(true);
    expect(matchesFilter(game({ status: 'erreur' }), 'a_installer')).toBe(true);
    expect(matchesFilter(game({ builtin: true, status: 'integre' }), 'a_installer')).toBe(false);
    expect(matchesFilter(game({ status: 'a_jour' }), 'a_installer')).toBe(false);
  });

  it('« Installés » couvre les jeux à jour et ceux avec une mise à jour prête', () => {
    expect(matchesFilter(game({ status: 'a_jour' }), 'installes')).toBe(true);
    expect(matchesFilter(game({ status: 'mise_a_jour' }), 'installes')).toBe(true);
    expect(matchesFilter(game({ status: 'non_installe' }), 'installes')).toBe(false);
  });

  it('« Mises à jour » et « En revue » ne retiennent que leur état', () => {
    expect(matchesFilter(game({ status: 'mise_a_jour' }), 'mises_a_jour')).toBe(true);
    expect(matchesFilter(game({ status: 'a_jour' }), 'mises_a_jour')).toBe(false);
    expect(matchesFilter(game({ status: 'en_revue' }), 'revue')).toBe(true);
    expect(matchesFilter(game({ status: 'a_jour' }), 'revue')).toBe(false);
  });
});

describe('recherche du magasin', () => {
  it('une recherche vide ou blanche retient tous les jeux', () => {
    expect(matchesQuery(game(), '')).toBe(true);
    expect(matchesQuery(game(), '   ')).toBe(true);
  });

  it('cherche dans le nom, l’auteur, le type et la description, sans tenir compte de la casse', () => {
    expect(matchesQuery(game(), 'quiz')).toBe(true);
    expect(matchesQuery(game(), 'CAMILLE')).toBe(true);
    expect(matchesQuery(game(), 'questions')).toBe(true);
    expect(matchesQuery(game(), 'entre amis')).toBe(true);
    expect(matchesQuery(game(), 'poker')).toBe(false);
  });

  it('ignore les espaces autour du texte cherché', () => {
    expect(matchesQuery(game(), '  quiz  ')).toBe(true);
  });

  it('tient compte des accents en majuscules', () => {
    expect(matchesQuery(game({ name: 'Éclair Party' }), 'éclair')).toBe(true);
    expect(matchesQuery(game({ name: 'Éclair Party' }), 'ÉCLAIR')).toBe(true);
  });
});

describe('tri, types et jeu mis en avant', () => {
  const games = [
    game({ id: 'b', name: 'Bombes', status: 'a_jour', moduleLabel: 'Cartes' }),
    game({ id: 'a', name: 'Animaux', status: 'mise_a_jour', moduleLabel: 'Questions' }),
    game({ id: 'c', name: 'Cuisine', status: 'non_installe', moduleLabel: 'Recettes', hasCover: true }),
    game({ id: 'i', name: 'Intégré', builtin: true, status: 'integre', moduleLabel: 'Cartes' }),
  ];

  it('trie par état : mises à jour d’abord, intégrés en dernier', () => {
    expect(sortGames(games, 'statut').map((g) => g.id)).toEqual(['a', 'c', 'b', 'i']);
  });

  it('trie par nom sans tenir compte des accents ni des majuscules', () => {
    expect(sortGames(games, 'nom').map((g) => g.name)).toEqual(['Animaux', 'Bombes', 'Cuisine', 'Intégré']);
  });

  it('ne modifie pas la liste d’origine', () => {
    const before = games.map((g) => g.id);
    sortGames(games, 'nom');
    expect(games.map((g) => g.id)).toEqual(before);
  });

  it('liste les types distincts, triés, sans libellé vide', () => {
    expect(storeTypes([...games, game({ id: 'v', moduleLabel: '  ' })])).toEqual(['Cartes', 'Questions', 'Recettes']);
  });

  it('filtre par type, ou garde tout si aucun type n’est choisi', () => {
    expect(matchesType(games[0], null)).toBe(true);
    expect(matchesType(games[0], 'Cartes')).toBe(true);
    expect(matchesType(games[0], 'Recettes')).toBe(false);
  });

  it('met en avant le premier jeu téléchargeable avec une couverture', () => {
    expect(featuredGame(games)?.id).toBe('c');
  });

  it('sans couverture, met en avant le premier jeu ; sans jeu, rien', () => {
    expect(featuredGame([game({ id: 'x' })])?.id).toBe('x');
    expect(featuredGame([])).toBeNull();
  });
});

describe('taille des paquets', () => {
  it('affiche des octets, des kilo-octets ou des méga-octets, en français', () => {
    expect(formatSize(null)).toBe('—');
    expect(formatSize(840)).toBe('840 o');
    expect(formatSize(412 * 1024)).toBe('412 Ko');
    expect(formatSize(Math.round(2.4 * 1024 * 1024))).toBe('2,4 Mo');
  });
});
