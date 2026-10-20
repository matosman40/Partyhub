import { describe, expect, it } from 'vitest';
import { ADMIN_SUBSECTIONS } from '../pages/admin-menu.js';
import {
  adminNavItems,
  gameNavItems,
  navItemForLocation,
  normalizeText,
  PAGE_ITEMS,
  searchNav,
  type NavItem,
} from '../nav/nav-index.js';

function item(overrides: Partial<NavItem> & { title: string }): NavItem {
  return {
    id: overrides.title,
    subtitle: '',
    to: '/',
    group: 'Aller à',
    keywords: [],
    ...overrides,
  };
}

describe('normalizeText', () => {
  it('met en minuscules et retire les accents', () => {
    expect(normalizeText('Médiathèque')).toBe('mediatheque');
    expect(normalizeText('  Ça  ')).toBe('ca');
  });
});

describe('searchNav', () => {
  const items = [
    item({ title: 'Magasin de jeux', subtitle: 'Découvrir', keywords: ['installer'] }),
    item({ title: 'Installer un jeu', subtitle: 'magasin inside' }),
    item({ title: 'Accueil', subtitle: 'Choisir un jeu', keywords: ['home'] }),
  ];

  it('une recherche vide renvoie les entrées telles quelles', () => {
    expect(searchNav(items, '   ')).toEqual(items);
  });

  it('place en tête une entrée dont le nom commence par la recherche', () => {
    const found = searchNav(items, 'magasin').map((entry) => entry.title);
    expect(found).toEqual(['Magasin de jeux', 'Installer un jeu']);
  });

  it('exige que chaque mot soit trouvé', () => {
    expect(searchNav(items, 'magasin accueil')).toEqual([]);
    expect(searchNav(items, 'jeu installer').map((entry) => entry.title)).toEqual([
      'Installer un jeu',
      'Magasin de jeux',
    ]);
  });

  it('ne tient pas compte des accents ni de la casse', () => {
    const admin = adminNavItems();
    const found = searchNav(admin, 'MEDIATHEQUE').map((entry) => entry.to);
    expect(found).toContain('/admin?section=ambiance&sub=mediatheque');
  });

  it('trouve une entrée par un mot-clé sans son nom', () => {
    const found = searchNav(adminNavItems(), 'github').map((entry) => entry.to);
    expect(found).toContain('/admin?section=systeme&sub=serveur');
  });

  it('renvoie une liste vide si rien ne correspond', () => {
    expect(searchNav(items, 'zzzz')).toEqual([]);
  });

  it('respecte la limite', () => {
    expect(searchNav(items, '', 2)).toHaveLength(2);
  });
});

describe('adminNavItems', () => {
  it('a une entrée par sous-section, sans doublon', () => {
    const items = adminNavItems();
    const expected = Object.values(ADMIN_SUBSECTIONS).reduce((sum, subs) => sum + subs.length, 0);
    expect(items).toHaveLength(expected);
    expect(new Set(items.map((entry) => entry.id)).size).toBe(expected);
  });

  it('pointe vers la rubrique et la sous-section dans l’adresse', () => {
    const jeux = adminNavItems().find((entry) => entry.id === 'admin-jeux-presentation');
    expect(jeux?.to).toBe('/admin?section=jeux&sub=presentation');
    expect(jeux?.subtitle.startsWith('Jeux · ')).toBe(true);
  });
});

describe('gameNavItems', () => {
  it('ne propose que les jeux activés et visibles', () => {
    const items = gameNavItems([
      { id: 'a', name: 'Alpha', enabled: true, listed: true },
      { id: 'b', name: 'Bêta', enabled: false, listed: true },
      { id: 'c', name: 'Gamma', enabled: true, listed: false },
    ]);
    expect(items.map((entry) => entry.to)).toEqual(['/jeux/a']);
    expect(items[0]?.group).toBe('Jeux');
  });
});

describe('PAGE_ITEMS', () => {
  it('ont des identifiants uniques et des adresses internes', () => {
    expect(new Set(PAGE_ITEMS.map((entry) => entry.id)).size).toBe(PAGE_ITEMS.length);
    for (const entry of PAGE_ITEMS) expect(entry.to.startsWith('/')).toBe(true);
  });
});

describe('navItemForLocation', () => {
  it('retrouve la sous-section de l’administration depuis l’adresse', () => {
    expect(navItemForLocation('/admin', '?section=systeme&sub=serveur')?.title).toBe('Réglages du serveur');
  });

  it('retrouve une page simple', () => {
    expect(navItemForLocation('/magasin', '')?.title).toBe('Magasin de jeux');
  });

  it('ne retient pas une rubrique seule ni une salle de jeu', () => {
    expect(navItemForLocation('/admin', '?section=jeux')).toBeNull();
    expect(navItemForLocation('/tv/ABCD', '')).toBeNull();
  });
});
