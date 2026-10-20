/**
 * Menu de l’administration : rubriques, puis sous-menus de chaque rubrique. Module sans React, testable à part.
 * Chaque sous-menu correspond à des sections de la page (voir `AdminPage`) ; chacune porte son identifiant.
 */

/** Rubriques du menu de l’administration. Le choix est dans l’adresse (?section=…) : le bouton précédent fonctionne. */
export const ADMIN_CATEGORIES = [
  {
    id: 'salles',
    title: 'Salles et statistiques',
    text: 'Salles ouvertes, parties lancées, nettoyage des salles sans connexion.',
  },
  {
    id: 'jeux',
    title: 'Jeux',
    text: 'Activer ou désactiver les jeux, leur présentation, leurs notices et leurs réglages par défaut.',
  },
  {
    id: 'creation',
    title: 'Créer des jeux',
    text: 'Jeux de cartes, de plateau et de questions médias, banques BOUM !, paquets importés.',
  },
  {
    id: 'ambiance',
    title: 'Médias et ambiance',
    text: 'Médiathèque, fonds d’écran, musiques, bruitages et personnages illustrés.',
  },
  {
    id: 'systeme',
    title: 'Système',
    text: 'Mise à jour, journal des erreurs, clés d’IA, réglages généraux, sauvegardes et base de données.',
  },
] as const;

export type AdminCategoryId = (typeof ADMIN_CATEGORIES)[number]['id'];

export interface AdminSubsection {
  id: string;
  title: string;
  text: string;
}

/** Sous-menus de chaque rubrique : une page courte à la fois, au lieu d’une longue liste. */
export const ADMIN_SUBSECTIONS: Record<AdminCategoryId, readonly AdminSubsection[]> = {
  salles: [{ id: 'apercu', title: 'Salles et statistiques', text: 'Salles ouvertes, parties lancées, nettoyage.' }],
  jeux: [
    { id: 'activation', title: 'Activation des jeux', text: 'Activer ou désactiver chaque jeu.' },
    { id: 'presentation', title: 'Présentation des jeux', text: 'Nom, couverture et description de chaque jeu.' },
    { id: 'reglages-parties', title: 'Réglages par défaut', text: 'Réglages de départ de chaque partie.' },
    { id: 'notices', title: 'Notices des jeux', text: 'Les explications affichées aux joueurs.' },
  ],
  creation: [
    { id: 'cartes', title: 'Jeux de cartes', text: 'Créer et modifier les jeux de cartes.' },
    { id: 'plateau', title: 'Jeux de plateau', text: 'Créer et modifier les jeux de plateau.' },
    { id: 'questions', title: 'Jeux de questions médias', text: 'Questions avec image, son ou vidéo.' },
    { id: 'boum', title: 'Banques BOUM !', text: 'Les banques de questions du jeu BOUM !' },
    { id: 'paquets', title: 'Paquets et sources', text: 'Paquets .phgame importés et sources GitHub.' },
  ],
  ambiance: [
    { id: 'mediatheque', title: 'Médiathèque', text: 'Images, polices et fichiers de la médiathèque.' },
    { id: 'fonds', title: 'Fonds d’écran', text: 'Les fonds affichés sur les écrans.' },
    { id: 'sons', title: 'Musiques et bruitages', text: 'Ambiance sonore de l’application et des jeux.' },
    { id: 'personnages', title: 'Personnages illustrés', text: 'Importer des personnages en archive zip.' },
  ],
  systeme: [
    {
      id: 'serveur',
      title: 'Réglages du serveur',
      text: 'Tout ce qui se réglait dans le fichier .env : jeton GitHub, journal, sauvegardes, réseau, images.',
    },
    { id: 'maj', title: 'Mise à jour', text: 'Version en cours et installation d’une version plus récente.' },
    { id: 'journal', title: 'Journal des erreurs', text: 'Erreurs signalées par l’application.' },
    { id: 'ia', title: 'Intelligence artificielle', text: 'Clés et réglages des fonctions d’IA.' },
    { id: 'reglages', title: 'Réglages et mode test', text: 'Réglages généraux de l’application et mode test.' },
    { id: 'sauvegarde', title: 'Sauvegarde et base', text: 'Sauvegarder, restaurer et gérer la base de données.' },
  ],
};

export function isAdminCategory(value: string | null): value is AdminCategoryId {
  return ADMIN_CATEGORIES.some((c) => c.id === value);
}
