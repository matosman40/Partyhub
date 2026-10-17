import { describe, expect, it } from 'vitest';
import {
  CAPTURE_DELAYS_MS,
  CAPTURE_MAX_BYTES,
  coverCrop,
  FINAL_CAPTURE_DELAY_MS,
  isThisTab,
  uploadGamePhoto,
} from '../tv/gamePhotos.js';

/** Le serveur garde au plus quatre captures par jeu. */
const SERVER_MAX_PER_GAME = 4;

describe('coverCrop', () => {
  it('recadre les bords d’un écran plus large que la fiche, sans déformer', () => {
    expect(coverCrop(2560, 720)).toEqual({ sx: 640, sy: 0, sw: 1280, sh: 720 });
  });

  it('recadre le haut et le bas d’un écran plus haut', () => {
    expect(coverCrop(1280, 1280)).toEqual({ sx: 0, sy: 280, sw: 1280, sh: 720 });
  });

  it('garde toute l’image quand la proportion est déjà 16:9', () => {
    expect(coverCrop(1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });
});

describe('uploadGamePhoto', () => {
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' });

  function recorder(response: Partial<Response> | Error) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (response instanceof Error) throw response;
      return response as Response;
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('envoie l’image à la salle avec le jeton d’hôte', async () => {
    const { calls, fetchImpl } = recorder({ status: 201 });
    expect(await uploadGamePhoto('ABC123', 'jeton-hote', blob, fetchImpl)).toBe('saved');
    expect(calls[0]?.url).toBe('/api/rooms/ABC123/photos');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'image/jpeg', 'X-Host-Token': 'jeton-hote' });
    expect(calls[0]?.init.body).toBe(blob);
  });

  it('dit « fermé » quand le serveur ne veut plus de captures pour ce jeu', async () => {
    expect(await uploadGamePhoto('ABC123', 't', blob, recorder({ status: 409 }).fetchImpl)).toBe('closed');
  });

  it('dit « échec » pour toute autre réponse ou une coupure réseau, sans arrêter la suite', async () => {
    expect(await uploadGamePhoto('ABC123', 't', blob, recorder({ status: 413 }).fetchImpl)).toBe('failed');
    expect(await uploadGamePhoto('ABC123', 't', blob, recorder({ status: 500 }).fetchImpl)).toBe('failed');
    expect(await uploadGamePhoto('ABC123', 't', blob, recorder(new Error('coupé')).fetchImpl)).toBe('failed');
  });

  it('encode le code de salle dans l’adresse', async () => {
    const { calls, fetchImpl } = recorder({ status: 201 });
    await uploadGamePhoto('a/b', 't', blob, fetchImpl);
    expect(calls[0]?.url).toBe('/api/rooms/a%2Fb/photos');
  });
});

describe('planning des captures', () => {
  it('prend moins de captures que le serveur n’en garde par jeu, y compris celle des résultats', () => {
    expect(CAPTURE_DELAYS_MS.length + 1).toBeLessThanOrEqual(SERVER_MAX_PER_GAME);
    expect(FINAL_CAPTURE_DELAY_MS).toBeGreaterThan(0);
    expect(new Set(CAPTURE_DELAYS_MS).size).toBe(CAPTURE_DELAYS_MS.length);
    expect([...CAPTURE_DELAYS_MS].sort((a, b) => a - b)).toEqual(CAPTURE_DELAYS_MS);
  });

  it('accepte une capture de taille raisonnable pour le serveur', () => {
    expect(CAPTURE_MAX_BYTES).toBe(400 * 1024);
  });
});

describe('isThisTab', () => {
  it('n’accepte que le partage de cet onglet', () => {
    expect(isThisTab({ displaySurface: 'browser' } as MediaTrackSettings)).toBe(true);
    expect(isThisTab({ displaySurface: 'monitor' } as MediaTrackSettings)).toBe(false);
    expect(isThisTab({ displaySurface: 'window' } as MediaTrackSettings)).toBe(false);
    expect(isThisTab({} as MediaTrackSettings)).toBe(false);
  });
});
