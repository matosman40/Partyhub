// Vues de Plutôt qui ?, reprises telles quelles du jeu intégré (étape 1 de la migration du magasin).
import { fieldSettings } from '../../../src/client/settings.js';
import { PlutotQuiHost } from '../../../src/plutot-qui/client/HostScreen.js';
import { PlutotQuiPlayer } from '../../../src/plutot-qui/client/PlayerScreen.js';

export default {
  Settings: fieldSettings([
    { key: 'rounds', label: 'Questions', min: 1, max: 15 },
    { key: 'voteSeconds', label: 'Secondes pour voter', min: 10, max: 90 },
  ]),
  Host: PlutotQuiHost,
  Player: PlutotQuiPlayer,
};
