import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkOpenImageUrl, OpenImageCache } from '../images/open-images.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const OK = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/800px-X.jpg';

function reponse(bytes: Buffer, status = 200): Response {
  return new Response(new Uint8Array(bytes), { status, headers: { 'content-length': String(bytes.length) } });
}

function cache(fetchImpl: typeof fetch, options: { maxFiles?: number; maxFetchPerMinute?: number } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ph-images-ouvertes-'));
  return { dir, cache: new OpenImageCache({ dir, fetchImpl, ...options }) };
}

describe('Relais d’images ouvertes : adresses acceptées', () => {
  it('n’accepte que HTTPS, sans port ni identifiants, sur les domaines autorisés', () => {
    expect(checkOpenImageUrl(OK)?.hostname).toBe('upload.wikimedia.org');
    expect(checkOpenImageUrl('https://images.metmuseum.org/CRDImages/ep/web-large/DT1.jpg')).not.toBeNull();
    expect(
      checkOpenImageUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/X.JPG/1280px-X.JPG'),
    ).not.toBeNull();
    expect(checkOpenImageUrl('http://upload.wikimedia.org/x.jpg')).toBeNull();
    expect(checkOpenImageUrl('https://upload.wikimedia.org:8443/x.jpg')).toBeNull();
    expect(checkOpenImageUrl('https://user:pw@upload.wikimedia.org/x.jpg')).toBeNull();
    expect(checkOpenImageUrl('https://upload.wikimedia.org.evil.example/x.jpg')).toBeNull();
    expect(checkOpenImageUrl('https://127.0.0.1/x.jpg')).toBeNull();
    expect(checkOpenImageUrl('https://localhost/x.jpg')).toBeNull();
    expect(checkOpenImageUrl(42)).toBeNull();
    expect(checkOpenImageUrl('https://upload.wikimedia.org/' + 'a'.repeat(700))).toBeNull();
  });
});

describe('Relais d’images ouvertes : téléchargement et cache', () => {
  it('télécharge une fois, puis sert l’image gardée', async () => {
    const fetchImpl = vi.fn(async () => reponse(JPEG));
    const { cache: c, dir } = cache(fetchImpl as unknown as typeof fetch);
    const a = await c.get(OK);
    const b = await c.get(OK);
    expect(a?.mime).toBe('image/jpeg');
    expect(b?.bytes.equals(JPEG)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('ne suit aucune redirection, et ne contacte jamais un domaine refusé', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      return reponse(JPEG);
    });
    const { cache: c } = cache(fetchImpl as unknown as typeof fetch);
    expect(await c.get('https://exemple.org/x.jpg')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    await c.get(OK);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuse ce qui n’est pas une image, une réponse en erreur et un fichier trop gros', async () => {
    const pasImage = cache((async () => reponse(Buffer.from('<html>'))) as unknown as typeof fetch).cache;
    expect(await pasImage.get(OK)).toBeNull();
    const erreur = cache((async () => reponse(JPEG, 404)) as unknown as typeof fetch).cache;
    expect(await erreur.get(OK)).toBeNull();
    const gros = Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024)]);
    const tropGros = cache((async () => new Response(new Uint8Array(gros))) as unknown as typeof fetch).cache;
    expect(await tropGros.get(OK)).toBeNull();
    const echec = cache((async () => Promise.reject(new Error('réseau'))) as unknown as typeof fetch).cache;
    expect(await echec.get(OK)).toBeNull();
  });

  it('plafonne les téléchargements par minute et le nombre de fichiers gardés', async () => {
    const fetchImpl = vi.fn(async () => reponse(JPEG));
    const { cache: c, dir } = cache(fetchImpl as unknown as typeof fetch, { maxFiles: 2, maxFetchPerMinute: 3 });
    for (const n of [1, 2, 3, 4]) await c.get(`${OK}?n=${n}`);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(readdirSync(dir).length).toBeLessThanOrEqual(2);
  });
});
