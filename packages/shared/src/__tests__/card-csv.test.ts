import { describe, expect, it } from 'vitest';
import { cardGameDefinitionSchema, type CardGameDefinition } from '../card-games.js';
import { cardsFromCsv, mergeCardCsv, parseCsv } from '../card-csv.js';

/**
 * Cartes à texte importées depuis un CSV, et règles du mémo (paires complètes, sans effets).
 */

const families = [{ id: 'bleu', label: 'Bleu', color: '#3f8cff' }];

describe('Lecture du CSV', () => {
  it('accepte la virgule et le point-virgule, et les guillemets avec retour à la ligne', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a;b\r\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('nom,texte\n"Léa","Dit ""bonjour"",\nen deux lignes"')).toEqual([
      ['nom', 'texte'],
      ['Léa', 'Dit "bonjour",\nen deux lignes'],
    ]);
  });

  it('ignore le BOM de Windows', () => {
    expect(parseCsv('﻿nom\nSalut')[0]).toEqual(['nom']);
  });
});

describe('Cartes depuis le CSV', () => {
  it('crée une carte par ligne, avec le texte, le nombre, les points, la paire et le rang', () => {
    const csv = 'nom,texte,nombre,points,paire,rang\nChat,« Miaou » dit le chat,2,5,animaux,3\nChien,« Ouaf »,1,0,,7';
    const result = cardsFromCsv(csv, families);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.cards).toEqual([
      {
        id: 't2',
        label: 'Chat',
        symbol: 'Chat',
        family: 'bleu',
        effect: 'none',
        count: 2,
        points: 5,
        text: '« Miaou » dit le chat',
        pair: 'animaux',
        rank: 3,
      },
      {
        id: 't3',
        label: 'Chien',
        symbol: 'Chie',
        family: 'bleu',
        effect: 'none',
        count: 1,
        points: 0,
        text: '« Ouaf »',
        rank: 7,
      },
    ]);
  });

  it('accepte les noms de colonnes en anglais et sans tenir compte de la casse', () => {
    const result = cardsFromCsv('ID,Label,Symbol,Text\nun,Un,1,Premier', families);
    expect(result).toMatchObject({ ok: true, cards: [{ id: 'un', label: 'Un', symbol: '1', text: 'Premier' }] });
  });

  it('signale la ligne d’une erreur', () => {
    expect(cardsFromCsv('nom,nombre\nA,2\nB,99', families)).toEqual({
      ok: false,
      error: 'Ligne 3 : le nombre doit être un entier de 1 à 20.',
    });
    expect(cardsFromCsv('nom,famille\nA,vert', families)).toEqual({
      ok: false,
      error: 'Ligne 2 : famille « vert » inconnue.',
    });
    expect(cardsFromCsv('nom\n\n,', families)).toMatchObject({ ok: false });
  });

  it('refuse une colonne inconnue, un fichier sans nom ni texte, et un identifiant en double', () => {
    expect(cardsFromCsv('nom,couleurr\nA,rouge', families)).toEqual({
      ok: false,
      error: 'Colonne inconnue dans le CSV : « couleurr ».',
    });
    expect(cardsFromCsv('points\n3', families)).toEqual({
      ok: false,
      error: 'Le CSV doit avoir une colonne « nom » ou « texte ».',
    });
    expect(cardsFromCsv('id,nom\nx,A\nx,B', families)).toEqual({
      ok: false,
      error: 'Ligne 3 : identifiant « x » déjà utilisé.',
    });
  });

  it('refuse plus de 200 cartes', () => {
    const rows = Array.from({ length: 201 }, (_, i) => `Carte ${i}`).join('\n');
    expect(cardsFromCsv(`nom\n${rows}`, families)).toMatchObject({ ok: false });
  });
});

describe('Fusion avec la définition JSON', () => {
  const definition = {
    name: 'Jeu à texte',
    description: 'Un jeu de phrases.',
    icon: '📝',
    theme: 'classique',
    families,
    cards: [{ id: 'base', label: 'Base', symbol: 'B', family: 'bleu', effect: 'none', count: 1, points: 0 }],
    rules: { minPlayers: 2, maxPlayers: 4, handSize: 3, matchOn: 'family', targetScore: 100, turnSeconds: 20 },
    notice: { goal: 'Jouer.', steps: ['Jouez.'], tips: [] },
  };

  it('ajoute les lignes du CSV aux cartes existantes, et retire le champ csv', () => {
    const merged = mergeCardCsv({ ...definition, csv: 'nom,texte\nUn,Phrase un' });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const value = merged.value as Record<string, unknown>;
    expect(value).not.toHaveProperty('csv');
    expect((value.cards as { id: string }[]).map((c) => c.id)).toEqual(['base', 't2']);
  });

  it('fonctionne aussi dans un fichier d’export (définition à l’intérieur)', () => {
    const merged = mergeCardCsv({
      format: 'partyhub-jeux-cartes',
      version: 2,
      definition: { ...definition, csv: 'nom\nA' },
      assets: [],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const inner = (merged.value as { definition: { cards: unknown[] } }).definition;
    expect(inner.cards).toHaveLength(2);
  });

  it('refuse un identifiant du CSV qui existe déjà dans les cartes saisies', () => {
    const merged = mergeCardCsv({ ...definition, csv: 'id,nom\nbase,Doublon' });
    expect(merged).toEqual({ ok: false, error: 'Ligne 2 : identifiant « base » déjà utilisé.' });
  });

  it('laisse une définition sans csv inchangée', () => {
    expect(mergeCardCsv(definition)).toEqual({ ok: true, value: definition });
  });
});

describe('Mécanique mémo : règles de validation', () => {
  const card = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    label: id,
    symbol: id.slice(0, 2),
    family: 'bleu',
    effect: 'none',
    count: 2,
    points: 1,
    ...extra,
  });
  const memory = (cards: unknown[]): CardGameDefinition =>
    ({
      name: 'Mémo test',
      description: 'Test.',
      icon: '🧠',
      theme: 'arcade',
      families,
      cards,
      rules: {
        minPlayers: 2,
        maxPlayers: 4,
        handSize: 3,
        matchOn: 'family',
        targetScore: 100,
        turnSeconds: 20,
        mechanic: 'memory',
      },
      notice: { goal: 'Trouver les paires.', steps: ['Retournez deux cartes.'], tips: [] },
    }) as CardGameDefinition;

  it('accepte des paires complètes, avec un identifiant commun ou un exemplaire double', () => {
    const result = cardGameDefinitionSchema.safeParse(
      memory([card('chat', { pair: 'animal', count: 1 }), card('chat2', { pair: 'animal', count: 1 }), card('chien')]),
    );
    expect(result.success).toBe(true);
  });

  it('refuse une paire incomplète', () => {
    const result = cardGameDefinitionSchema.safeParse(memory([card('chat', { count: 1 }), card('chien')]));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(
      'La paire « chat » compte 1 carte(s) : il en faut exactement 2.',
    );
  });

  it('refuse les effets et les jokers au mémo', () => {
    const result = cardGameDefinitionSchema.safeParse(memory([card('passe', { effect: 'skip' })]));
    expect(result.success).toBe(false);
  });

  it('ne demande pas de main au mémo', () => {
    const result = cardGameDefinitionSchema.safeParse(memory([card('a'), card('b')]));
    expect(result.success).toBe(true);
  });
});
