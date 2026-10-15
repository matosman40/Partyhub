import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES } from '../boum/bank/countries.js';
import { COUNTRY_CENTROIDS, COUNTRY_NAMES_FR, COUNTRY_PATHS } from '../boum/geo/countries-data.js';
import { countryPoints, haversineKm } from '../boum/scoring.js';

/** Où est-ce ? : données de carte et barème par distance. */
describe('BOUM ! : données des pays', () => {
  it('donne un centre et un nom à chaque code acceptable comme réponse', () => {
    const missingCentre = COUNTRY_CODES.filter((code) => !COUNTRY_CENTROIDS[code]);
    const missingName = COUNTRY_CODES.filter((code) => !COUNTRY_NAMES_FR[code]);
    expect(missingCentre).toEqual([]);
    expect(missingName).toEqual([]);
  });

  it('dessine une partie des pays seulement (jeu 110 m), sans casser les autres', () => {
    expect(COUNTRY_PATHS.FR).toMatch(/^M/);
    expect(Object.keys(COUNTRY_PATHS).length).toBeGreaterThan(150);
  });

  it('calcule des distances plausibles', () => {
    const paris: [number, number] = [48.86, 2.35];
    const lyon: [number, number] = [45.76, 4.84];
    const tokyo: [number, number] = [35.68, 139.69];
    expect(haversineKm(paris, lyon)).toBeGreaterThan(380);
    expect(haversineKm(paris, lyon)).toBeLessThan(400);
    expect(haversineKm(paris, tokyo)).toBeGreaterThan(9000);
  });
});

describe('BOUM ! : barème « Où est-ce ? »', () => {
  const centres = {
    FR: [46.6, 2.2],
    BE: [50.6, 4.7],
    JP: [36.2, 138.3],
  } as const;

  it('donne 100 pour le bon pays, quelle que soit la distance', () => {
    expect(countryPoints({ a: 'FR' }, 'FR', centres)).toEqual({ a: 100 });
  });

  it('baisse avec la distance, et tombe à 0 au-delà de 2 000 km', () => {
    const near = countryPoints({ b: 'BE' }, 'FR', centres).b!;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(100);
    expect(countryPoints({ c: 'JP' }, 'FR', centres).c).toBe(0);
  });

  it('ne rapporte rien pour un pays sans centre connu', () => {
    expect(countryPoints({ d: 'ZZ' }, 'FR', centres).d).toBe(0);
  });
});
