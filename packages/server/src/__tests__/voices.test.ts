import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import {
  VOICE_MAX_BYTES,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type VoiceEvent,
} from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Voix de profil : envoi, limites (5 voix, 300 Ko, formats audio reconnus), écoute publique,
 * et déclenchement depuis le téléphone d'un joueur vers l'écran principal uniquement.
 */

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: PartyServer;
let base: string;
const sockets: Client[] = [];
const uniq = () => randomUUID().slice(0, 8).replace(/-/g, '');

beforeAll(async () => {
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir: '/tmp/partyhub-tests',
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
  for (const s of sockets) s.disconnect();
  await server.close();
});

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = ioClient(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

interface Ack {
  ok: boolean;
  error?: string;
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: Ack) => resolve(res));
  });
}

function json(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/** Son minimal reconnu à ses premiers octets (WebM, MP4, MP3 ou WAV), complété jusqu'à la taille voulue. */
function sound(kind: 'webm' | 'mp4' | 'mp3' | 'wav' | 'text' = 'webm', size = 2048): Buffer {
  const head: Record<typeof kind, number[]> = {
    webm: [0x1a, 0x45, 0xdf, 0xa3],
    mp4: [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70],
    mp3: [0x49, 0x44, 0x33, 0x04],
    wav: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
    text: [0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20],
  };
  const bytes = Buffer.alloc(size, 0);
  Buffer.from(head[kind]).copy(bytes);
  return bytes;
}

async function registerProfile(name: string) {
  const username = `${name}_${uniq()}`.slice(0, 20);
  const res = await json('/api/profiles/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: 'motdepasse1', displayName: name }),
  });
  const { token, profile } = (await res.json()) as { token: string; profile: { id: string } };
  return { token, auth: { authorization: `Bearer ${token}` }, id: profile.id };
}

