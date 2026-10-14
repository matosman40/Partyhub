import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardGameDefinition } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { canonical } from '../backup.js';
import { writeZip } from '../packages/zip.js';

/** Doublons à la restauration, mode « remplacer », et archive complète avec la médiathèque. */

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

function cardDefinition(name: string, targetScore = 200): CardGameDefinition {
  return {
    name,
    description: 'Jeu de test.',
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
    rules: { minPlayers: 2, maxPlayers: 4, handSize: 5, matchOn: 'family', targetScore, turnSeconds: 20 },
    notice: { goal: 'Vider sa main.', steps: ['Posez une carte.'], tips: [] },
  } as CardGameDefinition;
}

/** En-tête WAV valide : seul le format compte pour la médiathèque. */
function wavBytes(extra = 64): Buffer {
  const head = Buffer.alloc(12 + extra);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(head.length - 8, 4);
  head.write('WAVE', 8, 'latin1');
  return head;
}

async function backupJson() {
  return (await call('/api/admin/backup')).data as { cardGames: CardGameDefinition[] };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-archive-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: join(dataDir, 'test.db'),
    staticDir: join(dataDir, 'static-absent'),
    adminPassword: 'archive-password-123',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({ config, logger: createLogger('silent', true), sweepEveryMs: 0 });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'archive-password-123' }),
  });
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Restauration additive', () => {
  it('une définition identique déjà présente n’est pas recréée', async () => {
    const backup = { format: 'partyhub-sauvegarde', version: 1, cardGames: [cardDefinition('Jeu doublon')] };
    const first = await call('/api/admin/backup/import', { method: 'POST', json: backup });
    expect(first.status).toBe(200);
    expect(first.data.summary.cardGames).toBe(1);

    const before = (await backupJson()).cardGames.length;
    const second = await call('/api/admin/backup/import', { method: 'POST', json: backup });
    expect(second.data.summary.duplicates).toBe(1);
    expect(second.data.summary.cardGames).toBe(0);
    expect((await backupJson()).cardGames.length).toBe(before);
  });

  it('en mode « ajouter », un jeu de même nom mais modifié devient une copie', async () => {
    const before = (await backupJson()).cardGames.length;
    const res = await call('/api/admin/backup/import', {
      method: 'POST',
      json: { format: 'partyhub-sauvegarde', version: 1, cardGames: [cardDefinition('Jeu doublon', 150)] },
    });
    expect(res.data.summary.cardGames).toBe(1);
    expect(res.data.summary.replaced).toBe(0);
    expect((await backupJson()).cardGames.length).toBe(before + 1);
  });

  it('en mode « remplacer », le jeu de même nom est mis à jour sans copie', async () => {
    const before = (await backupJson()).cardGames.length;
    const res = await call('/api/admin/backup/import?conflict=replace', {
      method: 'POST',
      json: { format: 'partyhub-sauvegarde', version: 1, cardGames: [cardDefinition('Jeu doublon', 90)] },
    });
    expect(res.data.summary.replaced).toBe(1);
    const after = (await backupJson()).cardGames;
    expect(after.length).toBe(before);
    expect(after.filter((d) => d.name === 'Jeu doublon').map((d) => d.rules.targetScore)).toEqual(
      expect.arrayContaining([90]),
    );
  });
});

describe('Archive complète avec la médiathèque', () => {
  it('l’archive contient les fichiers ; après suppression, la restauration rétablit le même identifiant', async () => {
    const wav = wavBytes();
    const up = await call('/api/admin/assets', {
      method: 'POST',
      headers: { 'content-type': 'audio/wav', 'x-file-name': encodeURIComponent('chanson test.wav') },
      body: wav,
    });
    expect(up.status).toBe(201);
    const assetId: string = up.data.asset.id;

    const archive = await fetch(`${base}/api/admin/backup/archive`, { headers: { cookie } });
    expect(archive.status).toBe(200);
    expect(archive.headers.get('content-type')).toContain('application/zip');
    const bytes = new Uint8Array(await archive.arrayBuffer());

    const del = await call(`/api/admin/assets/${assetId}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(existsSync(join(dataDir, 'assets', assetId))).toBe(false);

    const restored = await call('/api/admin/backup/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: bytes,
    });
    expect(restored.status).toBe(200);
    expect(restored.data.summary.assets).toBe(1);
    expect(existsSync(join(dataDir, 'assets', assetId))).toBe(true);

    const list = await call('/api/admin/assets');
    expect(list.data.assets.map((a: any) => a.id)).toContain(assetId);

    // Une seconde restauration ne duplique pas le fichier.
    const again = await call('/api/admin/backup/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: bytes,
    });
    expect(again.data.summary.assets).toBe(0);
    expect(again.data.summary.assetsPresent).toBe(1);
  });

  it('refuse une archive qui contient un élément inattendu', async () => {
    const bad = writeZip([
      { name: 'backup.json', data: new TextEncoder().encode('{}') },
      { name: 'assets.json', data: new TextEncoder().encode('[]') },
      { name: '../../evil.txt', data: new TextEncoder().encode('x') },
    ]);
    const res = await call('/api/admin/backup/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: bad,
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/inattendu|illisible|Élément/);
  });

  it('refuse un fichier dont le contenu ne correspond pas à son type déclaré', async () => {
    const fake = new TextEncoder().encode('pas un son');
    const id = '0'.repeat(31) + '1';
    const bad = writeZip([
      { name: 'backup.json', data: new TextEncoder().encode(JSON.stringify({ format: 'partyhub-sauvegarde', version: 1 })) },
      {
        name: 'assets.json',
        data: new TextEncoder().encode(
          JSON.stringify([{ id, kind: 'audio', mime: 'audio/wav', name: 'faux.wav', size: fake.length, createdAt: new Date().toISOString() }]),
        ),
      },
      { name: `assets/${id}`, data: fake },
    ]);
    const res = await call('/api/admin/backup/archive', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: bad,
    });
    // La sauvegarde elle-même est valide : le fichier refusé est signalé, pas le reste.
    expect(res.status).toBe(200);
    expect(res.data.summary.assets).toBe(0);
    expect(res.data.summary.skipped.join(' ')).toMatch(/format non reconnu/);
  });
});

describe('Comparaison des définitions', () => {
  it('deux objets aux clés dans un ordre différent sont identiques', () => {
    expect(canonical({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(canonical({ b: { d: 'x', c: [1, 2] }, a: 1 }));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
  });
});
