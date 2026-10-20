import { fieldSettings } from '../../client/settings.js';
import { TRIBUNAL_AMBIANCE_LABELS, TRIBUNAL_AMBIANCES } from '../info.js';

/** Réglages du Tribunal : nombre d’affaires, temps d’écriture, ambiance. */
export const TribunalSettings = fieldSettings([
  { key: 'rounds', label: 'Affaires', min: 1, max: 8 },
  { key: 'writeSeconds', label: 'Secondes pour écrire', min: 20, max: 120 },
  {
    key: 'ambiance',
    label: 'Ambiance',
    options: TRIBUNAL_AMBIANCES.map((value) => ({ value, label: TRIBUNAL_AMBIANCE_LABELS[value] })),
  },
]);
