import { describe, expect, it } from 'vitest';
import { loadPhotoIndex, parsePhotoIndex, photosFor, PHOTO_INDEX_URL } from '../catalog/photos.js';

describe('parsePhotoIndex', () => {
  it('garde les jeux et les fichiers valides, dans l’ordre', () => {
    const index = parsePhotoIndex({ games: { 'quiz-party': ['lobby.jpg', 'partie.jpg'] } });
    expect(index.games).toEqual({ 'quiz-party': ['lobby.jpg', 'partie.jpg'] });
  });

  it('ignore une forme inattendue sans planter', () => {
    expect(parsePhotoIndex(null).games).toEqual({});
    expect(parsePhotoIndex('texte').games).toEqual({});
    expect(parsePhotoIndex({ games: 3 }).games).toEqual({});
    expect(parsePhotoIndex({ games: null }).games).toEqual({});
  });

  it('refuse les chemins et les noms de fichiers dangereux', () => {
    // JSON.parse crée une clé « __proto__ » propre, comme un fichier index.json réel pourrait en contenir.
    const index = parsePhotoIndex(
      JSON.parse(
        '{"games":{"quiz-party":["../../secret.jpg","lobby.png","ok.jpg","a/b.jpg",42],"../evil":["lobby.jpg"],"__proto__":["lobby.jpg"],"reflexe":"lobby.jpg"}}',
      ),
    );
    expect(index.games).toEqual({ 'quiz-party': ['ok.jpg'] });
    expect(Object.getPrototypeOf(index.games)).toBe(Object.prototype);
  });
});

describe('photosFor', () => {
  it('donne les adresses publiques des captures d’un jeu', () => {
    const index = { games: { 'quiz-party': ['lobby.jpg'] } };
    expect(photosFor(index, 'quiz-party')).toEqual(['/game-photos/quiz-party/lobby.jpg']);
  });

  it('renvoie une liste vide pour un jeu sans capture', () => {
    expect(photosFor({ games: {} }, 'reflexe')).toEqual([]);
  });
});

describe('loadPhotoIndex', () => {
  function fakeFetch(response: Partial<Response> | Error) {
    return (async (url: string) => {
      expect(url).toBe(PHOTO_INDEX_URL);
      if (response instanceof Error) throw response;
      return response as Response;
    }) as typeof fetch;
  }

  it('lit l’index quand il existe', async () => {
    const res = { ok: true, json: async () => ({ games: { reflexe: ['partie.jpg'] } }) };
    expect((await loadPhotoIndex(fakeFetch(res))).games).toEqual({ reflexe: ['partie.jpg'] });
  });

  it('renvoie un index vide si le fichier est absent', async () => {
    expect((await loadPhotoIndex(fakeFetch({ ok: false, status: 404 }))).games).toEqual({});
  });

  it('renvoie un index vide si le réseau échoue', async () => {
    expect((await loadPhotoIndex(fakeFetch(new Error('réseau coupé')))).games).toEqual({});
  });
});
