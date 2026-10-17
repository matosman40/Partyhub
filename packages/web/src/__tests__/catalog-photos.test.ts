import { describe, expect, it } from 'vitest';
import {
  LIVE_PHOTOS_URL,
  loadPhotoIndex,
  mergePhotoIndexes,
  parseLivePhotos,
  photoOrigin,
  parsePhotoIndex,
  photosFor,
  PHOTO_INDEX_URL,
} from '../catalog/photos.js';

describe('parsePhotoIndex (parties d’essai)', () => {
  it('donne les adresses publiques des fichiers valides, dans l’ordre', () => {
    const index = parsePhotoIndex({ games: { 'quiz-party': ['lobby.jpg', 'partie.jpg'] } });
    expect(index.games).toEqual({
      'quiz-party': ['/game-photos/quiz-party/lobby.jpg', '/game-photos/quiz-party/partie.jpg'],
    });
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
    expect(index.games).toEqual({ 'quiz-party': ['/game-photos/quiz-party/ok.jpg'] });
    expect(Object.getPrototypeOf(index.games)).toBe(Object.prototype);
  });
});

describe('parseLivePhotos (première partie)', () => {
  it('garde les adresses du serveur qui désignent bien le jeu', () => {
    const index = parseLivePhotos({
      games: { reflexe: ['/api/game-photos/reflexe/1.jpg', '/api/game-photos/reflexe/2.jpg'] },
    });
    expect(index.games).toEqual({
      reflexe: ['/api/game-photos/reflexe/1.jpg', '/api/game-photos/reflexe/2.jpg'],
    });
  });

  it('refuse une adresse qui pointe vers un autre jeu ou un autre chemin', () => {
    const index = parseLivePhotos({
      games: {
        reflexe: ['/api/game-photos/sudoku/1.jpg', 'https://exemple.test/x.jpg', '/api/game-photos/reflexe/../1.jpg'],
      },
    });
    expect(index.games).toEqual({});
  });

  it('ignore une réponse inattendue', () => {
    expect(parseLivePhotos(undefined).games).toEqual({});
    expect(parseLivePhotos({ games: [] }).games).toEqual({});
  });
});

describe('mergePhotoIndexes', () => {
  it('fait primer la première partie sur les parties d’essai, jeu par jeu', () => {
    const merged = mergePhotoIndexes(
      { games: { reflexe: ['/game-photos/reflexe/lobby.jpg'], sudoku: ['/game-photos/sudoku/lobby.jpg'] } },
      { games: { reflexe: ['/api/game-photos/reflexe/1.jpg'] } },
    );
    expect(merged.games).toEqual({
      reflexe: ['/api/game-photos/reflexe/1.jpg'],
      sudoku: ['/game-photos/sudoku/lobby.jpg'],
    });
  });
});

describe('photosFor', () => {
  it('donne les captures d’un jeu', () => {
    const index = { games: { 'quiz-party': ['/game-photos/quiz-party/lobby.jpg'] } };
    expect(photosFor(index, 'quiz-party')).toEqual(['/game-photos/quiz-party/lobby.jpg']);
  });

  it('renvoie une liste vide pour un jeu sans capture', () => {
    expect(photosFor({ games: {} }, 'reflexe')).toEqual([]);
  });
});

describe('photoOrigin', () => {
  it('reconnaît une capture de la première partie et une capture d’essai', () => {
    expect(photoOrigin(['/api/game-photos/reflexe/1.jpg'])).toBe('partie');
    expect(photoOrigin(['/game-photos/reflexe/lobby.jpg'])).toBe('essai');
    expect(photoOrigin([])).toBe('essai');
  });
});

describe('loadPhotoIndex', () => {
  /** Faux réseau : une réponse par adresse ; une adresse absente de la table répond 404. */
  function fakeFetch(answers: Record<string, Partial<Response> | Error>) {
    return (async (url: string) => {
      const answer = answers[url];
      if (answer instanceof Error) throw answer;
      if (!answer) return { ok: false, status: 404, json: async () => null } as Response;
      return answer as Response;
    }) as typeof fetch;
  }

  const ok = (body: unknown) => ({ ok: true, json: async () => body });

  it('réunit les captures des parties d’essai et celles de la première partie', async () => {
    const index = await loadPhotoIndex(
      fakeFetch({
        [PHOTO_INDEX_URL]: ok({ games: { quiz: ['lobby.jpg'] } }),
        [LIVE_PHOTOS_URL]: ok({ games: { reflexe: ['/api/game-photos/reflexe/1.jpg'] } }),
      }),
    );
    expect(index.games).toEqual({
      quiz: ['/game-photos/quiz/lobby.jpg'],
      reflexe: ['/api/game-photos/reflexe/1.jpg'],
    });
  });

  it('renvoie un index vide si les deux fichiers sont absents', async () => {
    expect((await loadPhotoIndex(fakeFetch({}))).games).toEqual({});
  });

  it('garde la source qui répond si l’autre échoue', async () => {
    const index = await loadPhotoIndex(
      fakeFetch({
        [PHOTO_INDEX_URL]: new Error('réseau coupé'),
        [LIVE_PHOTOS_URL]: ok({ games: { reflexe: ['/api/game-photos/reflexe/1.jpg'] } }),
      }),
    );
    expect(index.games).toEqual({ reflexe: ['/api/game-photos/reflexe/1.jpg'] });
  });
});
