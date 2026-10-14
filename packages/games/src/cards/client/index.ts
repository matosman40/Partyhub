import type { GameClientViews } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';
import { CardsHost } from './CardsHost.js';
import { CardsPlayer } from './CardsPlayer.js';

/** Vues communes à tous les jeux de cartes (intégrés et personnalisés). */
export const cardViews: GameClientViews = {
  Settings: fieldSettings([
    { key: 'targetScore', label: 'Points pour gagner', min: 50, max: 2000 },
    { key: 'turnSeconds', label: 'Secondes par tour (0 = sans limite)', min: 0, max: 60 },
  ]),
  Host: CardsHost,
  Player: CardsPlayer,
};

export { CardFace } from './CardFace.js';
export { assetFontFamily } from './fonts.js';
