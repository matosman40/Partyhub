import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { GAME_PHOTO_MAX, GAME_PHOTO_MAX_BYTES, GamePhotoStore, isJpeg } from '../game-photos/store.js';

/**
 * Captures de la première partie d'un jeu : une seule salle source par jeu, quelques images au plus,
 * et seulement pendant une vraie partie, envoyées avec le jeton d'hôte.
 */

/** Un faux JPEG : en-tête FF D8 FF, fin FF D9, contenu sans importance. */
function fakeJpeg(size = 300, fill = 0x11): Buffer {
  const bytes = Buffer.alloc(size, fill);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[size - 2] = 0xff;
  bytes[size - 1] = 0xd9;
  return bytes;
}

describe('Reconnaissance du JPEG', () => {
  it('accepte un JPEG complet et refuse le reste', () => {
    expect(isJpeg(fakeJpeg())).toBe(true);
    expect(isJpeg(fakeJpeg().subarray(0, 200).fill(0x00))).toBe(false);
    expect(isJpeg(Buffer.from('pas une image, juste du texte qui fait assez de longueur'.repeat(4)))).toBe(false);
    const truncated = fakeJpeg();
    truncated[truncated.length - 1] = 0x00;
    expect(isJpeg(truncated)).toBe(false);
  });
});

