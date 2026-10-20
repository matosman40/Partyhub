import { describe, expect, it } from 'vitest';
import { matchesFilter, matchesQuery, type StoreGame, type StoreStatus } from '../admin/store-filters.js';

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
