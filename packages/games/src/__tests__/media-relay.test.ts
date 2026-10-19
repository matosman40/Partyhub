import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMediaBytes, usesMediaRelay } from '../client/media-relay.js';

type Relay = { __partyhubMedia?: { get(url: string): Promise<{ type: string; data: ArrayBuffer }> } };
const g = globalThis as unknown as Relay;

afterEach(() => {
  delete g.__partyhubMedia;
  vi.unstubAllGlobals();
});

describe('relais des médias d’une vue de jeu de code', () => {
  it('hors vue de jeu, lit l’adresse directement sur le serveur', async () => {
    expect(usesMediaRelay()).toBe(false);
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const data = await loadMediaBytes('/api/assets/abc');
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/abc', { credentials: 'same-origin' });
  });

  it('hors vue de jeu, une réponse en erreur lève une erreur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    await expect(loadMediaBytes('/api/assets/absent')).rejects.toThrow('404');
  });

  it('dans une vue de jeu de code, passe par le relais de la page et n’appelle pas le réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const get = vi.fn(async () => ({ type: 'image/png', data: new Uint8Array([9]).buffer }));
    g.__partyhubMedia = { get };
    expect(usesMediaRelay()).toBe(true);
    const data = await loadMediaBytes('/api/character-packs');
    expect(new Uint8Array(data)).toEqual(new Uint8Array([9]));
    expect(get).toHaveBeenCalledWith('/api/character-packs');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un média refusé par le relais fait échouer le chargement', async () => {
    g.__partyhubMedia = { get: async () => Promise.reject(new Error('Média non autorisé.')) };
    await expect(loadMediaBytes('/api/admin/store')).rejects.toThrow('non autorisé');
  });
});