function upload(token: string, name: string, body: Buffer, type = 'audio/webm') {
  return fetch(`${base}/api/profiles/me/voices?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': type },
    body,
  });
}

describe('Voix de profil : envoi et écoute', () => {
  it('enregistre une voix, la liste sans son et la sert avec les plages d’octets', async () => {
    const me = await registerProfile('nora');
    const res = await upload(me.token, 'Fanfare', sound('webm', 4096));
    expect(res.status).toBe(201);
    const { voice } = (await res.json()) as { voice: { id: string; name: string } };
    expect(voice.name).toBe('Fanfare');

    const list = await json('/api/profiles/me/voices', { headers: me.auth });
    const body = (await list.json()) as { voices: { id: string; name: string; data?: unknown }[] };
    expect(body.voices).toHaveLength(1);
    expect(body.voices[0]).toMatchObject({ id: voice.id, name: 'Fanfare' });
    expect(body.voices[0]).not.toHaveProperty('data');

    // Écoute publique : les écrans n'ont pas de compte.
    const audio = await fetch(`${base}/api/voices/${voice.id}`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/webm');
    expect(audio.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await audio.arrayBuffer()).byteLength).toBe(4096);

    const part = await fetch(`${base}/api/voices/${voice.id}`, { headers: { range: 'bytes=0-3' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 0-3/4096');
    expect((await part.arrayBuffer()).byteLength).toBe(4);
  });

  it('reconnaît les formats audio courants et refuse le reste', async () => {
    const me = await registerProfile('omar');
    const ok = await upload(me.token, 'Mp3', sound('mp3'), 'audio/mpeg');
    expect(ok.status).toBe(201);
    const { voice } = (await ok.json()) as { voice: { id: string } };
    const served = await fetch(`${base}/api/voices/${voice.id}`);
    expect(served.headers.get('content-type')).toBe('audio/mpeg');

    const text = await upload(me.token, 'Texte', sound('text'), 'audio/webm');
    expect(text.status).toBe(400);
    expect((await text.json()).error).toMatch(/pas un son reconnu/);
  });

  it('refuse un nom vide, trop long ou avec un caractère de contrôle', async () => {
    const me = await registerProfile('lena');
    expect((await upload(me.token, '   ', sound())).status).toBe(400);
    expect((await upload(me.token, 'x'.repeat(31), sound())).status).toBe(400);
    expect((await upload(me.token, 'bien\u0007sonné', sound())).status).toBe(400);
  });

  it('limite à cinq voix par profil', async () => {
    const me = await registerProfile('hugo');
    for (let i = 1; i <= 5; i++) {
      expect((await upload(me.token, `Voix ${i}`, sound())).status).toBe(201);
    }
    const sixth = await upload(me.token, 'Voix 6', sound());
    expect(sixth.status).toBe(409);
    expect((await sixth.json()).error).toMatch(/déjà 5 voix/);
  });

  it('refuse un enregistrement plus lourd que la limite', async () => {
    const me = await registerProfile('iris');
    const res = await upload(me.token, 'Trop long', sound('webm', VOICE_MAX_BYTES + 1));
    expect(res.status).toBe(413);
  });

  it('exige un profil connecté pour envoyer, lister et modifier', async () => {
    const res = await upload('jeton-invente', 'Pirate', sound());
    expect(res.status).toBe(401);
    expect((await json('/api/profiles/me/voices')).status).toBe(401);
  });

  it('renomme et supprime seulement les voix de son propre profil', async () => {
    const owner = await registerProfile('paul');
    const other = await registerProfile('rose');
    const { voice } = (await (await upload(owner.token, 'Coucou', sound())).json()) as { voice: { id: string } };

    const stolen = await json(`/api/profiles/me/voices/${voice.id}`, {
      method: 'PUT',
      headers: other.auth,
      body: JSON.stringify({ name: 'Piraté' }),
    });
    expect(stolen.status).toBe(404);
    expect((await json(`/api/profiles/me/voices/${voice.id}`, { method: 'DELETE', headers: other.auth })).status).toBe(
      404,
    );

    const renamed = await json(`/api/profiles/me/voices/${voice.id}`, {
      method: 'PUT',
      headers: owner.auth,
      body: JSON.stringify({ name: 'Bonjour' }),
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).voice.name).toBe('Bonjour');

    const deleted = await json(`/api/profiles/me/voices/${voice.id}`, { method: 'DELETE', headers: owner.auth });
    expect(deleted.status).toBe(200);
    expect((await fetch(`${base}/api/voices/${voice.id}`)).status).toBe(404);
  });

  it('supprime les voix avec le compte', async () => {
    const me = await registerProfile('sami');
    const { voice } = (await (await upload(me.token, 'Adieu', sound())).json()) as { voice: { id: string } };
    expect((await json('/api/profiles/me', { method: 'DELETE', headers: me.auth })).status).toBe(200);
    expect((await fetch(`${base}/api/voices/${voice.id}`)).status).toBe(404);
  });
});

describe('Voix de profil : jouées sur l’écran principal', () => {
  async function roomWithProfilePlayer(name: string) {
    const created = await json('/api/rooms', { method: 'POST', body: JSON.stringify({ gameId: 'quiz-party' }) }).then(
      (r) => r.json(),
    );
    const me = await registerProfile(name);
    const { voice } = (await (await upload(me.token, 'Fanfare', sound())).json()) as { voice: { id: string } };
    const player = await connect();
    const joined = await call(player, 'player:join', {
      code: created.code,
      name,
      profileToken: me.token,
    });
    expect(joined.ok).toBe(true);
    return { code: created.code as string, hostToken: created.hostToken as string, player, voiceId: voice.id };
  }

  async function screen(code: string, hostToken: string) {
    const tv = await connect();
    expect((await call(tv, 'host:connect', { code, hostToken, screen: true })).ok).toBe(true);
    return tv;
  }

  it('joue la voix sur l’écran principal, avec le nom du joueur et de la voix', async () => {
    const { code, hostToken, player, voiceId } = await roomWithProfilePlayer('tina');
    const tv = await screen(code, hostToken);
    const onTv = new Promise<VoiceEvent>((resolve) => tv.once('room:voice', resolve));
    const ack = await call(player, 'player:voice', { id: voiceId });
    expect(ack.ok).toBe(true);
    const event = await onTv;
    expect(event).toMatchObject({ from: 'tina', name: 'Fanfare', voiceId });
    expect(event.avatar).toBeTruthy();
  });

  it('n’envoie pas la voix au téléphone de l’hôte, seulement à l’écran principal', async () => {
    const { code, hostToken, player, voiceId } = await roomWithProfilePlayer('vera');
    const tv = await screen(code, hostToken);
    const phoneHost = await connect();
    expect((await call(phoneHost, 'host:connect', { code, hostToken })).ok).toBe(true);

    const heardOnPhone = new Promise<boolean>((resolve) => {
      phoneHost.once('room:voice', () => resolve(true));
      setTimeout(() => resolve(false), 400);
    });
    const onTv = new Promise<boolean>((resolve) => {
      tv.once('room:voice', () => resolve(true));
      setTimeout(() => resolve(false), 400);
    });
    expect((await call(player, 'player:voice', { id: voiceId })).ok).toBe(true);
    expect(await onTv).toBe(true);
    expect(await heardOnPhone).toBe(false);
  });

  it('refuse une voix d’un autre profil et les invités', async () => {
    const { code, hostToken, player } = await roomWithProfilePlayer('wade');
    await screen(code, hostToken);
    const other = await registerProfile('xena');
    const { voice } = (await (await upload(other.token, 'Secret', sound())).json()) as { voice: { id: string } };
    const refused = await call(player, 'player:voice', { id: voice.id });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/pas dans votre profil/);

    const created = await json('/api/rooms', { method: 'POST', body: JSON.stringify({ gameId: 'quiz-party' }) }).then(
      (r) => r.json(),
    );
    const guest = await connect();
    expect((await call(guest, 'player:join', { code: created.code, name: 'Invité' })).ok).toBe(true);
    const guestTry = await call(guest, 'player:voice', { id: voice.id });
    expect(guestTry.ok).toBe(false);
  });

  it('prévient quand aucun écran principal n’est connecté', async () => {
    const { player, voiceId } = await roomWithProfilePlayer('yann');
    const ack = await call(player, 'player:voice', { id: voiceId });
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/Aucun écran principal/);
  });
});
