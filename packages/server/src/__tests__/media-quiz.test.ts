import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, HostRoomView, PlayerRoomView, ServerToClientEvents } from '@partyhub/shared';
import { parseTimeInput, parseYoutubeId, youtubeStartFromUrl, mediaQuizDefinitionSchema } from '@partyhub/shared';
import { matchAnswer, normalizeAnswer, editDistance } from '@partyhub/games';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { sniffMedia } from '../assets/service.js';

/**
 * Jeux de questions médias : correspondance des réponses, extraits (YouTube et médiathèque),
 * fichiers vérifiés sur leur contenu, et une manche complète jouée par socket.
 */

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

describe('Correspondance des réponses', () => {
  it('ignore la casse, les accents, la ponctuation et l’article de début', () => {
    expect(matchAnswer('le parrain', { answer: 'Le Parrain', aliases: [] })).toBe(true);
    expect(matchAnswer('Amelie', { answer: 'Amélie', aliases: [] })).toBe(true);
    expect(matchAnswer("L'Odyssée de l'espace", { answer: '2001 : L’Odyssée de l’espace', aliases: [] })).toBe(false);
    expect(matchAnswer('odyssee', { answer: "L'Odyssée", aliases: [] })).toBe(true);
    expect(matchAnswer('Star Wars', { answer: 'StarWars', aliases: [] })).toBe(true);
  });

  it('pardonne une faute légère sur un titre assez long, mais pas sur un titre court', () => {
    expect(matchAnswer('parain', { answer: 'Parrain', aliases: [] })).toBe(true);
    expect(matchAnswer('Titanique', { answer: 'Titanic', aliases: [] })).toBe(false);
    expect(matchAnswer('Up', { answer: 'Ap', aliases: [] })).toBe(false);
  });

  it('accepte les formulations alternatives', () => {
    expect(matchAnswer('Taxi Driver', { answer: 'Chauffeur de taxi', aliases: ['Taxi Driver'] })).toBe(true);
    expect(matchAnswer('Pulp', { answer: 'Pulp Fiction', aliases: [] })).toBe(false);
  });

  it('refuse une réponse vide ou seulement ponctuée', () => {
    expect(matchAnswer('   ', { answer: 'Heat', aliases: [] })).toBe(false);
    expect(matchAnswer('...', { answer: 'Heat', aliases: [] })).toBe(false);
  });

  it('garde les titres non latins tels quels', () => {
    expect(normalizeAnswer('千と千尋の神隠し')).toBe('千と千尋の神隠し');
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('Lecture des liens et des temps', () => {
  it('reconnaît les formes courantes d’un lien YouTube', () => {
    const id = 'abcdefghijk';
    expect(parseYoutubeId(id)).toBe(id);
    expect(parseYoutubeId(`https://www.youtube.com/watch?v=${id}&t=30`)).toBe(id);
    expect(parseYoutubeId(`https://youtu.be/${id}?t=12`)).toBe(id);
    expect(parseYoutubeId(`https://m.youtube.com/shorts/${id}`)).toBe(id);
    expect(parseYoutubeId(`youtube.com/embed/${id}`)).toBe(id);
    expect(parseYoutubeId('https://example.com/watch?v=abcdefghijk')).toBeNull();
    expect(parseYoutubeId('pas un lien')).toBeNull();
  });

  it('lit le temps de début porté par un lien', () => {
    expect(youtubeStartFromUrl('https://youtu.be/abcdefghijk?t=1m30s')).toBe(90);
    expect(youtubeStartFromUrl('https://www.youtube.com/watch?v=abcdefghijk&start=45')).toBe(45);
    expect(youtubeStartFromUrl('https://youtu.be/abcdefghijk')).toBeNull();
  });

  it('accepte les temps écrits à la main', () => {
    expect(parseTimeInput('90')).toBe(90);
    expect(parseTimeInput('1:30')).toBe(90);
    expect(parseTimeInput('1:02:03')).toBe(3723);
    expect(parseTimeInput('1m30s')).toBe(90);
    expect(parseTimeInput('bientôt')).toBeNull();
  });
});

describe('Contenu des fichiers de la médiathèque', () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(8)]);
  const m4a = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(8)]);

  it('reconnaît les formats acceptés à partir de leurs octets', () => {
    expect(sniffMedia(wav)).toEqual({ kind: 'audio', mime: 'audio/wav' });
    expect(sniffMedia(png)).toEqual({ kind: 'image', mime: 'image/png' });
    expect(sniffMedia(mp4)).toEqual({ kind: 'video', mime: 'video/mp4' });
    expect(sniffMedia(m4a)).toEqual({ kind: 'audio', mime: 'audio/mp4' });
  });

  it('refuse un texte, du HTML ou un fichier dont le nom ment', () => {
    expect(sniffMedia(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffMedia(Buffer.from('MZ\u0090\u0000\u0003\u0000\u0000\u0000'))).toBeNull();
  });
});

