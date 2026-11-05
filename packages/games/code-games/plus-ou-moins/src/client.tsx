// Vues de Plus ou moins, reprises telles quelles du jeu intégré (étape 1 de la migration du magasin).
import { fieldSettings } from '../../../src/client/settings.js';
import { PlusOuMoinsHost } from '../../../src/plus-ou-moins/client/HostScreen.js';
import { PlusOuMoinsPlayer } from '../../../src/plus-ou-moins/client/PlayerScreen.js';

export default {
  Settings: fieldSettings([
    { key: 'rounds', label: 'Cartes', min: 1, max: 30 },
    { key: 'betSeconds', label: 'Secondes pour parier', min: 5, max: 60 },
  ]),
  Host: PlusOuMoinsHost,
  Player: PlusOuMoinsPlayer,
};
