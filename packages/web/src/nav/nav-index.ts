import type { CatalogGame } from '@partyhub/shared';
import { ADMIN_CATEGORIES, ADMIN_SUBSECTIONS } from '../pages/admin-menu.js';

/**
 * Index de navigation : pages, sous-sections de l’administration et jeux, pour la recherche (Ctrl+K ou bouton).
 * Module sans React, testable à part.
 */

export type NavGroup = 'Récent' | 'Aller à' | 'Administration' | 'Jeux';

export interface NavItem {
  id: string;
  title: string;
  subtitle: string;
  to: string;
  group: NavGroup;
  /** Mots qui font trouver l’entrée sans en porter le nom (« GitHub » pour le magasin, « logs » pour le journal). */
  keywords: readonly string[];
}

/** Ordre d’affichage des groupes. */
export const GROUP_ORDER: readonly NavGroup[] = ['Récent', 'Aller à', 'Administration', 'Jeux'];

export const PAGE_ITEMS: readonly NavItem[] = [
  {
    id: 'accueil',
    title: 'Accueil',
    subtitle: 'Choisir un jeu et ouvrir une salle',
    to: '/',
    group: 'Aller à',
    keywords: ['home', 'jeux', 'catalogue'],
  },
  {
    id: 'rejoindre',
    title: 'Rejoindre une salle',
    subtitle: 'Saisir le code affiché sur l’écran',
    to: '/join',
    group: 'Aller à',
    keywords: ['code', 'salle', 'téléphone'],
  },
  {
    id: 'magasin',
    title: 'Magasin de jeux',
    subtitle: 'Découvrir et installer des jeux publiés',
    to: '/magasin',
    group: 'Aller à',
    keywords: ['installer', 'télécharger', 'github', 'nouveaux jeux'],
  },
  {
    id: 'profil',
    title: 'Mon profil',
    subtitle: 'Nom, mot de passe et profils de cet appareil',
    to: '/profil',
    group: 'Aller à',
    keywords: ['compte', 'mot de passe', 'joueur', 'nom'],
  },
  {
    id: 'test',
    title: 'Tester micro, caméra, image',
    subtitle: 'Vérifier les appareils avant une soirée',
    to: '/test-appareils',
    group: 'Aller à',
    keywords: ['micro', 'caméra', 'capteurs', 'mouvement', 'gyroscope'],
  },
  {
    id: 'certificat',
    title: 'Installer le certificat HTTPS',
    subtitle: 'Autoriser PartyHub sur ce téléphone ou cet ordinateur',
    to: '/certificat',
    group: 'Aller à',
    keywords: ['https', 'certificat', 'iphone', 'android', 'sécurité'],
  },
  {
    id: 'admin',
    title: 'Administration',
    subtitle: 'Réglages, jeux, médiathèque, système',
    to: '/admin',
    group: 'Aller à',
    keywords: ['réglages', 'configuration', 'serveur'],
  },
];

/** Mots de recherche des sous-sections de l’administration, par « rubrique/sous-section ». */
const SUB_KEYWORDS: Record<string, readonly string[]> = {
  'salles/apercu': ['salles', 'parties', 'nettoyage', 'statistiques'],
  'jeux/activation': ['activer', 'désactiver', 'jeux'],
  'jeux/presentation': ['nom', 'icône', 'description', 'présentation', 'durée'],
  'jeux/reglages-parties': ['réglages', 'défaut', 'parties', 'joueurs'],
  'jeux/notices': ['règles', 'explications', 'notice'],
  'creation/cartes': ['cartes', 'créer', 'jeu de cartes'],
  'creation/plateau': ['plateau', 'créer', 'jeu de plateau'],
  'creation/questions': ['questions', 'médias', 'vidéo', 'youtube', 'image', 'son'],
  'creation/boum': ['boum', 'banque', 'questions'],
  'creation/paquets': ['paquets', 'phgame', 'import', 'github', 'source', 'jeux de code', 'revue', 'approuver'],
  'ambiance/mediatheque': ['médiathèque', 'images', 'polices', 'fichiers'],
  'ambiance/fonds': ['fond', 'écran', 'décor'],
  'ambiance/sons': ['musique', 'son', 'bruitage', 'audio'],
  'ambiance/personnages': ['personnages', 'illustrés', 'zip', 'archive'],
  'systeme/serveur': [
    'réglages du serveur',
    'env',
    'fichier env',
    'github',
    'jeton',
    'journal',
    'sauvegarde',
    'réseau',
    'images',
    'mot de passe',
    'redémarrer',
  ],
  'systeme/maj': ['mise à jour', 'version', 'update'],
  'systeme/journal': ['journal', 'logs', 'erreurs', 'fichier'],
  'systeme/ia': ['ia', 'intelligence artificielle', 'clé', 'api', 'groq', 'mistral', 'openai', 'anthropic'],
  'systeme/reglages': ['mode test', 'réglages', 'émotions', 'voix'],
  'systeme/sauvegarde': ['sauvegarde', 'backup', 'restaurer', 'base', 'exporter'],
};

