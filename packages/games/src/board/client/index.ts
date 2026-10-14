import { fieldSettings } from '../../client/settings.js';
import type { GameClientViews } from '../../client/types.js';
import { BoardHost } from './BoardHost.js';
import { BoardPlayer } from './BoardPlayer.js';

/** Vues communes à tous les jeux de plateau (intégrés et personnalisés). */
export const boardViews: GameClientViews = {
  Settings: fieldSettings([{ key: 'turnSeconds', label: 'Secondes par tour (0 = sans limite)', min: 0, max: 60 }]),
  Host: BoardHost,
  Player: BoardPlayer,
};
