import { describe, expect, it } from 'vitest';
import { appliedCadence, DEFAULT_TEST_MODE, TEST_MODE_FACTORS, testModeLabel, testModeSchema } from '../test-mode.js';

describe('Mode test : réglages', () => {
  it('accepte les quatre cadences du curseur et refuse les autres valeurs', () => {
    for (const factor of TEST_MODE_FACTORS) {
      expect(testModeSchema.safeParse({ enabled: true, factor }).success).toBe(true);
    }
    expect(testModeSchema.safeParse({ enabled: true, factor: 3 }).success).toBe(false);
    expect(testModeSchema.safeParse({ enabled: 'oui', factor: 2 }).success).toBe(false);
  });

  it('refuse les clés inconnues', () => {
    expect(testModeSchema.safeParse({ enabled: true, factor: 2, duree: 5 }).success).toBe(false);
  });

  it('applique la cadence seulement quand le mode test est allumé', () => {
    expect(appliedCadence(DEFAULT_TEST_MODE)).toBe(1);
    expect(appliedCadence({ enabled: false, factor: 10 })).toBe(1);
    expect(appliedCadence({ enabled: true, factor: 4 })).toBe(4);
  });

  it('affiche « Normal » pour la cadence de base, puis le facteur', () => {
    expect(testModeLabel(1)).toBe('Normal');
    expect(testModeLabel(2)).toBe('×2');
    expect(testModeLabel(10)).toBe('×10');
  });
});
