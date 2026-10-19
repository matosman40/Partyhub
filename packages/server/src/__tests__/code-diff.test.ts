import { describe, expect, it } from 'vitest';
import { changedHunks, countChanges, diffLines } from '../code-games/diff.js';

const text = (lines: { kind: string; text: string }[]) => lines.map((l) => `${l.kind}${l.text}`).join('\n');

describe('revue par différence', () => {
  it('ne montre rien pour deux textes identiques', () => {
    const lines = diffLines(['a', 'b'], ['a', 'b']);
    expect(countChanges(lines)).toEqual({ added: 0, removed: 0 });
    expect(changedHunks(lines)).toEqual([]);
  });

  it('repère une ligne ajoutée et une ligne retirée', () => {
    const before = ['a', 'b', 'c', 'd'];
    const after = ['a', 'x', 'c', 'd', 'e'];
    const lines = diffLines(before, after);
    expect(countChanges(lines)).toEqual({ added: 2, removed: 1 });
    expect(text(lines)).toBe([' a', '-b', '+x', ' c', ' d', '+e'].join('\n'));
  });

  it('garde le contexte autour des changements et masque le reste', () => {
    const before = Array.from({ length: 30 }, (_, i) => `ligne ${i}`);
    const after = [...before];
    after[15] = 'modifiée';
    const hunks = changedHunks(diffLines(before, after), 2);
    // Passage masqué au début, puis deux lignes de contexte, le changement, deux lignes de contexte ; rien après.
    expect(hunks.map((l) => l.kind).join('')).toBe('…  -+  ');
    expect(hunks.some((l) => l.text === 'modifiée')).toBe(true);
  });

  it('présente un très grand remplacement en bloc, sans calcul coûteux', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const after = Array.from({ length: 3000 }, (_, i) => `b${i}`);
    const lines = diffLines(before, after);
    expect(countChanges(lines)).toEqual({ added: 3000, removed: 3000 });
  });
});

describe('revue par différence : exactitude', () => {
  // Générateur pseudo-aléatoire reproductible.
  const rng = (seed: number) => {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };

  it('reconstitue exactement les deux versions, pour des cas aléatoires', () => {
    const random = rng(7);
    for (let c = 0; c < 300; c++) {
      const alphabet = ['a', 'b', 'c', 'd'];
      const before = Array.from({ length: Math.floor(random() * 25) }, () => alphabet[Math.floor(random() * 4)]!);
      const after = Array.from({ length: Math.floor(random() * 25) }, () => alphabet[Math.floor(random() * 4)]!);
      const lines = diffLines(before, after);
      // Lignes communes et retirées = ancienne version ; communes et ajoutées = nouvelle version.
      expect(lines.filter((l) => l.kind !== '+').map((l) => l.text)).toEqual(before);
      expect(lines.filter((l) => l.kind !== '-').map((l) => l.text)).toEqual(after);
    }
  });

  it('compte exactement une petite modification dans un long fichier, sans tout remplacer', () => {
    const before = Array.from({ length: 8000 }, (_, i) => `const ligne${i} = ${i};`);
    const after = [...before];
    after[4000] = 'const ligne4000 = "changé";';
    after.splice(6000, 0, 'const nouvelle = 1;');
    const lines = diffLines(before, after);
    expect(countChanges(lines)).toEqual({ added: 2, removed: 1 });
  });
});