/** Minuscules, sans accents : « Médiathèque » trouve « mediatheque ». */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr-FR')
    .trim();
}

/** Une entrée par sous-section de l’administration. */
export function adminNavItems(): NavItem[] {
  return ADMIN_CATEGORIES.flatMap((category) =>
    ADMIN_SUBSECTIONS[category.id].map((sub) => ({
      id: `admin-${category.id}-${sub.id}`,
      title: sub.title,
      subtitle: `${category.title} · ${sub.text}`,
      to: `/admin?section=${category.id}&sub=${sub.id}`,
      group: 'Administration' as const,
      keywords: [category.title, ...(SUB_KEYWORDS[`${category.id}/${sub.id}`] ?? [])],
    })),
  );
}

/** Jeux visibles dans le catalogue (ceux qui s’affichent à l’accueil). */
export function gameNavItems(games: readonly Pick<CatalogGame, 'id' | 'name' | 'enabled' | 'listed'>[]): NavItem[] {
  return games
    .filter((game) => game.enabled && game.listed)
    .map((game) => ({
      id: `jeu-${game.id}`,
      title: game.name,
      subtitle: 'Jeu',
      to: `/jeux/${game.id}`,
      group: 'Jeux' as const,
      keywords: [],
    }));
}

/**
 * Entrées correspondant à la recherche, meilleures d’abord : le nom commence par la recherche, puis le nom contient
 * tous les mots, puis les mots se trouvent ailleurs (sous-titre, mots-clés). Une recherche vide renvoie les entrées telles quelles.
 */
export function searchNav(items: readonly NavItem[], query: string, limit = 40): NavItem[] {
  const tokens = normalizeText(query)
    .split(/\s+/)
    .filter((token) => token !== '');
  if (tokens.length === 0) return items.slice(0, limit);
  const phrase = tokens.join(' ');
  const scored: { item: NavItem; score: number }[] = [];
  for (const item of items) {
    const title = normalizeText(item.title);
    const haystack = normalizeText([item.title, item.subtitle, ...item.keywords].join(' '));
    if (!tokens.every((token) => haystack.includes(token))) continue;
    const score = title.startsWith(phrase) ? 3 : tokens.every((token) => title.includes(token)) ? 2 : 1;
    scored.push({ item, score });
  }
  // Tri stable : à score égal, l’ordre d’origine (groupes, puis ordre des menus) est conservé.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}

/**
 * Entrée de navigation de l’adresse courante, pour la liste des pages récentes. Null si la page n’a pas
 * d’entrée (salle de jeu, catégorie seule de l’administration…).
 */
export function navItemForLocation(
  pathname: string,
  search: string,
  items: readonly NavItem[] = [...PAGE_ITEMS, ...adminNavItems()],
): NavItem | null {
  if (pathname === '/admin') {
    const params = new URLSearchParams(search);
    const section = params.get('section');
    const sub = params.get('sub');
    if (!section || !sub) return null;
    return items.find((item) => item.id === `admin-${section}-${sub}`) ?? null;
  }
  return items.find((item) => item.to === pathname) ?? null;
}
