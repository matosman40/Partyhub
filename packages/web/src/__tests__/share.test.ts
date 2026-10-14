import { describe, expect, it } from 'vitest';
import { sharedPlaceToken } from '../seat/share.js';

describe('place partagée (lien #place=…)', () => {
  it('lit le jeton dans le fragment', () => {
    expect(sharedPlaceToken('#place=ABCDEFGH12')).toBe('ABCDEFGH12');
  });

  it('retrouve le jeton parmi plusieurs paramètres', () => {
    expect(sharedPlaceToken('#x=1&place=abcdefghijk_-')).toBe('abcdefghijk_-');
  });

  it('refuse un jeton trop court, des caractères interdits, ou une absence', () => {
    expect(sharedPlaceToken('#place=court')).toBeNull();
    expect(sharedPlaceToken('#place=ab cd efgh')).toBeNull();
    expect(sharedPlaceToken('#place=<script>')).toBeNull();
    expect(sharedPlaceToken('')).toBeNull();
    expect(sharedPlaceToken('#autre=ABCDEFGH12')).toBeNull();
  });
});