describe('Définition d’un jeu', () => {
  it('exige au moins un extrait et des identifiants uniques', () => {
    const base = {
      kind: 'film',
      name: 'Films test',
      items: [],
    };
    expect(mediaQuizDefinitionSchema.safeParse(base).success).toBe(false);
    const source = { type: 'youtube', videoId: 'abcdefghijk' };
    const item = { id: 'a', answer: 'Heat', source };
    const dup = mediaQuizDefinitionSchema.safeParse({ ...base, items: [item, { ...item, answer: 'Ronin' }] });
    expect(dup.success).toBe(false);
    expect(mediaQuizDefinitionSchema.safeParse({ ...base, items: [item] }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Serveur : médiathèque, jeux et une manche complète
// ---------------------------------------------------------------------------

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: PartyServer;
let base: string;
let dataDir: string;
let adminCookie = '';
const sockets: Client[] = [];
const uniq = () => randomUUID().slice(0, 8).replace(/-/g, '');

/** WAV valide de quelques millisecondes de silence : suffit pour tester le stockage et les lectures partielles. */
function makeWav(seconds = 2): Buffer {
  const rate = 8000;
  const dataLength = rate * seconds;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, Buffer.alloc(dataLength, 0x80)]);
}

function json(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function admin(path: string, init: RequestInit = {}) {
  return json(`/api/admin${path}`, { ...init, headers: { cookie: adminCookie, ...(init.headers ?? {}) } });
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = ioClient(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve) => {
    (socket as any).emit(event, ...args, (res: unknown) => resolve(res));
  });
}

function waitFor<T>(socket: Client, event: 'room:host' | 'room:player', match: (v: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const on = (view: T) => {
      if (!match(view)) return;
      clearTimeout(timer);
      socket.off(event, on as any);
      resolve(view);
    };
    const timer = setTimeout(() => {
      socket.off(event, on as any);
      reject(new Error(`Aucune vue « ${event} » attendue`));
    }, 3000);
    socket.on(event, on as any);
  });
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ph-media-'));
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
  const login = await json('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: 'test-password-123' }) });
  expect(login.status).toBe(200);
  adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Médiathèque (administration)', () => {
  it('refuse un fichier qui n’est pas un média et accepte un WAV', async () => {
    const refused = await admin('/assets', {
      method: 'POST',
      headers: { 'content-type': 'text/html', 'x-file-name': 'page.html' },
      body: '<html>pas un son</html>',
    });
    expect(refused.status).toBe(400);

    const sent = await admin('/assets', {
      method: 'POST',
      headers: { 'content-type': 'audio/wav', 'x-file-name': encodeURIComponent('chanson test.wav') },
      body: makeWav(),
    });
    expect(sent.status).toBe(201);
    const { asset } = await sent.json();
    expect(asset.kind).toBe('audio');
    expect(asset.name).toBe('chanson test.wav');
  });

  it('sert le fichier avec lecture partielle (Range), indispensable pour un lecteur audio ou vidéo', async () => {
    const list = await (await admin('/assets')).json();
    const asset = list.assets.find((a: { name: string }) => a.name === 'chanson test.wav');
    const full = await fetch(`${base}/api/assets/${asset.id}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/wav');
    const part = await fetch(`${base}/api/assets/${asset.id}`, { headers: { range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
  });

  it('refuse de supprimer un fichier encore utilisé par un jeu', async () => {
    const list = await (await admin('/assets')).json();
    const asset = list.assets.find((a: { name: string }) => a.name === 'chanson test.wav');
    const game = await admin('/media-games', {
      method: 'POST',
      body: JSON.stringify(definition(asset.id)),
    });
    expect(game.status).toBe(201);
    const blocked = await admin(`/assets/${asset.id}`, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toContain('Chansons de test');
  });
});

/** Définition de test : une chanson en fichier (réponse « Zebra Quartz ») et une vidéo YouTube. */
function definition(assetId: string) {
  return {
    kind: 'musique',
    name: 'Chansons de test',
    icon: '🎵',
    rules: { questionCount: 1, answerSeconds: 10, speedBonus: true },
    items: [
      {
        id: 'chanson-1',
        answer: 'Zebra Quartz',
        aliases: ['zq'],
        detail: '1999 · Groupe test',
        source: { type: 'asset', assetId, mediaKind: 'audio' },
        startSec: 0,
        durationSec: 5,
      },
      {
        id: 'video-2',
        answer: 'Violet Comet',
        aliases: [],
        detail: '',
        source: { type: 'youtube', videoId: 'abcdefghijk' },
        startSec: 30,
        durationSec: 8,
      },
    ],
  };
}

describe('Jeux de questions médias', () => {
  let gameId = '';
  let assetId = '';

  beforeAll(async () => {
    const list = await (await admin('/assets')).json();
    assetId = list.assets.find((a: { name: string }) => a.name === 'chanson test.wav').id;
    const existing = await (await admin('/media-games')).json();
    gameId = existing.games.find((g: { definition: { name: string } }) => g.definition.name === 'Chansons de test').id;
  });

  it('refuse un extrait qui pointe vers un fichier du mauvais type', async () => {
    const bad = definition(assetId);
    bad.items[0]!.source = { type: 'asset', assetId, mediaKind: 'video' } as any;
    const res = await admin('/media-games', { method: 'POST', body: JSON.stringify(bad) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('n’est pas un fichier vidéo');
  });

  it('apparaît au catalogue avec son origine, et peut être dupliquée puis exportée', async () => {
    const catalog = await (await json('/api/catalog')).json();
    const found = catalog.games.find((g: { id: string }) => g.id === gameId);
    expect(found).toMatchObject({ origin: 'media', category: 'quiz' });

    const copy = await admin(`/media-games/${gameId}/duplicate`, { method: 'POST' });
    expect(copy.status).toBe(201);
    const copyId = (await copy.json()).id;
    const exported = await (await admin(`/media-games/${copyId}/export`)).json();
    expect(exported.format).toBe('partyhub-questions-medias');
    expect(exported.definition.name).toBe('Chansons de test (copie)');

    // Réimport : même contenu, nouvel identifiant.
    const imported = await admin('/media-games/import', { method: 'POST', body: JSON.stringify(exported) });
    expect(imported.status).toBe(201);
  });

  it('refuse un import dont les fichiers manquent dans cette installation', async () => {
    const exported = await (await admin(`/media-games/${gameId}/export`)).json();
    exported.definition.items[0].source.assetId = 'f'.repeat(32);
    const res = await admin('/media-games/import', { method: 'POST', body: JSON.stringify(exported) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('fichier(s) manquent');
  });

  it('joue une manche : l’extrait et la réponse restent sur l’écran principal, puis la réponse est jugée', async () => {
    const created = await (await json('/api/rooms', { method: 'POST', body: JSON.stringify({ gameId }) })).json();
    const host = await connect();
    expect((await call(host, 'host:connect', { code: created.code, hostToken: created.hostToken })).ok).toBe(true);

    const player = await connect();
    const seen = waitFor<PlayerRoomView>(player, 'room:player', (v) => v.lobby.players.length === 1);
    const joined = await call(player, 'player:join', { code: created.code, name: 'Ana' });
    expect(joined.ok).toBe(true);
    await seen;

    const playing = waitFor<HostRoomView>(host, 'room:host', (v) => (v.game?.public as any)?.phase === 'playing');
    const phonePlaying = waitFor<PlayerRoomView>(player, 'room:player', (v) => (v.game?.public as any)?.phase === 'playing');
    expect((await call(host, 'host:start')).ok).toBe(true);
    const hostView = await playing;
    const hostMedia = (hostView.game!.host as any).media;
    expect(hostMedia).toMatchObject({ key: 0 });

    // Rien de ce qui permet de deviner l'extrait ne doit sortir vers les téléphones ni vers l'écran public.
    const publicJson = JSON.stringify(hostView.game!.public);
    expect(publicJson).not.toContain('Zebra Quartz');
    expect(publicJson).not.toContain('Violet Comet');
    expect(publicJson).not.toContain(assetId);
    expect(publicJson).not.toContain('abcdefghijk');

    // Le téléphone reçoit la question, sans média.
    const phoneView = await phonePlaying;
    expect(JSON.stringify(phoneView)).not.toContain(assetId);
    expect(JSON.stringify(phoneView)).not.toContain('abcdefghijk');

    // Bonne réponse : l'extrait est connu côté serveur, on la lit dans la définition de test.
    const isSong = hostMedia.source.type === 'asset';
    const answer = isSong ? 'zq' : 'Violet Comet';
    const revealed = waitFor<PlayerRoomView>(player, 'room:player', (v) => (v.game?.public as any)?.phase === 'reveal');
    const acked = await call(player, 'player:action', { commandId: `c-${uniq()}`, type: 'answer', payload: { text: answer } });
    expect(acked.ok).toBe(true);
    const view = await revealed;
    const pub = view.game!.public as any;
    expect(pub.answer).toBeTruthy();
    expect(pub.results[0]).toMatchObject({ name: 'Ana', correct: true });
    expect(pub.results[0].gained).toBeGreaterThanOrEqual(100);
    expect((view.game!.player as any).correct).toBe(true);
    expect((view.game!.player as any).points).toBeGreaterThanOrEqual(100);

    // Une seule réponse par extrait.
    const again = await call(player, 'player:action', { commandId: `c-${uniq()}`, type: 'answer', payload: { text: 'autre' } });
    expect(again.ok).toBe(false);

    host.disconnect();
    player.disconnect();
  });
});
