import { describe, expect, it } from 'vitest';
import {
  KEYWORDS_MAX,
  KEYWORD_MAX_LENGTH,
  keywordThemes,
  openKeywordTurns,
  parseKeywords,
  passTurn,
  submitKeywords,
  turnPlayer,
  turnsDone,
} from '../common/keywords.js';

describe('Mots-clés : découpe de la saisie', () => {
  it('sépare par virgules, points-virgules et retours à la ligne, et retire les espaces inutiles', () => {
    expect(parseKeywords(' volcans ; lave,\n Islande ,, ')).toEqual(['volcans', 'lave', 'Islande']);
  });

  it('ignore la casse pour les doublons, en gardant la première forme', () => {
    expect(parseKeywords('Lave, lave, LAVE')).toEqual(['Lave']);
  });

  it(`garde au plus ${KEYWORDS_MAX} mots-clés`, () => {
    expect(parseKeywords('a,b,c,d,e,f,g')).toHaveLength(KEYWORDS_MAX);
  });

  it(`coupe les mots trop longs à ${KEYWORD_MAX_LENGTH} caractères`, () => {
    expect(parseKeywords('x'.repeat(40))).toEqual(['x'.repeat(KEYWORD_MAX_LENGTH)]);
  });

  it('ne coupe pas un emoji en deux quand un mot est trop long', () => {
    const [word] = parseKeywords('🌋'.repeat(30));
    expect(Array.from(word ?? '')).toHaveLength(KEYWORD_MAX_LENGTH);
    expect(word).toBe('🌋'.repeat(KEYWORD_MAX_LENGTH));
  });

  it('remplace les caractères de contrôle par des espaces', () => {
    expect(parseKeywords('ab\u0007cd')).toEqual(['ab cd']);
  });

  it('renvoie une liste vide pour une saisie vide', () => {
    expect(parseKeywords('  ,;  ')).toEqual([]);
  });
});

describe('Mots-clés : ordre des tours', () => {
  const ORDER = ['a', 'b', 'c'];

  it('le premier tour revient au premier joueur connecté', () => {
    const t = openKeywordTurns(ORDER, 1000, 30, ['b', 'c']);
    expect(turnPlayer(t)).toBe('b');
    expect(t.endsAt).toBe(1000 + 30_000);
  });

  it('un joueur donne ses mots-clés, puis le tour passe au suivant', () => {
    const connected = ORDER;
    let t = openKeywordTurns(ORDER, 0, 30, connected);
    t = submitKeywords(t, ['volcans'], 0, 30, connected);
    expect(t.entries['a']).toEqual(['volcans']);
    expect(turnPlayer(t)).toBe('b');
  });

  it('un joueur déconnecté est sauté sans bloquer la phase', () => {
    // Le tour de « a » passe ensuite à « b », qui est parti : on arrive directement à « c ».
    let t = openKeywordTurns(ORDER, 0, 30, ORDER);
    t = passTurn(t, 0, 30, ['a', 'c']);
    expect(turnPlayer(t)).toBe('c');
  });

  it('une fois le dernier tour passé, la phase est terminée et le minuteur s’arrête', () => {
    let t = openKeywordTurns(ORDER, 0, 30, ORDER);
    for (let i = 0; i < ORDER.length; i++) t = passTurn(t, 0, 30, ORDER);
    expect(turnsDone(t)).toBe(true);
    expect(turnPlayer(t)).toBeNull();
    expect(t.endsAt).toBe(0);
  });

  it('les thèmes ne viennent que des joueurs qui ont donné au moins un mot-clé', () => {
    let t = openKeywordTurns(ORDER, 0, 30, ORDER);
    t = submitKeywords(t, ['volcans'], 0, 30, ORDER);
    t = passTurn(t, 0, 30, ORDER);
    t = submitKeywords(t, ['cinéma'], 0, 30, ORDER);
    const themes = keywordThemes(t, { a: 'Ana', b: 'Léo', c: 'Max' });
    expect(themes).toEqual([
      { id: 'a', name: 'Ana', keywords: ['volcans'] },
      { id: 'c', name: 'Max', keywords: ['cinéma'] },
    ]);
  });
});
