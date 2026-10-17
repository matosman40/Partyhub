import { boardViews, cardViews, clientViews, mediaQuizViews } from '@partyhub/games/client';

/** Préfixe des jeux de cartes créés dans l’administration (voir le serveur). */
const CUSTOM_GAME_PREFIX = 'custom-';
/** Préfixe des jeux de questions médias créés dans l’administration (voir le serveur). */
const MEDIA_GAME_PREFIX = 'media-';
/** Préfixe des jeux de cartes installés à partir d’un paquet .phgame. */
const PACKAGE_CARD_PREFIX = 'pkg-';
/** Préfixe des jeux de plateau installés à partir d’un paquet .phgame (format 2). */
const PACKAGE_BOARD_PREFIX = 'pkgb-';
/** Préfixe des jeux de questions installés à partir d’un paquet .phgame (format 2). */
const PACKAGE_QUIZ_PREFIX = 'pkgq-';
/** Préfixe des jeux de plateau créés dans l’administration. */
const BOARD_GAME_PREFIX = 'board-';

/**
 * Vues navigateur par jeu : le routage des pages reste générique. Les jeux de
 * cartes personnalisés partagent la vue commune des jeux de cartes, et les jeux
 * de questions médias partagent la vue commune des questions médias.
 */
export function viewsFor(gameId: string) {
  if (clientViews[gameId]) return clientViews[gameId];
  if (gameId.startsWith(CUSTOM_GAME_PREFIX) || gameId.startsWith(PACKAGE_CARD_PREFIX)) return cardViews;
  if (gameId.startsWith(MEDIA_GAME_PREFIX) || gameId.startsWith(PACKAGE_QUIZ_PREFIX)) return mediaQuizViews;
  if (gameId.startsWith(BOARD_GAME_PREFIX) || gameId.startsWith(PACKAGE_BOARD_PREFIX)) return boardViews;
  return null;
}
