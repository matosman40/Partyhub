import { fieldSettings } from '../../client/settings.js';
import { IMPOSTEUR_AMBIANCE_LABELS, IMPOSTEUR_AMBIANCES } from '../info.js';

/** Réglages de L’imposteur parmi nous : manches, temps pour parler, mode. */
export const ImposteurPartageSettings = fieldSettings([
  { key: 'rounds', label: 'Manches', min: 1, max: 6 },
  { key: 'clueSeconds', label: 'Secondes pour parler', min: 20, max: 120 },
  {
    key: 'mode',
    label: 'Mode',
    options: IMPOSTEUR_AMBIANCES.map((value) => ({ value, label: IMPOSTEUR_AMBIANCE_LABELS[value] })),
  },
]);
