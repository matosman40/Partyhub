import type { GameClientViews } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';
import { RamiHost } from './RamiHost.js';
import { RamiPlayer } from './RamiPlayer.js';

export const ramiViews: GameClientViews = {
  Settings: fieldSettings([
    { key: 'targetScore', label: 'Points pour terminer la partie (le plus petit total gagne)', min: 50, max: 2000 },
    { key: 'openingPoints', label: 'Points pour ouvrir', min: 0, max: 120 },
    { key: 'turnSeconds', label: 'Secondes par tour (0 = sans limite)', min: 0, max: 180 },
  ]),
  Host: RamiHost,
  Player: RamiPlayer,
};
