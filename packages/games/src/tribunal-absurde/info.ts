/**
 * Ambiances du Tribunal de l’absurde : identifiants, libellés et consignes. Ce fichier ne dépend de rien d’autre,
 * pour que les écrans (navigateur) et le serveur partagent les mêmes textes sans charger le moteur.
 */

export const TRIBUNAL_MODES = ['humour-noir', 'mauvaise-foi', 'excuses-impossibles', 'adultes'] as const;
export type TribunalMode = (typeof TRIBUNAL_MODES)[number];

/** « melange » tire une ambiance différente pour chaque affaire. */
export const TRIBUNAL_AMBIANCES = ['melange', ...TRIBUNAL_MODES] as const;
export type TribunalAmbiance = (typeof TRIBUNAL_AMBIANCES)[number];

export const TRIBUNAL_MODE_INFO: Record<TribunalMode, { label: string; hint: string }> = {
  'humour-noir': { label: 'Humour noir', hint: 'Une défense glaçante, mais drôle.' },
  'mauvaise-foi': { label: 'Mauvaise foi', hint: 'Mentez avec aplomb, sans jamais avouer.' },
  'excuses-impossibles': {
    label: 'Excuses impossibles',
    hint: 'Une excuse impossible à vérifier, et plus difficile encore à réfuter.',
  },
  adultes: { label: 'Adultes', hint: 'Malin et sous-entendu, jamais vulgaire.' },
};

export const TRIBUNAL_AMBIANCE_LABELS: Record<TribunalAmbiance, string> = {
  melange: 'Mélange (une ambiance par affaire)',
  'humour-noir': 'Humour noir',
  'mauvaise-foi': 'Mauvaise foi',
  'excuses-impossibles': 'Excuses impossibles',
  adultes: 'Adultes',
};

/** Longueur maximale d’une défense, en caractères. */
export const DEFENSE_MAX_LENGTH = 140;
