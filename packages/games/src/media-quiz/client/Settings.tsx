import { fieldSettings } from '../../client/settings.js';

/** Réglages avant le lancement : nombre d'extraits et temps de réponse. */
export const MediaQuizSettings = fieldSettings([
  { key: 'questionCount', label: 'Extraits', min: 1, max: 30 },
  { key: 'answerSeconds', label: 'Secondes pour répondre', min: 10, max: 90 },
]);
