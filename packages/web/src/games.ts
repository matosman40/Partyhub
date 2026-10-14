import { boardViews, cardViews, clientViews, mediaQuizViews } from '@partyhub/games/client';

/** Préfixe des jeux de cartes créés dans l'administration (voir le serveur). */
const CUSTOM_GAME_PREFIX = 'custom-';
/** Préfixe des jeux de questions médias créés dans l'administration (voir le serveur). */
const MEDIA_GAME_PREFIX = 'media-';
/** Préfixe des jeux installés à partir d'un paquet .phgame (jeux déclaratifs de cartes). */
const PACKAGE_GAME_PREFIX = 'pkg-';
/** Préfixe des jeux de plateau créés dans l'administration. */
const BOARD_GAME_PREFIX = 'board-';

/**
 * Vues navigateur par jeu : le routage des pages reste générique. Les jeux de
 * cartes personnalisés partagent la vue commune des jeux de cartes, et les jeux
 * de questions médias partagent la vue commune des questions médias.
 */
export function viewsFor(gameId: string) {
  if (clientViews[gameId]) return clientViews[gameId];
  if (gameId.startsWith(CUSTOM_GAME_PREFIX) || gameId.startsWith(PACKAGE_GAME_PREFIX)) return cardViews;
  if (gameId.startsWith(MEDIA_GAME_PREFIX)) return mediaQuizViews;
  if (gameId.startsWith(BOARD_GAME_PREFIX)) return boardViews;
  return null;
}
