import type { GameClientViews } from '../../client/types.js';
import { fieldSettings } from '../../client/settings.js';
import { CardsHostView, CardsPlayerView } from './CardsRouter.js';

/** Vues communes à tous les jeux de cartes (intégrés et personnalisés, y compris le mémo). */
export const cardViews: GameClientViews = {
  Settings: fieldSettings([
    { key: 'targetScore', label: 'Points pour gagner', min: 50, max: 2000 },
    { key: 'turnSeconds', label: 'Secondes par tour (0 = sans limite)', min: 0, max: 60 },
  ]),
  Host: CardsHostView,
  Player: CardsPlayerView,
};

export { CardFace } from './CardFace.js';
export { assetFontFamily } from './fonts.js';
