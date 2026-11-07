import { describe, expect, it } from 'vitest';
import {
  adresseRelais,
  choisirVaries,
  licenceAdmise,
  lieuxDepuisLignes,
  lireCoordonnees,
  photosEnDirect,
  texteBrut,
  type LieuCandidat,
} from '../photo-mystere/en-direct.js';
import { mulberry32 } from './aventure-helpers.js';

const ligne = (qid: string, nom: string, pays: string, fichier = `${qid}.jpg`) => ({
  item: { value: `http://www.wikidata.org/entity/${qid}` },
  itemLabel: { value: nom },
  countryLabel: { value: pays },
  coord: { value: 'Point(2.2945 48.8584)' },
  image: { value: `http://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fichier)}` },
});

describe('Photo mystère en direct : lecture des données', () => {
  it('lit les coordonnées WKT et refuse les valeurs hors bornes', () => {
    expect(lireCoordonnees('Point(2.2945 48.8584)')).toEqual({ lat: 48.8584, lon: 2.2945 });
    expect(lireCoordonnees('Point(200 10)')).toBeNull();
    expect(lireCoordonnees('n’importe quoi')).toBeNull();
  });

  it('garde un lieu par entité, avec un libellé français et une photo', () => {
    const lieux = lieuxDepuisLignes([
      ligne('Q1', 'Tour Eiffel', 'France', 'Tour Eiffel nuit.jpg'),
      ligne('Q1', 'Tour Eiffel', 'France', 'Autre.jpg'),
      ligne('Q2', 'Q2', 'France'),
      ligne('Q3', 'Carte', 'France', 'Plan.svg'),
      { item: { value: 'cassé' } },
    ]);
    expect(lieux).toHaveLength(1);
    expect(lieux[0]).toMatchObject({ qid: 'Q1', fichier: 'Tour Eiffel nuit.jpg', lat: 48.8584 });
  });

  it('n’admet que les licences libres sans NC ni ND', () => {
    for (const ok of ['CC0', 'CC BY 2.0', 'CC BY-SA 4.0', 'Public domain', 'PD-old'])
      expect(licenceAdmise(ok)).toBe(true);
    for (const non of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 3.0', 'Fair use', 'Copyrighted', ''])
      expect(licenceAdmise(non)).toBe(false);
  });

  it('nettoie le HTML de l’auteur et construit l’adresse du relais', () => {
    expect(texteBrut('<a href="x">Jean &amp; Marie</a>')).toBe('Jean & Marie');
    expect(adresseRelais('https://upload.wikimedia.org/a b.jpg')).toBe(
      '/api/images-ouvertes?u=https%3A%2F%2Fupload.wikimedia.org%2Fa%20b.jpg',
    );
  });

  it('varie les pays : deux lieux au plus par pays', () => {
    const lieux = ['A', 'B', 'C', 'D'].map(
      (n, i) => ({ qid: `Q${i}`, place: n, country: i < 3 ? 'France' : 'Italie' }) as LieuCandidat,
    );
    expect(choisirVaries(lieux, 10).map((l) => l.place)).toEqual(['A', 'B', 'D']);
  });
});

describe('Photo mystère en direct : tirage complet', () => {
  it('assemble photo, licence, auteur et source, et écarte les licences refusées', async () => {
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith('https://query.wikidata.org/')) {
        const json = { results: { bindings: [ligne('Q1', 'mont Song', 'Chine'), ligne('Q2', 'Pont', 'Italie')] } };
        return new Response(JSON.stringify(json));
      }
      const pages = {
        '1': {
          title: 'File:Q1.jpg',
          imageinfo: [
            {
              thumburl: 'https://upload.wikimedia.org/thumb/Q1.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Q1.jpg',
              extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<b>Zhang</b>' } },
            },
          ],
        },
        '2': {
          title: 'File:Q2.jpg',
          imageinfo: [
            {
              thumburl: 'https://upload.wikimedia.org/thumb/Q2.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Q2.jpg',
              extmetadata: { LicenseShortName: { value: 'CC BY-NC 2.0' } },
            },
          ],
        },
      };
      return new Response(JSON.stringify({ query: { pages } }));
    }) as unknown as typeof fetch;
    const photos = await photosEnDirect(5, mulberry32(1), new AbortController().signal, fetchImpl);
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({
      id: 'wd-Q1',
      place: 'mont Song',
      country: 'Chine',
      credit: 'Zhang',
      license: 'CC BY-SA 4.0',
      source: 'https://commons.wikimedia.org/wiki/File:Q1.jpg',
      file: adresseRelais('https://upload.wikimedia.org/thumb/Q1.jpg'),
    });
  });

  it('ne renvoie rien si Wikidata est injoignable', async () => {
    const fetchImpl = (async () => Promise.reject(new Error('réseau'))) as unknown as typeof fetch;
    expect(await photosEnDirect(5, mulberry32(2), new AbortController().signal, fetchImpl)).toEqual([]);
  });
});
