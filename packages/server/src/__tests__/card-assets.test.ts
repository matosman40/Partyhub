/* eslint-disable @typescript-eslint/no-explicit-any -- réponses JSON brutes de l'API, vérifiées par les assertions. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardGameDefinition } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Export et import autonomes des jeux de cartes : le dos (image) et la police voyagent dans le fichier JSON.
 * Tout passe par HTTP, comme dans l'administration réelle.
 */

let server: PartyServer;
let dataDir: string;
let base: string;
let cookie: string;

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { cookie, ...((init.headers as Record<string, string>) ?? {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${base}${path}`, { ...init, headers, body });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/** Un fichier de médiathèque : en-tête PNG ou WOFF2 suivi de remplissage (le format est reconnu sur les octets). */
function fakeFile(header: string, size: number): Buffer {
  const head = Buffer.from(header, 'latin1');
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 7)]);
}
const PNG = fakeFile('\x89PNG\r\n\x1a\n', 300);
const FONT = fakeFile('wOF2', 300);

async function upload(name: string, bytes: Buffer): Promise<string> {
  const res = await call('/api/admin/assets', {
    method: 'POST',
    headers: { 'x-file-name': encodeURIComponent(name), 'content-type': 'application/octet-stream' },
    body: bytes as unknown as BodyInit,
  });
  expect(res.status).toBe(201);
  return res.data.asset.id as string;
}

/** Un jeu valide, avec un dos en image et une police de la médiathèque. */
function gameWith(imageAssetId: string | null, fontAssetId: string | null, name: string): CardGameDefinition {
  return {
    name,
    description: 'Jeu de test avec fichiers.',
    icon: '🎴',
    theme: 'arcade',
    families: [
      { id: 'rouge', label: 'Rouge', color: '#ff4d5a' },
      { id: 'bleu', label: 'Bleu', color: '#3f8cff' },
    ],
    cards: [
      { id: 'un-r', label: '1', symbol: '1', family: 'rouge', effect: 'none', count: 12, points: 1 },
      { id: 'un-b', label: '1', symbol: '1', family: 'bleu', effect: 'none', count: 12, points: 1 },
      { id: 'joker', label: 'Joker', symbol: '★', family: 'wild', effect: 'wild', count: 4, points: 30 },
    ],
    rules: { minPlayers: 2, maxPlayers: 4, handSize: 5, matchOn: 'family', targetScore: 200, turnSeconds: 20 },
    notice: { goal: 'Vider sa main.', steps: ['Posez une carte.'], tips: [] },
    back: { color: '#112233', label: 'Dos', ...(imageAssetId ? { imageAssetId } : {}) },
    ...(fontAssetId ? { fontAssetId } : {}),
  } as CardGameDefinition;
}

async function assetIds(): Promise<string[]> {
  const res = await call('/api/admin/assets');
  return (res.data.assets as { id: string }[]).map((a) => a.id);
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-card-assets-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: join(dataDir, 'test.db'),
    staticDir: join(dataDir, 'static-absent'),
    adminPassword: 'card-assets-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'card-assets-password-123' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Export d’un jeu de cartes avec ses fichiers', () => {
  it('joint l’image du dos et la police, en base64, avec le format version 3', async () => {
    const pngId = await upload('dos.png', PNG);
    const fontId = await upload('police.woff2', FONT);
    const created = await call('/api/admin/card-games', {
      method: 'POST',
      json: gameWith(pngId, fontId, 'Avec fichiers'),
    });
    expect(created.status).toBe(201);

    const exported = await call(`/api/admin/card-games/${created.data.id}/export`);
    expect(exported.status).toBe(200);
    expect(exported.data.version).toBe(3);
    expect(exported.data.assets).toHaveLength(2);
    const image = exported.data.assets.find((a: any) => a.kind === 'image');
    const font = exported.data.assets.find((a: any) => a.kind === 'font');
    expect(image.id).toBe(pngId);
    expect(font.id).toBe(fontId);
    expect(Buffer.from(image.data, 'base64').equals(PNG)).toBe(true);
    expect(Buffer.from(font.data, 'base64').equals(FONT)).toBe(true);
  });

  it('refuse l’export si le fichier du dos n’est plus lisible sur le disque', async () => {
    const pngId = await upload('fantome.png', PNG);
    const created = await call('/api/admin/card-games', { method: 'POST', json: gameWith(pngId, null, 'Dos fantôme') });
    expect(created.status).toBe(201);
    // Le fichier reste dans la base mais disparaît du disque : l'export ne doit pas produire un JSON incomplet.
    rmSync(join(dataDir, 'assets', pngId), { force: true });
    const exported = await call(`/api/admin/card-games/${created.data.id}/export`);
    expect(exported.status).toBe(409);
    expect(exported.data.error).toMatch(/export impossible/);
  });
});

describe('Import d’un jeu de cartes avec ses fichiers', () => {
  it('recrée les fichiers sous de nouveaux identifiants, sans toucher aux originaux', async () => {
    const pngId = await upload('original.png', PNG);
    const fontId = await upload('original.woff2', FONT);
    const created = await call('/api/admin/card-games', {
      method: 'POST',
      json: gameWith(pngId, fontId, 'Copie test'),
    });
    const exported = await call(`/api/admin/card-games/${created.data.id}/export`);

    const imported = await call('/api/admin/card-games/import', { method: 'POST', json: exported.data });
    expect(imported.status).toBe(201);
    expect(imported.data.id).not.toBe(created.data.id);

    const list = await call('/api/admin/card-games');
    const copy = list.data.games.find((g: any) => g.id === imported.data.id);
    const newImage = copy.definition.back.imageAssetId as string;
    const newFont = copy.definition.fontAssetId as string;
    expect(newImage).not.toBe(pngId);
    expect(newFont).not.toBe(fontId);

    const ids = await assetIds();
    expect(ids).toEqual(expect.arrayContaining([pngId, fontId, newImage, newFont]));
  });

  it('reprend un jeu d’une autre installation : ses fichiers reviennent dans la médiathèque', async () => {
    const pngId = await upload('voyage.png', PNG);
    const fontId = await upload('voyage.woff2', FONT);
    const created = await call('/api/admin/card-games', { method: 'POST', json: gameWith(pngId, fontId, 'Voyage') });
    const exported = await call(`/api/admin/card-games/${created.data.id}/export`);

    // On efface tout ce qui reste ici : le fichier ne peut venir que du JSON.
    await call(`/api/admin/card-games/${created.data.id}`, { method: 'DELETE' });
    await call(`/api/admin/assets/${pngId}`, { method: 'DELETE' });
    await call(`/api/admin/assets/${fontId}`, { method: 'DELETE' });

    const imported = await call('/api/admin/card-games/import', { method: 'POST', json: exported.data });
    expect(imported.status).toBe(201);
    const list = await call('/api/admin/card-games');
    const copy = list.data.games.find((g: any) => g.id === imported.data.id);
    const assets = await call('/api/admin/assets');
    const image = assets.data.assets.find((a: any) => a.id === copy.definition.back.imageAssetId);
    expect(image?.kind).toBe('image');
    expect(image?.name).toBe('voyage.png');
  });

  it('accepte un fichier version 1 qui référence une image déjà présente ici', async () => {
    const pngId = await upload('local.png', PNG);
    const created = await call('/api/admin/card-games', { method: 'POST', json: gameWith(pngId, null, 'Local') });
    const exported = await call(`/api/admin/card-games/${created.data.id}/export`);
    const v1 = { format: 'partyhub-jeux-cartes', version: 1, definition: exported.data.definition };

    const imported = await call('/api/admin/card-games/import', { method: 'POST', json: v1 });
    expect(imported.status).toBe(201);
    const list = await call('/api/admin/card-games');
    const copy = list.data.games.find((g: any) => g.id === imported.data.id);
    expect(copy.definition.back.imageAssetId).toBe(pngId);
  });

  it('refuse un fichier joint qui n’est pas une image, sans rien laisser dans la médiathèque', async () => {
    const pngId = await upload('controle.png', PNG);
    const created = await call('/api/admin/card-games', { method: 'POST', json: gameWith(pngId, null, 'Controle') });
    const exported = await call(`/api/admin/card-games/${created.data.id}/export`);
    const before = (await assetIds()).length;

    const tampered = structuredClone(exported.data);
    tampered.assets[0].data = Buffer.from('<script>alert(1)</script>').toString('base64');
    const res = await call('/api/admin/card-games/import', { method: 'POST', json: tampered });
    expect(res.status).toBe(400);
    expect((await assetIds()).length).toBe(before);
  });

  it('refuse un fichier joint dont le type ne correspond pas à son usage', async () => {
    const pngId = await upload('mauvais-type.png', PNG);
    const created = await call('/api/admin/card-games', {
      method: 'POST',
      json: gameWith(pngId, null, 'Mauvais type'),
    });
    const exported = await call(`/api/admin/card-games/${created.data.id}/export`);
    const before = (await assetIds()).length;

    const tampered = structuredClone(exported.data);
    tampered.assets[0].kind = 'font';
    const res = await call('/api/admin/card-games/import', { method: 'POST', json: tampered });
    expect(res.status).toBe(400);
    expect((await assetIds()).length).toBe(before);
  });

  it('accepte un jeu dont l’image du dos fait près de 5 Mo une fois codée', async () => {
    const big = fakeFile('\x89PNG\r\n\x1a\n', 4.8 * 1024 * 1024);
    const bigId = await upload('grand-dos.png', big);
    const created = await call('/api/admin/card-games', { method: 'POST', json: gameWith(bigId, null, 'Grand dos') });
    expect(created.status).toBe(201);
    const exported = await call(`/api/admin/card-games/${created.data.id}/export`);
    expect(exported.status).toBe(200);

    const imported = await call('/api/admin/card-games/import', { method: 'POST', json: exported.data });
    expect(imported.status).toBe(201);
  });
});
