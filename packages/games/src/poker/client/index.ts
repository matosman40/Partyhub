import type { GameClientViews } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';
import { PokerHost } from './PokerHost.js';
import { PokerPlayer } from './PokerPlayer.js';

/** Vues du poker Texas : réglages du salon, table sur l’écran principal, cartes et actions sur le téléphone. */
export const pokerViews: GameClientViews = {
  Settings: fieldSettings([
    { key: 'startingChips', label: 'Jetons de départ', min: 100, max: 10000 },
    { key: 'bigBlind', label: 'Grosse blinde', min: 2, max: 1000 },
    { key: 'hands', label: 'Nombre de donnes', min: 1, max: 50 },
    { key: 'turnSeconds', label: 'Secondes par action (0 = sans limite)', min: 0, max: 60 },
  ]),
  Host: PokerHost,
  Player: PokerPlayer,
};
