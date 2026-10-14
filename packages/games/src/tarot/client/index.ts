import type { GameClientViews } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';
import { TarotHost } from './TarotHost.js';
import { TarotPlayer } from './TarotPlayer.js';

export const tarotViews: GameClientViews = {
  Settings: fieldSettings([
    { key: 'rounds', label: 'Donnes', min: 1, max: 12 },
    { key: 'turnSeconds', label: 'Secondes par tour (0 = sans limite)', min: 0, max: 90 },
  ]),
  Host: TarotHost,
  Player: TarotPlayer,
};
