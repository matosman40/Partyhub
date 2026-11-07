import { describe, expect, it } from 'vitest';
import { tirageSurprise, type TirageState } from '../tirage/module.js';
import { questionInat, questionMet, type ResultatDirect } from '../tirage/en-direct.js';
import { A, B, must } from './aventure-helpers.js';

function present<T>(v: T | null): T {
  if (v === null) throw new Error('valeur absente');
  return v;
}
import { harness } from './turn-harness.js';

const met = {
  objectID: 436105,
  isPublicDomain: true,
  objectName: 'Painting',
  artistRole: 'Artist',
  artistDisplayName: 'Jacques Louis David',
  title: 'The Death of Socrates',
  primaryImageSmall: 'https://images.metmuseum.org/CRDImages/ep/web-large/DP-13139-001.jpg',
};

const inat = {
  id: 44246965,
  taxon: { id: 4246, name: 'Podilymbus podiceps', rank: 'species', preferred_common_name: 'grèbe à bec bigarré' },
  photos: [
    {
      url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpg',
      license_code: 'cc-by',
      attribution: '(c) Jean',
    },
  ],
};

describe('Tirage surprise en direct : lecture des sources', () => {
  it('un tableau du Met devient « Qui a peint ce tableau ? », servi par le relais', () => {
    const q = present(questionMet(met));
    expect(q).toMatchObject({ id: 'met-436105', reponse: 'Jacques Louis David', theme: 'Peintures' });
    expect(q.image).toBe(`/api/images-ouvertes?u=${encodeURIComponent(met.primaryImageSmall)}`);
    expect(questionMet({ ...met, isPublicDomain: false })).toBeNull();
    expect(questionMet({ ...met, objectName: 'Drawing' })).toBeNull();
    expect(questionMet({ ...met, artistDisplayName: '' })).toBeNull();
    expect(questionMet({ ...met, primaryImageSmall: 'https://ailleurs.example/x.jpg' })).toBeNull();
  });

  it('une observation iNaturalist devient « Quelle est cette espèce ? », avec le crédit et la licence', () => {
    const q = present(questionInat(inat));
    expect(q.reponse).toBe('Grèbe à bec bigarré');
    expect(q.credit).toBe('(c) Jean · CC BY');
    expect(decodeURIComponent(q.image)).toContain('/photos/1/medium.jpg');
    const nc = { ...inat, photos: [{ ...inat.photos[0], license_code: 'cc-by-nc' }] };
    expect(questionInat(nc)).toBeNull();
    expect(questionInat({ ...inat, taxon: { ...inat.taxon, preferred_common_name: undefined } })).toBeNull();
    expect(questionInat({ ...inat, taxon: { ...inat.taxon, rank: 'genus' } })).toBeNull();
  });
});

describe('Tirage surprise en direct : déroulé', () => {
  const resultat: ResultatDirect = {
    identifications: ['Jacques Louis David', 'Rembrandt', 'Vermeer', 'Goya'].map((reponse, i) => ({
      id: `met-${i}`,
      question: 'Qui a peint ce tableau ?',
      reponse,
      titre: `Tableau ${i}`,
      image: '/api/images-ouvertes?u=https%3A%2F%2Fimages.metmuseum.org%2Fx.jpg',
      theme: 'Peintures' as const,
      source: 'https://www.metmuseum.org/art/collection/search/1',
      credit: 'CC0 (Met Museum)',
    })),
    lieux: [
      {
        id: 'lieu-wd-Q1',
        titre: 'Dettifoss',
        image: '/api/images-ouvertes?u=https%3A%2F%2Fupload.wikimedia.org%2Fx.jpg',
        source: 'https://commons.wikimedia.org/wiki/File:X.jpg',
        credit: 'Auteur · CC BY-SA 4.0',
        lat: 65.8,
        lon: -16.4,
      },
    ],
  };

  function lancer(rounds = 6): { h: ReturnType<typeof harness>; s: TirageState } {
    const h = harness({ connected: [A.id, B.id] });
    const s = tirageSurprise.initialize({ rounds, guessSeconds: 60, difficulty: 2 }, [A, B], h.ctx);
    return { h, s: must(tirageSurprise.start(s, h.ctx)) };
  }

  it('passe par la préparation et demande le tirage des thèmes cochés', () => {
    const { s } = lancer();
    expect(s.phase).toBe('preparation');
    expect(s.frais).toBe('attente');
    expect(tirageSurprise.pendingJob?.(s)).toMatchObject({ id: 'frais', kind: 'tirage-frais' });
  });

  it('mêle les questions neuves (deux tiers au plus) aux banques locales', () => {
    const { h, s } = lancer(6);
    const next = tirageSurprise.completeJob!(s, 'frais', { ok: true, value: resultat }, h.ctx);
    expect(next.phase).toBe('guess');
    expect(next.frais).toBe('pret');
    expect(next.entrees).toHaveLength(6);
    const neuves = next.entrees.filter((e) => e.id.startsWith('met-') && e.id.length < 7) as unknown[];
    const lieux = next.entrees.filter((e) => e.id === 'lieu-wd-Q1');
    expect(neuves.length + lieux.length).toBeLessThanOrEqual(4);
    expect(neuves.length + lieux.length).toBeGreaterThan(0);
    for (const e of next.entrees) if (e.kind === 'identifier') expect(e.choix).toHaveLength(4);
  });

  it('garde les banques locales si le réseau échoue', () => {
    const { h, s } = lancer(4);
    const next = tirageSurprise.completeJob!(s, 'frais', { ok: false, error: 'délai' }, h.ctx);
    expect(next.frais).toBe('secours');
    expect(next.phase).toBe('guess');
    expect(next.entrees).toEqual(s.entrees);
  });

  it('le thème libre l’emporte : pas de tirage des thèmes cochés', () => {
    const h = harness({ connected: [A.id] });
    const s = tirageSurprise.initialize({ rounds: 3, themeLibre: 'fleuves' }, [A], h.ctx);
    expect(s.frais).toBeNull();
  });
});
