import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Lot de sons libres (Openverse, licence CC0) : chaque fichier existe et sa licence est notée. */
const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));
const manifest = JSON.parse(readFileSync(`${PUBLIC}/sons/SOURCES.json`, 'utf8')) as {
  nom: string;
  fichier: string;
  licence: string;
  source: string;
  duree_ms: number;
}[];

describe('lot de sons libres', () => {
  it('chaque son existe sur le disque', () => {
    expect(manifest.length).toBeGreaterThanOrEqual(8);
    for (const s of manifest) expect(existsSync(`${PUBLIC}${s.fichier}`), s.nom).toBe(true);
  });

  it('chaque son est sous licence CC0 avec sa source, et reste court', () => {
    for (const s of manifest) {
      expect(s.licence, s.nom).toBe('cc0');
      expect(s.source, s.nom).toMatch(/^https:\/\/freesound\.org\//);
      expect(s.duree_ms, s.nom).toBeLessThanOrEqual(5000);
    }
  });
});
