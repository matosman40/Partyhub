import { describe, expect, it } from 'vitest';
import { BANK_TYPES, BANK_TYPE_INFO, LEVELS, type BankType, type Level } from '../boum/bank/types.js';
import {
  duplicateKey,
  forbiddenReason,
  normalizeText,
  parseBankText,
  serializeBankEntries,
  validateEntry,
  IMPORT_MAX_LINES,
} from '../boum/bank/validate.js';
import { SEED_TEXT } from '../boum/bank/seed.js';

/** Banques de BOUM ! : validation, import et export d'un fichier texte, amorce. */

describe('Amorce des banques', () => {
  const seed = parseBankText(SEED_TEXT, new Set());

  it('s’analyse sans aucune ligne refusée ni doublon', () => {
    expect(seed.fatal).toBeNull();
    expect(seed.rejected).toEqual([]);
    expect(seed.duplicates).toEqual([]);
  });

  it('contient 10 entrées par type et par niveau, et le niveau limite seulement où il existe', () => {
    const counts = new Map<string, number>();
    for (const entry of seed.accepted) {
      const key = `${entry.type}|${entry.level}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const type of BANK_TYPES) {
      for (const level of LEVELS) {
        const expected = level === 'limite' && !BANK_TYPE_INFO[type].limitAllowed ? 0 : 10;
        expect(counts.get(`${type}|${level}`) ?? 0, `${type} ${level}`).toBe(expected);
      }
    }
  });
});

describe('Règles d’une entrée', () => {
  const base = { type: 'situation', level: 'doux', text: 'Tu as perdu tes clés.' };

  it('accepte une entrée correcte', () => {
    expect(validateEntry(base)).toMatchObject({ ok: true, entry: { type: 'situation', level: 'doux', answer: null } });
  });

  it('refuse un type ou un niveau inconnus', () => {
    expect(validateEntry({ ...base, type: 'inconnu' }).ok).toBe(false);
    expect(validateEntry({ ...base, level: 'violent' }).ok).toBe(false);
  });

  it('refuse le niveau limite hors des types du pack Humour noir', () => {
    expect(validateEntry({ ...base, type: 'question', level: 'limite', answer: 'Paris' }).ok).toBe(false);
    expect(validateEntry({ ...base, level: 'limite' }).ok).toBe(true);
  });

  it('refuse les balises HTML et les caractères < ou >', () => {
    expect(validateEntry({ ...base, text: 'Bonjour <b>toi</b>' }).ok).toBe(false);
    expect(validateEntry({ ...base, text: 'trois > deux' }).ok).toBe(false);
  });

  it('refuse les caractères de contrôle', () => {
    expect(validateEntry({ ...base, text: 'texte\u0007' }).ok).toBe(false);
  });

  it('applique la longueur maximale du type', () => {
    expect(validateEntry({ type: 'carte_reponse', level: 'doux', text: 'a'.repeat(61) }).ok).toBe(false);
    expect(validateEntry({ type: 'carte_reponse', level: 'doux', text: 'a'.repeat(60) }).ok).toBe(true);
  });

  it('exige 1 ou 2 trous pour une phrase à trous', () => {
    const phrase = (text: string) => validateEntry({ type: 'phrase_trous', level: 'doux', text });
    expect(phrase('Sans trou.').ok).toBe(false);
    expect(phrase('Un ___ seul.').ok).toBe(true);
    expect(phrase('___ et ___ ensemble.').ok).toBe(true);
    expect(phrase('___ ___ ___ trop.').ok).toBe(false);
  });

  it('exige une réponse entière pour les questions chiffrées', () => {
    const q = (answer: string) => validateEntry({ type: 'question_chiffre', level: 'doux', text: 'Combien ?', answer });
    expect(q('42').ok).toBe(true);
    expect(q('quarante-deux').ok).toBe(false);
    expect(q('').ok).toBe(false);
  });

  it('exige un code pays de la liste pour les indices de pays', () => {
    const p = (answer: string) => validateEntry({ type: 'pays_indice', level: 'doux', text: 'Sa capitale est Rome.', answer });
    expect(p('it').ok).toBe(true);
    expect(p('ZZ').ok).toBe(false);
  });

  it('refuse les noms de jeux commerciaux, quelle que soit la casse ou les accents', () => {
    expect(forbiddenReason('Un jeu comme MONOPOLY')).not.toBeNull();
    expect(forbiddenReason('une partie de trivial pursuit')).not.toBeNull();
    expect(forbiddenReason('un risque mesuré')).toBeNull();
    expect(validateEntry({ type: 'metier', level: 'doux', text: 'joueur de Bomberman' }).ok).toBe(false);
  });
});

describe('Import d’un fichier texte', () => {
  it('accepte les lignes correctes et signale les lignes fausses sans bloquer les autres', () => {
    const raw = [
      '# commentaire',
      'phrase_trous ; corsé ; Le maire a fait exploser ___.',
      'phrase_trous ; corsé ; Pas de trou ici.',
      'question_chiffre ; doux ; Combien de pattes ? ; huit',
      'metier ; doux ; pompier',
    ].join('\n');
    const result = parseBankText(raw, new Set());
    expect(result.fatal).toBeNull();
    expect(result.accepted.map((e) => e.line)).toEqual([2, 5]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ line: 3, reason: expect.stringContaining('trou') }),
      expect.objectContaining({ line: 4, reason: expect.stringContaining('nombre entier') }),
    ]);
  });

  it('ignore les doublons de la base et du fichier, et les signale', () => {
    const existing = new Set([duplicateKey('metier', 'Pompier')]);
    const raw = ['metier ; doux ; pompier', 'metier ; corsé ; Berger', 'metier ; doux ; BERGER'].join('\n');
    const result = parseBankText(raw, existing);
    expect(result.accepted.map((e) => e.text)).toEqual(['Berger']);
    expect(result.duplicates.map((d) => d.line)).toEqual([1, 3]);
  });

  it('refuse le fichier en entier s’il dépasse 2 000 lignes', () => {
    const raw = Array.from({ length: IMPORT_MAX_LINES + 1 }, (_, i) => `metier ; doux ; métier ${i}`).join('\n');
    expect(parseBankText(raw, new Set()).fatal).toContain('2 000');
  });

  it('refuse le fichier en entier s’il dépasse 300 Ko', () => {
    const raw = 'metier ; doux ; ' + 'a'.repeat(300 * 1024);
    expect(parseBankText(raw, new Set()).fatal).toContain('300 Ko');
  });

  it('refuse un fichier mal encodé ou sans aucune ligne reconnue', () => {
    expect(parseBankText('metier ; doux ; caf�', new Set()).fatal).toContain('UTF-8');
    expect(parseBankText('bonjour tout le monde\nencore une ligne', new Set()).fatal).toContain('Format non reconnu');
  });

  it('retire le BOM en début de fichier', () => {
    const result = parseBankText('﻿metier ; doux ; pompier', new Set());
    expect(result.accepted).toHaveLength(1);
  });

  it('aller-retour export puis import : aucun doublon', () => {
    const exported = serializeBankEntries([
      { type: 'pays_indice', level: 'corse' as Level, text: 'Sa capitale est Ankara.', answer: 'TR' },
      { type: 'metier', level: 'doux' as Level, text: 'pompier', answer: null },
    ]);
    const existing = new Set([
      duplicateKey('pays_indice', 'Sa capitale est Ankara.'),
      duplicateKey('metier', 'pompier'),
    ]);
    const result = parseBankText(exported, existing);
    expect(result.accepted).toEqual([]);
    expect(result.duplicates).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it('normalise pour comparer : minuscules, accents et espaces', () => {
    expect(normalizeText('  Élève   Très  ')).toBe('eleve tres');
  });
});

describe('Types de banque', () => {
  it('connaît les types de la spécification', () => {
    const expected: BankType[] = [
      'phrase_trous', 'carte_reponse', 'situation', 'sujet_epitaphe', 'situation_conseil', 'citation',
      'question', 'question_chiffre', 'pays_indice', 'mot_secret', 'consigne_photo', 'theme_galerie',
      'chanson', 'metier',
    ];
    expect([...BANK_TYPES].sort()).toEqual([...expected].sort());
  });
});
