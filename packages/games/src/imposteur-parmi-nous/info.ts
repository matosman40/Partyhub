/**
 * Modes de L’imposteur parmi nous : identifiants, libellés et consignes. Sans dépendance, pour que les écrans
 * (navigateur) et le serveur partagent les mêmes textes.
 */

export const IMPOSTEUR_MODES = ['espion', 'intrus', 'mot-interdit', 'role-secret'] as const;
export type ImposteurMode = (typeof IMPOSTEUR_MODES)[number];

/** « melange » tire un mode différent pour chaque manche. */
export const IMPOSTEUR_AMBIANCES = ['melange', ...IMPOSTEUR_MODES] as const;
export type ImposteurAmbiance = (typeof IMPOSTEUR_AMBIANCES)[number];

export const IMPOSTEUR_MODE_INFO: Record<ImposteurMode, { label: string; hint: string }> = {
  espion: { label: 'Espion', hint: 'L’imposteur reçoit un mot proche de celui de l’équipe.' },
  intrus: { label: 'Intrus', hint: 'L’imposteur reçoit un mot d’une autre catégorie.' },
  'mot-interdit': {
    label: 'Mot interdit',
    hint: 'Le mot secret ne doit jamais être prononcé. L’imposteur ne connaît que la catégorie.',
  },
  'role-secret': { label: 'Rôle secret', hint: 'L’imposteur ne reçoit aucun mot : il doit improviser.' },
};

export const IMPOSTEUR_AMBIANCE_LABELS: Record<ImposteurAmbiance, string> = {
  melange: 'Mélange (un mode par manche)',
  espion: 'Espion',
  intrus: 'Intrus',
  'mot-interdit': 'Mot interdit',
  'role-secret': 'Rôle secret',
};

/** Longueur maximale d’une phrase, en caractères. */
export const CLUE_MAX_LENGTH = 80;
/** Longueur maximale d’une tentative pour deviner le mot. */
export const GUESS_MAX_LENGTH = 30;
