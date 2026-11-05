// Vues de Réflexe, reprises telles quelles du jeu intégré (étape 1 de la migration du magasin).
import { fieldSettings } from '../../../src/client/settings.js';
import { ReflexeHost } from '../../../src/reflexe/client/HostScreen.js';
import { ReflexePlayer } from '../../../src/reflexe/client/PlayerScreen.js';

export default {
  Settings: fieldSettings([{ key: 'rounds', label: 'Manches', min: 1, max: 15 }]),
  Host: ReflexeHost,
  Player: ReflexePlayer,
};
