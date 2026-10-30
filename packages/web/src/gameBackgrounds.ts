/**
 * Fonds illustrés (images WebP 1280x720 servies par l'application, dossier public/game-backgrounds) et images des
 * menus (public/menus). Un jeu absent de la liste garde sa scène dessinée : rami-51, poker-texas et les jeux
 * ajoutés plus tard n'ont pas de fond, et l'écran reste correct sans.
 */

const GAMES_WITH_BACKGROUND: ReadonlySet<string> = new Set([
  'association',
  'aventure-ia',
  'banquise',
  'bombes-party',
  'boum',
  'cartes-coco',
  'cartes-couleurs',
  'essai-appareils',
  'funambule',
  'gags-en-rafale',
  'imite-moi',
  'imposteur',
  'loups-village',
  'micro-defis',
  'mots-croises',
  'phrases-trous',
  'plus-ou-moins',
  'plutot-qui',
  'president',
  'promoteur',
  'quiz-party',
  'reflexe',
  'sauteurs',
  'solitaire',
  'sudoku',
  'taquin',
  'tarot',
]);

export type MenuImage =
  'accueil' | 'salon' | 'rejoindre-telephone' | 'victoire' | 'egalite' | 'fin-de-partie' | 'bandeau-catalogue';

export function menuImageUrl(name: MenuImage): string {
  return `/menus/${name}.webp`;
}

/** Adresse du fond d'un jeu, ou null s'il n'en a pas. */
export function gameBackgroundUrl(gameId: string): string | null {
  return GAMES_WITH_BACKGROUND.has(gameId) ? `/game-backgrounds/${gameId}.webp` : null;
}
