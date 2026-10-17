import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TestModeBadge, testModeNotice } from '../components/TestModeBadge.js';

/** Bandeau du mode test : absent hors essai, annonce la cadence pendant l'essai. */

describe('Bandeau du mode test', () => {
  it('reste absent quand le mode test est éteint ou pas encore lu', () => {
    expect(testModeNotice(null)).toBeNull();
    expect(testModeNotice({ enabled: false, factor: 4 })).toBeNull();
    expect(renderToStaticMarkup(<TestModeBadge />)).toBe('');
  });

  it('annonce la cadence quand il est allumé', () => {
    expect(testModeNotice({ enabled: true, factor: 4 })).toBe('Mode test : cadence ×4 pour les émotions et les voix.');
    expect(testModeNotice({ enabled: true, factor: 1 })).toContain('cadence Normal');
  });
});
