import { fieldSettings } from '../../client/settings.js';

/**
 * Réglages avant le lancement : nombre d’extraits et temps de réponse. Ce formulaire sert aussi
 * aux jeux de sous-titres, dont le temps va jusqu’à 120 s : les bornes couvrent les deux modes,
 * pour qu’une valeur déjà enregistrée ne soit jamais ramenée de force. Le serveur valide la
 * borne exacte de chaque jeu et refuse une valeur hors limites avec un message.
 */
export const MediaQuizSettings = fieldSettings([
  { key: 'questionCount', label: 'Extraits', min: 1, max: 30 },
  { key: 'answerSeconds', label: 'Secondes pour répondre', min: 10, max: 120 },
]);
