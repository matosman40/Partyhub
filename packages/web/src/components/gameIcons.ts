/** Identifiants des jeux intégrés qui possèdent une vignette illustrée dans public/game-icons. */
const GAME_ICON_IDS = new Set([
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
  'poker-texas',
  'president',
  'promoteur',
  'quiz-party',
  'rami-51',
  'reflexe',
  'sauteurs',
  'solitaire',
  'sudoku',
  'taquin',
  'tarot',
]);

export function hasGameIcon(gameId: string): boolean {
  return GAME_ICON_IDS.has(gameId);
}
