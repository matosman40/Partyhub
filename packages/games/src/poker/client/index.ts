import type { GameClientViews } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';
import { PokerHost } from './PokerHost.js';
import { PokerPlayer } from './PokerPlayer.js';

export const pokerViews: GameClientViews = {
  Settings: fieldSettings([
    { key: 'startingChips', label: 'Jetons de départ', min: 100, max: 100000 },
    { key: 'smallBlind', label: 'Petite blinde', min: 1, max: 10000 },
    { key: 'bigBlind', label: 'Grosse blinde', min: 2, max: 20000 },
    { key: 'turnSeconds', label: 'Secondes par tour (0 = sans limite)', min: 0, max: 120 },
    { key: 'hands', label: 'Nombre de mains (0 = jusqu’au dernier joueur)', min: 0, max: 200 },
  ]),
  Host: PokerHost,
  Player: PokerPlayer,
};
