import { boardViews, cardViews, clientViews, mediaQuizViews, recipeViews } from '@partyhub/games/client';
import type { CodeViewRef } from '@partyhub/shared';
import { codeViewsFor } from './code-views/index.js';

/** Préfixe des jeux de cartes créés dans l’administration (voir le serveur). */
const CUSTOM_GAME_PREFIX = 'custom-';
/** Préfixe des jeux de questions médias créés dans l’administration (voir le serveur). */
const MEDIA_GAME_PREFIX = 'media-';
/** Préfixe des jeux de cartes installés à partir d’un paquet .phgame. */
const PACKAGE_CARD_PREFIX = 'pkg-';
/** Préfixe des jeux de plateau installés à partir d’un paquet .phgame (format 2). */
const PACKAGE_BOARD_PREFIX = 'pkgb-';
/** Préfixe des recettes installées à partir d’un paquet .phgame (format 3). */
const PACKAGE_RECIPE_PREFIX = 'pkgr-';
/** Préfixe des jeux de questions installés à partir d’un paquet .phgame (format 2). */
const PACKAGE_QUIZ_PREFIX = 'pkgq-';
/** Préfixe des jeux de plateau créés dans l’administration. */
const BOARD_GAME_PREFIX = 'board-';

/**
 * Vues navigateur par jeu : le routage des pages reste générique. Les jeux de
 * cartes personnalisés partagent la vue commune des jeux de cartes, et les jeux
 * de questions médias partagent la vue commune des questions médias.
 */
export function viewsFor(game: string | { id: string; codeView?: CodeViewRef }) {
  const gameId = typeof game === 'string' ? game : game.id;
  // Un jeu de code apporte ses propres vues (iframe) : il n’a jamais l’identifiant d’un jeu de l’application.
  const codeView = typeof game === 'string' ? undefined : game.codeView;
  if (codeView) return codeViewsFor(codeView);
  if (clientViews[gameId]) return clientViews[gameId];
  if (gameId.startsWith(CUSTOM_GAME_PREFIX) || gameId.startsWith(PACKAGE_CARD_PREFIX)) return cardViews;
  if (gameId.startsWith(MEDIA_GAME_PREFIX) || gameId.startsWith(PACKAGE_QUIZ_PREFIX)) return mediaQuizViews;
  if (gameId.startsWith(BOARD_GAME_PREFIX) || gameId.startsWith(PACKAGE_BOARD_PREFIX)) return boardViews;
  if (gameId.startsWith(PACKAGE_RECIPE_PREFIX)) return recipeViews;
  return null;
}
