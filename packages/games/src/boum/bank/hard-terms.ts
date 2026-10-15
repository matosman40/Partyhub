/**
 * Insultes dures refusées dans toutes les banques (saisie, import, propositions). Liste de départ,
 * écrite en minuscules et sans accents : la comparaison se fait sur des mots entiers, après la même
 * normalisation que les textes. À relire et à compléter par l'administrateur (voir docs/BOUM.md).
 *
 * Elle couvre les insultes visant une origine, une religion, un handicap, une orientation ou le genre,
 * et les insultes les plus violentes. Elle ne remplace pas la relecture : une liste ne voit jamais
 * les allusions.
 */
export const HARD_TERMS: readonly string[] = [
  // Origine et religion
  'negre',
  'negresse',
  'bougnoule',
  'bicot',
  'youpin',
  'chinetoque',
  'raton',
  'sale arabe',
  'sale juif',
  'sale noir',
  // Handicap
  'mongol',
  'mongolien',
  'attarde',
  'retarde mental',
  // Orientation et genre
  'pede',
  'pedale',
  'tapette',
  'gouine',
  'travelo',
  // Insultes violentes
  'salope',
  'pute',
  'connard',
  'connasse',
  'enfoire',
  'enculé',
  'fils de pute',
  'ta gueule',
];
