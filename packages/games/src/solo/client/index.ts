import type { GameClientViews } from '../../client/types.js';
import { soloSettings } from './Settings.js';
import { SoloHost } from './SoloHost.js';
import { SoloPlayer } from './SoloPlayer.js';

/** Vues navigateur des jeux solo : même écran principal et même téléphone, réglages propres. */
const shared = { Host: SoloHost, Player: SoloPlayer };

export const soloClientViews: Record<string, GameClientViews> = {
  sudoku: {
    ...shared,
    Settings: soloSettings([
      {
        key: 'difficulty',
        label: 'Difficulté',
        options: [
          { value: 'facile', label: 'Facile' },
          { value: 'moyen', label: 'Moyenne' },
          { value: 'difficile', label: 'Difficile' },
        ],
      },
    ]),
  },
  solitaire: {
    ...shared,
    Settings: soloSettings([
      {
        key: 'drawCount',
        label: 'Cartes piochées à la fois',
        options: [
          { value: 1, label: 'Une carte' },
          { value: 3, label: 'Trois cartes' },
        ],
      },
    ]),
  },
  taquin: {
    ...shared,
    Settings: soloSettings([
      {
        key: 'size',
        label: 'Taille de la grille',
        options: [
          { value: 3, label: '3 × 3 (facile)' },
          { value: 4, label: '4 × 4' },
        ],
      },
    ]),
  },
  'mots-croises': {
    ...shared,
    Settings: soloSettings([]),
  },
};
