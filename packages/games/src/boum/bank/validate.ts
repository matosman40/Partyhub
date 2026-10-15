import {
  ANSWER_MAX_LENGTH,
  BANK_TYPE_INFO,
  LEVEL_LABELS,
  SONG_ANSWER_MAX_LENGTH,
  isBankType,
  isLevel,
  type BankType,
  type Level,
} from './types.js';
import { COUNTRY_CODES } from './countries.js';

/**
 * Validation des entrées de banque, commune à l'import, à l'édition et aux propositions.
 * Une seule règle pour tous les chemins : ce qui passe ici est ce qui peut être tiré en partie.
 */

/** Noms de jeux commerciaux : refusés partout (règle absolue de la spécification). */
export const FORBIDDEN_NAMES = [
  'Risk',
  'Monopoly',
  'Trivial Pursuit',
  'Pictionary',
  'Jackbox',
  'Just Dance',
  'Bomberman',
  'Mario Party',
  'Hasbro',
  'Dixit',
  'Cards Against Humanity',
] as const;

export const IMPORT_MAX_BYTES = 300 * 1024;
export const IMPORT_MAX_LINES = 2000;

/** Normalisation pour comparer deux textes : minuscules, sans accents, espaces réduits. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clé de doublon : même type et même texte normalisé. */
export function duplicateKey(type: BankType, text: string): string {
  return `${type}|${normalizeText(text)}`;
}

