import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

let dir: string;
let server: PartyServer;
let base: string;
let cookie: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-codes-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'codes-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'codes-password-123' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function createRoom(): Promise<string> {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'reflexe', practice: false }),
  });
  return ((await res.json()) as { code: string }).code;
}

async function setCodeLength(roomCodeLength: number): Promise<number> {
  const res = await fetch(`${base}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      maxPlayers: 8,
      graceSeconds: 90,
      inactivityMinutes: 30,
      maxRoomAgeMinutes: 240,
      roomCodeLength,
    }),
  });
  return res.status;
}

describe('Codes de salle à chiffres', () => {
  it('une salle reçoit un code de 4 chiffres par défaut', async () => {
    expect(await createRoom()).toMatch(/^[0-9]{4}$/);
  });

  it('la longueur choisie dans les réglages s’applique aux salles suivantes', async () => {
    expect(await setCodeLength(6)).toBe(200);
    expect(await createRoom()).toMatch(/^[0-9]{6}$/);
    expect(await setCodeLength(4)).toBe(200);
    expect(await createRoom()).toMatch(/^[0-9]{4}$/);
  });

  it('refuse une longueur hors de 4 à 6 chiffres', async () => {
    expect(await setCodeLength(3)).toBe(400);
    expect(await setCodeLength(7)).toBe(400);
  });

  it('ne trouve jamais de salle pour un code qui n’est pas composé de chiffres', async () => {
    const res = await fetch(`${base}/api/rooms/ABCD`);
    expect(((await res.json()) as { exists: boolean }).exists).toBe(false);
  });

  it('une salle ouverte garde son code quand la longueur change', async () => {
    const code = await createRoom();
    await setCodeLength(6);
    const res = await fetch(`${base}/api/rooms/${code}`);
    expect(((await res.json()) as { exists: boolean }).exists).toBe(true);
    await setCodeLength(4);
  });
});
