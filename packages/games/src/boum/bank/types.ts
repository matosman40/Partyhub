/**
 * Banques de contenu de BOUM ! : types, niveaux et statuts. Pur : aucune dépendance au serveur
 * ni au navigateur, pour être partagé par le moteur, l'administration et les tests.
 */

export const BANK_TYPES = [
  'phrase_trous',
  'carte_reponse',
  'situation',
  'sujet_epitaphe',
  'situation_conseil',
  'citation',
  'question',
  'question_chiffre',
  'pays_indice',
  'mot_secret',
  'consigne_photo',
  'theme_galerie',
  'chanson',
  'metier',
] as const;
export type BankType = (typeof BANK_TYPES)[number];

/** Niveaux de contenu. `limite` n'existe que dans le pack Humour noir. */
export const LEVELS = ['doux', 'corse', 'limite'] as const;
export type Level = (typeof LEVELS)[number];

/** Libellés français des niveaux, tels qu'ils s'écrivent dans un fichier texte. */
export const LEVEL_LABELS: Record<Level, string> = {
  doux: 'doux',
  corse: 'corsé',
  limite: 'limite',
};

export const STATUSES = ['propose', 'a_valider', 'valide', 'retire'] as const;
export type EntryStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<EntryStatus, string> = {
  propose: 'Proposée',
  a_valider: 'À valider',
  valide: 'Validée',
  retire: 'Retirée',
};

/** Ce qu'un type exige comme réponse : rien, un texte, un nombre entier ou un code pays. */
export type AnswerRule = 'none' | 'text' | 'int' | 'country';

export interface BankTypeInfo {
  label: string;
  answer: AnswerRule;
  /** Longueur maximale du texte de l'entrée. */
  maxLength: number;
  /** Les niveaux `limite` sont acceptés pour ce type (pack Humour noir seulement). */
  limitAllowed: boolean;
}

export const BANK_TYPE_INFO: Record<BankType, BankTypeInfo> = {
  phrase_trous: { label: 'Phrase à trous', answer: 'none', maxLength: 200, limitAllowed: true },
  carte_reponse: { label: 'Carte réponse', answer: 'none', maxLength: 60, limitAllowed: true },
  situation: { label: 'Situation', answer: 'none', maxLength: 200, limitAllowed: true },
  sujet_epitaphe: { label: 'Sujet d’épitaphe', answer: 'none', maxLength: 120, limitAllowed: true },
  situation_conseil: { label: 'Situation à conseiller', answer: 'none', maxLength: 200, limitAllowed: true },
  citation: { label: 'Citation', answer: 'none', maxLength: 120, limitAllowed: true },
  question: { label: 'Question', answer: 'text', maxLength: 120, limitAllowed: false },
  question_chiffre: { label: 'Question chiffrée', answer: 'int', maxLength: 120, limitAllowed: false },
  pays_indice: { label: 'Indice de pays', answer: 'country', maxLength: 120, limitAllowed: false },
  mot_secret: { label: 'Mot secret', answer: 'none', maxLength: 120, limitAllowed: false },
  consigne_photo: { label: 'Consigne photo', answer: 'none', maxLength: 120, limitAllowed: false },
  theme_galerie: { label: 'Thème de galerie', answer: 'none', maxLength: 120, limitAllowed: false },
  chanson: { label: 'Chanson à chanter', answer: 'text', maxLength: 120, limitAllowed: false },
  metier: { label: 'Métier à mimer', answer: 'none', maxLength: 120, limitAllowed: false },
};

/** Longueur maximale d'une réponse attendue (« trou » de la spécification). */
export const ANSWER_MAX_LENGTH = 25;
/** Longueur maximale d'une réponse chanson : artiste ou film, alternatives séparées par « / ». */
export const SONG_ANSWER_MAX_LENGTH = 120;

export function isBankType(value: unknown): value is BankType {
  return typeof value === 'string' && (BANK_TYPES as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

export function isStatus(value: unknown): value is EntryStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** Entrée de banque telle qu'elle est stockée et exposée à l'administration. */
export interface BankEntry {
  id: string;
  type: BankType;
  level: Level;
  text: string;
  answer: string | null;
  status: EntryStatus;
  /** Motif de refus, pour les propositions refusées. */
  reason: string | null;
  /** Compte auteur, ou null pour une entrée de l'administration. Jamais exposé en partie. */
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}
