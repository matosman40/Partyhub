import { describe, expect, it } from 'vitest';
import { DEFAULT_STORE_PARAMS, parseStoreParams, serializeStoreParams } from '../admin/store-filters.js';

describe('paramètres du magasin dans l’adresse', () => {
  it('une adresse vide donne les valeurs par défaut', () => {
    expect(parseStoreParams(new URLSearchParams(''))).toEqual(DEFAULT_STORE_PARAMS);
  });

  it('une valeur inconnue revient à la valeur par défaut', () => {
    const parsed = parseStoreParams(new URLSearchParams('f=n-importe-quoi&s=inconnu'));
    expect(parsed.f).toBe('tous');
    expect(parsed.s).toBe('statut');
  });

  it('lit un type vide comme absent', () => {
    expect(parseStoreParams(new URLSearchParams('t=%20')).t).toBeNull();
  });

  it('n’écrit que les valeurs qui ne sont pas par défaut', () => {
    expect(serializeStoreParams(DEFAULT_STORE_PARAMS).toString()).toBe('');
    expect(serializeStoreParams({ q: 'quiz', f: 'revue', t: 'Quiz', s: 'nom' }).toString()).toBe(
      'q=quiz&f=revue&t=Quiz&s=nom',
    );
  });

  it('se relit à l’identique (aller-retour)', () => {
    const params = { q: 'boum', f: 'mises_a_jour' as const, t: 'Questions', s: 'nom' as const };
    expect(parseStoreParams(serializeStoreParams(params))).toEqual(params);
  });

  it('garde la recherche telle qu’elle est saisie, espace finale comprise', () => {
    expect(serializeStoreParams({ ...DEFAULT_STORE_PARAMS, q: 'quiz ' }).get('q')).toBe('quiz ');
    expect(serializeStoreParams({ ...DEFAULT_STORE_PARAMS, q: '   ' }).has('q')).toBe(false);
  });
});