function containsWord(haystack: string, needle: string): boolean {
  const pattern = normalizeText(needle).split(' ').map(escapeRegExp).join('\\s+');
  return new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`).test(normalizeText(haystack));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Raison de refus si le texte cite un jeu commercial, sinon null. */
export function forbiddenReason(text: string): string | null {
  for (const name of FORBIDDEN_NAMES) {
    if (containsWord(text, name)) return `le nom « ${name} » ne peut pas figurer dans une banque`;
  }
  return null;
}

export interface CandidateInput {
  type: unknown;
  level: unknown;
  text: unknown;
  answer?: unknown;
}

export interface ValidEntry {
  type: BankType;
  level: Level;
  text: string;
  answer: string | null;
}

export type ValidationResult = { ok: true; entry: ValidEntry } | { ok: false; reason: string };

// Caractères de contrôle interdits dans un texte stocké : la classe de contrôle est voulue ici.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTML_CHARS = /[<>]/;

/** Valide une entrée complète. `limitAllowed` : le niveau limite n'est accepté que pour ces types. */
export function validateEntry(input: CandidateInput): ValidationResult {
  if (!isBankType(input.type)) return { ok: false, reason: 'type de banque inconnu' };
  const type = input.type;
  const info = BANK_TYPE_INFO[type];

  if (!isLevel(input.level)) return { ok: false, reason: 'niveau inconnu (doux, corsé ou limite)' };
  const level = input.level;
  if (level === 'limite' && !info.limitAllowed) {
    return { ok: false, reason: `le niveau limite n’existe pas pour ${info.label.toLowerCase()}` };
  }

  if (typeof input.text !== 'string') return { ok: false, reason: 'texte manquant' };
  const text = input.text.trim();
  if (text.length === 0) return { ok: false, reason: 'texte vide' };
  if (CONTROL_CHARS.test(text)) return { ok: false, reason: 'caractère de contrôle interdit' };
  if (HTML_CHARS.test(text)) return { ok: false, reason: 'texte brut uniquement : pas de balise ni de < ou >' };
  if (text.length > info.maxLength) {
    return { ok: false, reason: `texte trop long (${text.length} caractères, ${info.maxLength} maximum)` };
  }
  if (type === 'phrase_trous') {
    const holes = text.split('___').length - 1;
    if (holes < 1 || holes > 2) return { ok: false, reason: 'une phrase à trous doit contenir 1 ou 2 trous ___' };
  }
  const forbidden = forbiddenReason(text);
  if (forbidden) return { ok: false, reason: forbidden };

  const answer = validateAnswer(type, input.answer);
  if (!answer.ok) return answer;

  return { ok: true, entry: { type, level, text, answer: answer.value } };
}

function validateAnswer(
  type: BankType,
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; reason: string } {
  const rule = BANK_TYPE_INFO[type].answer;
  if (rule === 'none') return { ok: true, value: null };

  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length === 0) return { ok: false, reason: 'réponse attendue pour ce type' };
  if (CONTROL_CHARS.test(value) || HTML_CHARS.test(value)) {
    return { ok: false, reason: 'réponse en texte brut uniquement' };
  }

  if (rule === 'int') {
    if (!/^\d{1,9}$/.test(value)) return { ok: false, reason: 'la réponse doit être un nombre entier' };
    return { ok: true, value };
  }
  if (rule === 'country') {
    const code = value.toUpperCase();
    if (!COUNTRY_CODES.includes(code)) return { ok: false, reason: `code pays inconnu : ${value}` };
    return { ok: true, value: code };
  }

  const max = type === 'chanson' ? SONG_ANSWER_MAX_LENGTH : ANSWER_MAX_LENGTH;
  if (value.length > max) return { ok: false, reason: `réponse trop longue (${max} caractères maximum)` };
  const forbidden = forbiddenReason(value);
  if (forbidden) return { ok: false, reason: forbidden };
  return { ok: true, value };
}

/* ------------------------------------------------------------------------- */
/* Fichier texte : import et export                                           */
/* ------------------------------------------------------------------------- */

const FIELD_SEPARATOR = ' ; ';

/** Niveaux acceptés dans un fichier : libellés français, avec ou sans accent. */
export function parseLevelLabel(value: string): Level | null {
  const v = normalizeText(value);
  if (v === 'doux') return 'doux';
  if (v === 'corse') return 'corse';
  if (v === 'limite') return 'limite';
  return null;
}

export interface ImportCandidate extends ValidEntry {
  line: number;
}

export interface ImportRejection {
  line: number;
  raw: string;
  reason: string;
}

export interface ImportPreview {
  /** Erreur qui arrête tout l'import (fichier illisible, trop gros, format non reconnu). */
  fatal: string | null;
  accepted: ImportCandidate[];
  rejected: ImportRejection[];
  duplicates: ImportRejection[];
}

/**
 * Analyse un fichier texte. `existing` contient les clés de doublon déjà en base.
 * Une ligne fausse n'empêche pas les autres ; les doublons (base ou fichier) sont ignorés et signalés.
 */
export function parseBankText(raw: string, existing: ReadonlySet<string>): ImportPreview {
  const empty: ImportPreview = { fatal: null, accepted: [], rejected: [], duplicates: [] };
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
    return { ...empty, fatal: 'Fichier trop volumineux (300 Ko maximum). Rien n’a été importé.' };
  }
  if (text.includes('�')) {
    return { ...empty, fatal: 'Encodage illisible : enregistrez le fichier en UTF-8. Rien n’a été importé.' };
  }

  const lines = text.split(/\r?\n/);
  const data = lines
    .map((content, index) => ({ content, line: index + 1 }))
    .filter(({ content }) => content.trim() !== '' && !content.trimStart().startsWith('#'));

  if (data.length > IMPORT_MAX_LINES) {
    return { ...empty, fatal: `Trop de lignes (${data.length}, 2 000 maximum). Rien n’a été importé.` };
  }

  const recognised = data.filter(({ content }) => {
    const first = content.split(FIELD_SEPARATOR)[0] ?? '';
    return isBankType(first.trim());
  });
  if (data.length > 0 && recognised.length === 0) {
    return {
      ...empty,
      fatal: 'Format non reconnu : chaque ligne doit commencer par un type de banque. Rien n’a été importé.',
    };
  }

  const seen = new Set(existing);
  const result: ImportPreview = { ...empty };

  for (const { content, line } of data) {
    const fields = content.split(FIELD_SEPARATOR);
    const reject = (reason: string) => result.rejected.push({ line, raw: content, reason });

    if (fields.length < 3 || fields.length > 4) {
      reject('il faut 3 ou 4 champs séparés par « ; » (type ; niveau ; texte ; réponse)');
      continue;
    }
    const [typeField, levelField, textField, answerField] = fields as [string, string, string, string | undefined];
    const level = parseLevelLabel(levelField ?? '');
    if (!level) {
      reject(`niveau inconnu : « ${levelField?.trim() ?? ''} » (doux, corsé ou limite)`);
      continue;
    }

    const checked = validateEntry({
      type: typeField.trim(),
      level,
      text: textField ?? '',
      answer: answerField,
    });
    if (!checked.ok) {
      reject(checked.reason);
      continue;
    }

    const key = duplicateKey(checked.entry.type, checked.entry.text);
    if (seen.has(key)) {
      result.duplicates.push({ line, raw: content, reason: 'doublon : ce texte existe déjà pour ce type' });
      continue;
    }
    seen.add(key);
    result.accepted.push({ line, ...checked.entry });
  }

  return result;
}

/** Export au même format à quatre champs. Un export puis un import ne crée aucun doublon. */
export function serializeBankEntries(
  entries: readonly { type: BankType; level: Level; text: string; answer: string | null }[],
): string {
  const header = '# BOUM ! : type ; niveau ; texte ; réponse (facultative)';
  const rows = entries.map((entry) => {
    const fields = [entry.type, LEVEL_LABELS[entry.level], entry.text];
    if (entry.answer) fields.push(entry.answer);
    return fields.join(FIELD_SEPARATOR);
  });
  return [header, ...rows].join('\n') + '\n';
}
