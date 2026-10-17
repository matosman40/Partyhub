import { describe, expect, it } from 'vitest';
import { wrapLines } from '../cards/client/CardFace.js';
import { memoryColumns } from '../cards/client/memory-common.js';

describe('Plateau du mémo : colonnes', () => {
  it('prend un nombre de colonnes qui divise le nombre de cartes quand c’est proche de l’idéal', () => {
    expect(memoryColumns(12, 1.4)).toBe(6);
    expect(memoryColumns(16, 1.4)).toBe(4);
    expect(memoryColumns(12, 0.5)).toBe(3);
    expect(memoryColumns(16, 0.5)).toBe(4);
  });

  it('ne dépasse jamais le nombre de cartes, et reste à deux colonnes au moins', () => {
    expect(memoryColumns(4, 1.4)).toBeLessThanOrEqual(4);
    expect(memoryColumns(1, 1.4)).toBe(1);
    expect(memoryColumns(5, 0.1)).toBeGreaterThanOrEqual(2);
  });
});

/** Découpage du texte des cartes à texte : lignes courtes, mots entiers quand c'est possible. */
describe('Texte des cartes : découpage en lignes', () => {
  it('garde les mots entiers tant que la ligne le permet', () => {
    expect(wrapLines('Le chat dort sur le canapé', 10, 5)).toEqual(['Le chat', 'dort sur', 'le canapé']);
  });

  it('coupe un mot plus long que la ligne', () => {
    expect(wrapLines('abcdefghij', 4, 5)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('tronque et ajoute des points de suspension quand le texte dépasse le nombre de lignes', () => {
    const lines = wrapLines('un deux trois quatre cinq six', 8, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
  });

  it('renvoie une liste vide pour un texte vide', () => {
    expect(wrapLines('   ', 10, 3)).toEqual([]);
  });
});
