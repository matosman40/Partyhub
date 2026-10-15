import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_SOUND_SETTINGS, MUSIC_SLOTS, SFX_NAMES } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/** Sons : musique de fond et bruitages choisis dans la médiathèque, réglés par l'administration. */

let base: string;
let dataDir: string;
let server: PartyServer;
let adminCookie: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-sounds-'));
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

function wavBytes(): Buffer {
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(120, 4);
  header.write('WAVE', 8, 'latin1');
  return Buffer.concat([header, Buffer.alloc(108, 7)]);
}

function pngBytes(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);
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

async function publicSounds(): Promise<{ music: Record<string, string | null>; sfx: Record<string, string | null> }> {
  const res = await fetch(`${base}/api/sound-settings`);
  expect(res.status).toBe(200);
  return (
    (await res.json()) as { sounds: { music: Record<string, string | null>; sfx: Record<string, string | null> } }
  ).sounds;
}

describe('Sons (administration)', () => {
  let track: string;
  let image: string;

  it('part sans son choisi : musique coupée, bruitages d’origine', async () => {
    const sounds = await publicSounds();
    expect(Object.keys(sounds.music).sort()).toEqual([...MUSIC_SLOTS].sort());
    expect(Object.keys(sounds.sfx).sort()).toEqual([...SFX_NAMES].sort());
    expect(Object.values(sounds.music).every((v) => v === null)).toBe(true);
    expect(Object.values(sounds.sfx).every((v) => v === null)).toBe(true);
    expect(EMPTY_SOUND_SETTINGS.sfx.explode).toBeNull();
  });

  it('refuse une image comme son, un identifiant inconnu et une forme invalide', async () => {
    track = (await upload('accueil.wav', 'audio/wav', wavBytes())).id;
    image = (await upload('affiche.png', 'image/png', pngBytes())).id;

    const asImage = await admin('/sound-settings', {
      method: 'PUT',
      body: JSON.stringify({
        sounds: { ...EMPTY_SOUND_SETTINGS, music: { ...EMPTY_SOUND_SETTINGS.music, accueil: image } },
      }),
    });
    expect(asImage.status).toBe(400);

    const unknown = await admin('/sound-settings', {
      method: 'PUT',
      body: JSON.stringify({
        sounds: { ...EMPTY_SOUND_SETTINGS, sfx: { ...EMPTY_SOUND_SETTINGS.sfx, explode: 'inconnu' } },
      }),
    });
    expect(unknown.status).toBe(400);

    const malformed = await admin('/sound-settings', {
      method: 'PUT',
      body: JSON.stringify({ sounds: { music: { accueil: 42 } } }),
    });
    expect(malformed.status).toBe(400);
  });

  it('enregistre une piste de fond et un bruitage, et les rend publics', async () => {
    const saved = await admin('/sound-settings', {
      method: 'PUT',
      body: JSON.stringify({
        sounds: {
          ...EMPTY_SOUND_SETTINGS,
          music: { ...EMPTY_SOUND_SETTINGS.music, accueil: track },
          sfx: { ...EMPTY_SOUND_SETTINGS.sfx, explode: track },
        },
      }),
    });
    expect(saved.status).toBe(200);

    const sounds = await publicSounds();
    expect(sounds.music.accueil).toBe(`/api/assets/${track}`);
    expect(sounds.music.menus).toBeNull();
    expect(sounds.sfx.explode).toBe(`/api/assets/${track}`);
    expect(sounds.sfx.win).toBeNull();
  });

  it('empêche de supprimer un fichier utilisé comme son, en le nommant', async () => {
    const list = (await (await admin('/assets')).json()) as { assets: { id: string; usedBy: string[] }[] };
    const used = list.assets.find((a) => a.id === track);
    expect(used?.usedBy).toContain('Sons');

    const blocked = await admin(`/assets/${track}`, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect(await blocked.text()).toContain('Sons');
  });

  it('libère le fichier une fois les sons remis à zéro', async () => {
    const reset = await admin('/sound-settings', {
      method: 'PUT',
      body: JSON.stringify({ sounds: EMPTY_SOUND_SETTINGS }),
    });
    expect(reset.status).toBe(200);
    expect((await publicSounds()).music.accueil).toBeNull();

    const released = await admin(`/assets/${track}`, { method: 'DELETE' });
    expect(released.status).toBe(200);
  });
});
