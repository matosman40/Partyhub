import type { GameClientViews } from '../../client/types.js';
import { MediaQuizHost } from './HostScreen.js';
import { MediaQuizPlayer } from './PlayerScreen.js';
import { MediaQuizSettings } from './Settings.js';

/** Vues communes à tous les jeux de questions médias (chacun a sa définition côté serveur). */
export const mediaQuizViews: GameClientViews = {
  Settings: MediaQuizSettings,
  Host: MediaQuizHost,
  Player: MediaQuizPlayer,
};
