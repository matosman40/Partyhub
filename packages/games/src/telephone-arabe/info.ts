/**
 * Réglages et limites du Téléphone arabe illustré. Sans dépendance : les écrans (navigateur) et le serveur
 * partagent les mêmes libellés et les mêmes limites de saisie.
 */

/** Temps par étape : « libre » laisse le temps nécessaire, les autres valeurs ferment l’étape. */
export const TELEPHONE_TIMES = ['libre', '45', '30'] as const;
export type TelephoneTime = (typeof TELEPHONE_TIMES)[number];

export const TELEPHONE_TIME_LABELS: Record<TelephoneTime, string> = {
  libre: 'Sans limite',
  '45': '45 secondes',
  '30': '30 secondes',
};

/** D’où viennent les phrases de départ : tirées au hasard, ou écrites par chaque joueur au début. */
export const TELEPHONE_SOURCES = ['aleatoire', 'personnalisees'] as const;
export type TelephoneSource = (typeof TELEPHONE_SOURCES)[number];

export const TELEPHONE_SOURCE_LABELS: Record<TelephoneSource, string> = {
  aleatoire: 'Phrases au hasard',
  personnalisees: 'Phrases écrites par les joueurs',
};

/** Longueurs maximales de saisie. */
export const SENTENCE_MAX_LENGTH = 90;
export const DESCRIPTION_MAX_LENGTH = 80;

/** Limites d’un dessin : le serveur refuse ce qui dépasse, pour rester sous la taille d’un message. */
export const DRAWING_MAX_STROKES = 40;
export const DRAWING_MAX_POINTS_PER_STROKE = 300;
export const DRAWING_MAX_POINTS = 3000;

/** Un dessin est repéré sur une grille de 0 à 1000 dans les deux directions. */
export const DRAWING_SIZE = 1000;

/** Consigne de chaque étape, selon sa nature. */
export const STEP_INSTRUCTION = {
  sentence: 'Écrivez une phrase absurde.',
  draw: 'Dessinez la phrase au doigt.',
  describe: 'Décrivez le dessin en une phrase.',
} as const;
