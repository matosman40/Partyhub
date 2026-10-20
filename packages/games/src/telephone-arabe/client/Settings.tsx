import { fieldSettings } from '../../client/settings.js';
import { TELEPHONE_SOURCE_LABELS, TELEPHONE_SOURCES, TELEPHONE_TIME_LABELS, TELEPHONE_TIMES } from '../info.js';

/** Réglages du Téléphone arabe illustré : étapes, temps par étape, origine des phrases. */
export const TelephoneArabeSettings = fieldSettings([
  { key: 'steps', label: 'Étapes par phrase', min: 3, max: 8 },
  {
    key: 'time',
    label: 'Temps par étape',
    options: TELEPHONE_TIMES.map((value) => ({ value, label: TELEPHONE_TIME_LABELS[value] })),
  },
  {
    key: 'source',
    label: 'Phrases de départ',
    options: TELEPHONE_SOURCES.map((value) => ({ value, label: TELEPHONE_SOURCE_LABELS[value] })),
  },
]);
