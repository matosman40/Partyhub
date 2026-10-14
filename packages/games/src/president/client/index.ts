import type { GameClientViews } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';
import { PresidentHost } from './PresidentHost.js';
import { PresidentPlayer } from './PresidentPlayer.js';

export const presidentViews: GameClientViews = {
  Settings: fieldSettings([
    { key: 'rounds', label: 'Manches', min: 1, max: 10 },
    { key: 'turnSeconds', label: 'Secondes par tour (0 = sans limite)', min: 0, max: 60 },
  ]),
  Host: PresidentHost,
  Player: PresidentPlayer,
};