describe('GamePhotoStore', () => {
  let dir: string;
  let store: GamePhotoStore;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ph-game-photos-'));
    store = new GamePhotoStore(dir);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuse un identifiant de jeu douteux et une image qui n’est pas un JPEG', () => {
    expect(store.add('../etc', 'AB12', fakeJpeg())).toEqual({ rejected: 'invalid' });
    expect(store.add('reflexe', 'AB12', Buffer.from('bonjour'.repeat(40)))).toEqual({ rejected: 'not-jpeg' });
    expect(store.add('reflexe', 'AB12', fakeJpeg(GAME_PHOTO_MAX_BYTES + 1))).toEqual({ rejected: 'too-large' });
    expect(store.urls()).toEqual({});
  });

  it('garde les captures de la salle source, les range et les liste', () => {
    expect(store.add('reflexe', 'AB12', fakeJpeg(300, 0x22))).toEqual({ count: 1 });
    expect(store.add('reflexe', 'AB12', fakeJpeg(300, 0x33))).toEqual({ count: 2 });
    expect(store.urls()).toEqual({
      reflexe: ['/api/game-photos/reflexe/1.jpg', '/api/game-photos/reflexe/2.jpg'],
    });
    expect(existsSync(join(dir, 'game-photos', 'reflexe', '2.jpg'))).toBe(true);
    expect(store.filePath('reflexe', '2.jpg')).toBe(join(dir, 'game-photos', 'reflexe', '2.jpg'));
  });

  it('refuse une autre salle une fois le jeu photographié, sans toucher aux captures', () => {
    expect(store.add('reflexe', 'ZZ99', fakeJpeg())).toEqual({ rejected: 'closed' });
    expect(store.check('reflexe', 'ZZ99')).toBe('closed');
    expect(store.urls().reflexe).toHaveLength(2);
  });

  it('s’arrête à la limite par jeu, même pour la salle source', () => {
    for (let i = 2; i < GAME_PHOTO_MAX; i++) {
      expect(store.add('reflexe', 'AB12', fakeJpeg())).toEqual({ count: i + 1 });
    }
    expect(store.add('reflexe', 'AB12', fakeJpeg())).toEqual({ rejected: 'full' });
    expect(store.urls().reflexe).toHaveLength(GAME_PHOTO_MAX);
  });

  it('ne sert qu’un fichier listé dans l’index', () => {
    expect(store.filePath('reflexe', '../index.json')).toBeNull();
    expect(store.filePath('reflexe', '9.jpg')).toBeNull();
    expect(store.filePath('sudoku', '1.jpg')).toBeNull();
  });

  it('relit l’index après un redémarrage', () => {
    expect(new GamePhotoStore(dir).urls().reflexe).toHaveLength(GAME_PHOTO_MAX);
  });

  it('ignore un index illisible ou mal formé sans planter', () => {
    const broken = mkdtempSync(join(tmpdir(), 'ph-game-photos-broken-'));
    try {
      mkdirSync(join(broken, 'game-photos'), { recursive: true });
      writeFileSync(join(broken, 'game-photos', 'index.json'), '{ pas du json');
      expect(new GamePhotoStore(broken).urls()).toEqual({});

      writeFileSync(
        join(broken, 'game-photos', 'index.json'),
        JSON.stringify({
          games: {
            reflexe: 'texte',
            '../evil': { room: 'A', files: ['1.jpg'] },
            sudoku: { room: 'B', files: ['1.jpg', '../x.jpg'] },
          },
        }),
      );
      expect(new GamePhotoStore(broken).urls()).toEqual({ sudoku: ['/api/game-photos/sudoku/1.jpg'] });
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

describe('Routes des captures de la première partie', () => {
  let dataDir: string;
  let server: PartyServer;
  let base: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'ph-game-photos-route-'));
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
  });

  afterAll(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function createRoom(practice: boolean, gameId = 'reflexe'): Promise<{ code: string; hostToken: string }> {
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId, practice }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { code: string; hostToken: string };
  }

  /** Lance la partie en ajoutant des robots jusqu'au minimum du jeu. */
  function startRoom(code: string): void {
    const room = server.manager.getByCode(code);
    if (!room) throw new Error('salle absente');
    for (let i = 0; i < 6 && !room.start().ok; i++) room.addBot();
    expect(room.status).toBe('in_game');
  }

  function upload(code: string, token: string | null, bytes: Buffer): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'image/jpeg' };
    if (token !== null) headers['x-host-token'] = token;
    return fetch(`${base}/api/rooms/${code}/photos`, { method: 'POST', headers, body: bytes });
  }

  it('refuse l’envoi sans le jeton d’hôte', async () => {
    const room = await createRoom(false);
    startRoom(room.code);
    expect((await upload(room.code, null, fakeJpeg())).status).toBe(403);
    expect((await upload(room.code, 'mauvais-jeton', fakeJpeg())).status).toBe(403);
  });

  it('refuse les parties d’essai, qui n’ont que des robots', async () => {
    const room = await createRoom(true);
    const res = await upload(room.code, room.hostToken, fakeJpeg());
    expect(res.status).toBe(403);
  });

  it('refuse avant le lancement de la partie', async () => {
    const room = await createRoom(false);
    expect((await upload(room.code, room.hostToken, fakeJpeg())).status).toBe(409);
  });

  it('refuse une salle inconnue', async () => {
    expect((await upload('ZZZZZZ', 'x', fakeJpeg())).status).toBe(404);
  });

  it('accepte une capture pendant la partie, la publie et la sert', async () => {
    const room = await createRoom(false);
    startRoom(room.code);
    const bytes = fakeJpeg(400, 0x44);

    const res = await upload(room.code, room.hostToken, bytes);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ count: 1 });

    const list = (await (await fetch(`${base}/api/game-photos`)).json()) as { games: Record<string, string[]> };
    expect(list.games.reflexe).toEqual(['/api/game-photos/reflexe/1.jpg']);

    const file = await fetch(`${base}${list.games.reflexe?.[0]}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('image/jpeg');
    expect(Buffer.from(await file.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('refuse une image qui n’est pas un JPEG', async () => {
    const room = await createRoom(false);
    startRoom(room.code);
    const res = await upload(
      room.code,
      room.hostToken,
      Buffer.from('ceci n’est pas une image, mais il y a du texte'.repeat(5)),
    );
    expect(res.status).toBe(400);
  });

  it('accepte la capture de l’écran des résultats de la salle source', async () => {
    // Un autre jeu que les tests précédents : la salle source de « reflexe » a déjà ses captures.
    const room = await createRoom(false, 'sudoku');
    startRoom(room.code);
    expect((await upload(room.code, room.hostToken, fakeJpeg())).status).toBe(201);
    expect(server.manager.getByCode(room.code)?.end().ok).toBe(true);
    expect(server.manager.getByCode(room.code)?.status).toBe('ended');
    expect((await upload(room.code, room.hostToken, fakeJpeg())).status).toBe(201);
  });

  it('refuse une autre salle pour un jeu déjà photographié', async () => {
    const room = await createRoom(false);
    startRoom(room.code);
    const res = await upload(room.code, room.hostToken, fakeJpeg());
    expect(res.status).toBe(409);
  });

  it('refuse une capture trop lourde', async () => {
    // La taille est contrôlée avant la salle : un envoi trop lourd est refusé même sans partie.
    const room = await createRoom(false);
    const res = await upload(room.code, room.hostToken, fakeJpeg(GAME_PHOTO_MAX_BYTES + 10));
    expect(res.status).toBe(413);
  });

  it('ne sert pas un fichier absent', async () => {
    expect((await fetch(`${base}/api/game-photos/reflexe/3.jpg`)).status).toBe(404);
    expect((await fetch(`${base}/api/game-photos/..%2Fsecret/1.jpg`)).status).toBe(404);
  });

  it('garde les fichiers dans le dossier de données', () => {
    expect(existsSync(join(dataDir, 'game-photos', 'index.json'))).toBe(true);
    const index = JSON.parse(readFileSync(join(dataDir, 'game-photos', 'index.json'), 'utf8')) as {
      games: Record<string, { files: string[] }>;
    };
    expect(index.games.reflexe?.files).toEqual(['1.jpg']);
  });
});
