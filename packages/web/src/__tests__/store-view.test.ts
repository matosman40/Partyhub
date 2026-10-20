import { describe, expect, it } from 'vitest';
import {
  countByFilter,
  describeOutcome,
  filterGames,
  installableIds,
  jobProgress,
  normalizeText,
  removableIds,
  shortStatus,
  updatableIds,
  type JobView,
  type StoreGame,
} from '../admin/storeView.js';

function game(overrides: Partial<StoreGame> & Pick<StoreGame, 'id' | 'name'>): StoreGame {
  return {
    tag: `${overrides.id}-v1.0.0`,
    latestVersion: '1.0.0',
    description: '',
    author: 'Atelier',
    moduleLabel: 'Jeu de cartes',
    hasCover: false,
    error: null,
    builtin: false,
    status: 'non_installe',
    installedVersion: null,
    pendingVersion: null,
    autoUpdate: false,
    lastError: null,
    ...overrides,
  };
}

const catalog: StoreGame[] = [
  game({ id: 'ponts', name: 'Ponts', author: 'Zoé' }),
  game({
    id: 'frontieres',
    name: 'Frontières',
    author: 'Abel',
    status: 'a_jour',
    installedVersion: '1.0.0',
    autoUpdate: true,
  }),
  game({
    id: 'eleve',
    name: 'Élève modèle',
    author: 'Léa',
    status: 'mise_a_jour',
    installedVersion: '1.0.0',
    latestVersion: '1.1.0',
  }),
  game({ id: 'casse', name: 'Casse-tête', status: 'erreur', lastError: 'archive refusée' }),
  game({ id: 'erreur-liste', name: 'Liste en erreur', error: 'Dépôt injoignable' }),
  game({ id: 'attente', name: 'Attente', status: 'en_revue', pendingVersion: '2.0.0' }),
  game({ id: 'integre', name: 'Intégré', builtin: true, status: 'integre' }),
];

describe('filtres du magasin', () => {
  it('« disponibles » : ce qu’on peut installer maintenant, ni intégré ni en erreur de liste', () => {
    const ids = filterGames(catalog, { query: '', filter: 'disponibles', sort: 'nom' }).map((g) => g.id);
    expect(ids).toEqual(['casse', 'ponts']);
  });

  it('« installés » et « mises à jour » suivent l’état installé', () => {
    expect(filterGames(catalog, { query: '', filter: 'installes', sort: 'nom' }).map((g) => g.id)).toEqual([
      'attente',
      'eleve',
      'frontieres',
    ]);
    expect(filterGames(catalog, { query: '', filter: 'mises_a_jour', sort: 'nom' }).map((g) => g.id)).toEqual([
      'eleve',
    ]);
  });

  it('« erreurs » garde les jeux en échec, et ceux que le dépôt n’a pas pu lire', () => {
    expect(filterGames(catalog, { query: '', filter: 'erreurs', sort: 'nom' }).map((g) => g.id)).toEqual([
      'casse',
      'erreur-liste',
    ]);
  });

  it('la recherche ignore la casse et les accents, et cherche aussi l’auteur', () => {
    expect(filterGames(catalog, { query: 'ELEVE', filter: 'tous', sort: 'nom' }).map((g) => g.id)).toEqual(['eleve']);
    expect(filterGames(catalog, { query: 'zoe', filter: 'tous', sort: 'nom' }).map((g) => g.id)).toEqual(['ponts']);
    expect(filterGames(catalog, { query: 'introuvable', filter: 'tous', sort: 'nom' })).toEqual([]);
  });

  it('le tri « installés d’abord » place les jeux installés en tête, puis par nom', () => {
    const ids = filterGames(catalog, { query: '', filter: 'tous', sort: 'installes' }).map((g) => g.id);
    expect(ids.slice(0, 3)).toEqual(['attente', 'eleve', 'frontieres']);
    expect(ids.indexOf('ponts')).toBeGreaterThan(ids.indexOf('frontieres'));
  });

  it('le compteur de chaque filtre ne tient pas compte de la recherche', () => {
    const counts = countByFilter(catalog);
    expect(counts.tous).toBe(catalog.length);
    expect(counts.integres).toBe(1);
    expect(counts.disponibles).toBe(2);
  });
});

describe('actions en lot', () => {
  it('installer, mettre à jour et supprimer ne visent que les jeux concernés', () => {
    expect(installableIds(catalog)).toEqual(['ponts', 'casse']);
    expect(updatableIds(catalog)).toEqual(['eleve']);
    expect(removableIds(catalog)).toEqual(['frontieres', 'eleve', 'attente']);
  });

  it('un jeu intégré ne se télécharge, ne se met pas à jour et ne se supprime pas', () => {
    expect(installableIds(catalog)).not.toContain('integre');
    expect(updatableIds(catalog)).not.toContain('integre');
    expect(removableIds(catalog)).not.toContain('integre');
  });
});

describe('affichage', () => {
  it('l’état court se lit en un mot', () => {
    expect(shortStatus(game({ id: 'a', name: 'A', status: 'mise_a_jour' }))).toBe('Mise à jour');
    expect(shortStatus(game({ id: 'b', name: 'B', status: 'non_installe' }))).toBe('Disponible');
    expect(shortStatus(game({ id: 'c', name: 'C', status: 'erreur' }))).toBe('Échec');
  });

  it('la normalisation retire les accents et passe en minuscules', () => {
    expect(normalizeText('Élève Été')).toBe('eleve ete');
  });

  it('une réponse d’échec garde ses problèmes détaillés', () => {
    expect(describeOutcome({ ok: false, error: 'Paquet refusé.', issues: ['version absente'] })).toBe(
      'Paquet refusé. version absente',
    );
    expect(describeOutcome({ ok: true, status: 'installé', version: '1.2.0' })).toBe('installé : version 1.2.0.');
  });
});

describe('file d’installation', () => {
  it('compte les jeux traités, et sait quand la file est finie', () => {
    const job: JobView = {
      action: 'install',
      startedAt: '2026-10-20T08:00:00.000Z',
      finishedAt: null,
      items: [
        { id: 'a', name: 'A', state: 'ok', message: null },
        { id: 'b', name: 'B', state: 'erreur', message: 'refusé' },
        { id: 'c', name: 'C', state: 'en_cours', message: null },
        { id: 'd', name: 'D', state: 'attente', message: null },
      ],
    };
    expect(jobProgress(job)).toEqual({ done: 2, total: 4, finished: false });
    expect(jobProgress({ ...job, finishedAt: '2026-10-20T08:05:00.000Z' }).finished).toBe(true);
  });
});
