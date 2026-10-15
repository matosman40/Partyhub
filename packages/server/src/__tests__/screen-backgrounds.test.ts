import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import {
  EMPTY_SCREEN_BACKGROUNDS,
  parseScreenBackgrounds,
  SCREEN_KEYS,
  screenBackgroundsSchema,
} from '../screen-backgrounds.js';

/**
 * Fonds d'écran : une image de la médiathèque par écran, choisie dans l'administration.
 */

describe('Lecture des fonds enregistrés', () => {
  it('redonne l’état vide sans valeur, avec une valeur illisible ou inconnue', () => {
    expect(parseScreenBackgrounds(undefined)).toEqual(EMPTY_SCREEN_BACKGROUNDS);
    expect(parseScreenBackgrounds('pas du json')).toEqual(EMPTY_SCREEN_BACKGROUNDS);
    expect(parseScreenBackgrounds('{"home":42}')).toEqual(EMPTY_SCREEN_BACKGROUNDS);
  });

  it('complète un écran absent par « décor d’origine » sans perdre les autres', () => {
    const parsed = parseScreenBackgrounds(JSON.stringify({ tv: 'abc123' }));
    expect(parsed.tv).toBe('abc123');
    expect(Object.keys(parsed).sort()).toEqual([...SCREEN_KEYS].sort());
    expect(parsed.home).toBeNull();
  });

  it('couvre exactement les écrans prévus', () => {
    expect(Object.keys(EMPTY_SCREEN_BACKGROUNDS).sort()).toEqual([...SCREEN_KEYS].sort());
    expect(screenBackgroundsSchema.safeParse(EMPTY_SCREEN_BACKGROUNDS).success).toBe(true);
  });
});

let base: string;
let dataDir: string;
let server: PartyServer;
let adminCookie: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-screen-bg-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'test-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  expect(login.status).toBe(200);
  adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function admin(path: string, init: RequestInit = {}) {
  return fetch(`${base}/api/admin${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: adminCookie, ...(init.headers ?? {}) },
  });
}

/** Un PNG minimal : la signature suffit à la reconnaissance du type. */
function pngBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);
}

function wavBytes(): Buffer {
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(120, 4);
  header.write('WAVE', 8, 'latin1');
  return Buffer.concat([header, Buffer.alloc(108, 7)]);
}

async function upload(name: string, mime: string, body: Buffer): Promise<{ id: string; kind: string }> {
  const res = await admin('/assets', {
    method: 'POST',
    headers: { 'content-type': mime, 'x-file-name': encodeURIComponent(name) },
    body,
  });
  expect(res.status).toBe(201);
  const { asset } = (await res.json()) as { asset: { id: string; kind: string } };
  return asset;
}

describe('Fonds d’écran (administration)', () => {
  let image: string;
  let sound: string;

  it('part sans fond personnalisé : le public ne voit que des décors d’origine', async () => {
    const res = await fetch(`${base}/api/screen-backgrounds`);
    expect(res.status).toBe(200);
    const { backgrounds } = (await res.json()) as { backgrounds: Record<string, string | null> };
    expect(Object.values(backgrounds).every((v) => v === null)).toBe(true);
    expect(Object.keys(backgrounds).sort()).toEqual([...SCREEN_KEYS].sort());
  });

  it('refuse un son comme fond, un identifiant inconnu et une valeur mal formée', async () => {
    sound = (await upload('ambiance.wav', 'audio/wav', wavBytes())).id;
    const asSound = await admin('/screen-backgrounds', {
      method: 'PUT',
      body: JSON.stringify({ backgrounds: { ...EMPTY_SCREEN_BACKGROUNDS, home: sound } }),
    });
    expect(asSound.status).toBe(400);

    const unknown = await admin('/screen-backgrounds', {
      method: 'PUT',
      body: JSON.stringify({ backgrounds: { ...EMPTY_SCREEN_BACKGROUNDS, tv: 'inconnu' } }),
    });
    expect(unknown.status).toBe(400);

    const malformed = await admin('/screen-backgrounds', {
      method: 'PUT',
      body: JSON.stringify({ backgrounds: { home: 42 } }),
    });
    expect(malformed.status).toBe(400);
  });

  it('enregistre une image par écran et la rend publique pour cet écran seulement', async () => {
    image = (await upload('plage.png', 'image/png', pngBytes())).id;
    const saved = await admin('/screen-backgrounds', {
      method: 'PUT',
      body: JSON.stringify({ backgrounds: { ...EMPTY_SCREEN_BACKGROUNDS, home: image, tv: image } }),
    });
    expect(saved.status).toBe(200);

    const { backgrounds } = (await (await fetch(`${base}/api/screen-backgrounds`)).json()) as {
      backgrounds: Record<string, string | null>;
    };
    expect(backgrounds.home).toBe(`/api/assets/${image}`);
    expect(backgrounds.tv).toBe(`/api/assets/${image}`);
    expect(backgrounds.profile).toBeNull();

    const file = await fetch(`${base}/api/assets/${image}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
  });

  it('l’administration relit les identifiants enregistrés', async () => {
    const res = await admin('/screen-backgrounds');
    const { backgrounds } = (await res.json()) as { backgrounds: Record<string, string | null> };
    expect(backgrounds.home).toBe(image);
    expect(backgrounds.spectator).toBeNull();
  });

  it('empêche de supprimer une image encore utilisée comme fond, en la nommant', async () => {
    const blocked = await admin(`/assets/${image}`, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    const { error } = (await blocked.json()) as { error: string };
    expect(error).toContain('Fonds d’écran');
  });

  it('permet la suppression une fois le fond retiré', async () => {
    const reset = await admin('/screen-backgrounds', {
      method: 'PUT',
      body: JSON.stringify({ backgrounds: EMPTY_SCREEN_BACKGROUNDS }),
    });
    expect(reset.status).toBe(200);

    const removed = await admin(`/assets/${image}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const { backgrounds } = (await (await fetch(`${base}/api/screen-backgrounds`)).json()) as {
      backgrounds: Record<string, string | null>;
    };
    expect(backgrounds.home).toBeNull();
  });
});
