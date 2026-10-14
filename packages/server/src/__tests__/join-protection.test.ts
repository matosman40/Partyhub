import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { ROOM_CODE_ALPHABET, type ClientToServerEvents, type ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { loadConfig } from '../config.js';
import { clientIp, normalizeIp } from '../realtime/client-ip.js';
import { JoinThrottle, JOIN_THROTTLE_DEFAULTS } from '../realtime/join-throttle.js';
import { compileTrustProxy } from '../trust-proxy.js';

/**
 * Protection contre l'énumération des codes de salle :
 * - adresse réelle du client (TRUST_PROXY, comme Express) ;
 * - ralentissement des codes inconnus, sans jamais ralentir les connexions valides.
 */

// --- Adresse du client ---------------------------------------------------------

describe('Adresse réelle du client', () => {
  const loopbackOnly = compileTrustProxy('loopback');

  it('normalise les adresses IPv4 vues en IPv6', () => {
    expect(normalizeIp('::ffff:192.168.1.20')).toBe('192.168.1.20');
    expect(normalizeIp(' 2001:DB8::1 ')).toBe('2001:db8::1');
  });

  it('une connexion directe garde son adresse, même si un en-tête prétend autre chose', () => {
    expect(clientIp(loopbackOnly, '192.168.1.20', '10.0.0.99')).toBe('192.168.1.20');
  });

  it('derrière un proxy de boucle, lit le client dans X-Forwarded-For', () => {
    expect(clientIp(loopbackOnly, '127.0.0.1', '203.0.113.7')).toBe('203.0.113.7');
    expect(clientIp(loopbackOnly, '127.0.0.1', '203.0.113.7, 127.0.0.1')).toBe('203.0.113.7');
    expect(clientIp(loopbackOnly, '127.0.0.1', ['198.51.100.2', '203.0.113.7'])).toBe('203.0.113.7');
  });

  it('avec TRUST_PROXY sur le réseau Docker, fait confiance à la passerelle, pas au réseau local', () => {
    const docker = compileTrustProxy('172.16.0.0/12');
    expect(clientIp(docker, '172.18.0.1', '203.0.113.7')).toBe('203.0.113.7');
    expect(clientIp(docker, '192.168.1.20', '10.0.0.1')).toBe('192.168.1.20');
    // Sans cette configuration, la passerelle serait prise pour le client.
    expect(clientIp(loopbackOnly, '172.18.0.1', '203.0.113.7')).toBe('172.18.0.1');
  });

  it('ignore un en-tête absent ou illisible', () => {
    expect(clientIp(loopbackOnly, '127.0.0.1', undefined)).toBe('127.0.0.1');
    expect(clientIp(loopbackOnly, '127.0.0.1', 'n-importe-quoi')).toBe('127.0.0.1');
  });

  it('TRUST_PROXY : valeur par défaut « loopback », liste acceptée, valeur invalide refusée', () => {
    expect(loadConfig({}).trustProxy).toBe('loopback');
    expect(loadConfig({ TRUST_PROXY: '172.16.0.0/12, 10.0.0.1' }).trustProxy).toBe('172.16.0.0/12, 10.0.0.1');
    expect(() => loadConfig({ TRUST_PROXY: 'n-importe-quoi' })).toThrow(/TRUST_PROXY/);
    expect(() => compileTrustProxy(' , ')).toThrow();
  });
});

// --- Ralentissement des codes inconnus (unitaire) --------------------------------

describe('Ralentissement des codes inconnus', () => {
  const WINDOW = 10 * 60_000;
  let clock: number;

  function throttle(options: Partial<typeof JOIN_THROTTLE_DEFAULTS> = {}): JoinThrottle {
    return new JoinThrottle({
      ...JOIN_THROTTLE_DEFAULTS,
      freeCodes: 3,
      windowMs: WINDOW,
      intervalMs: 2_000,
      maxWaitMs: 5_000,
      now: () => clock,
      ...options,
    });
  }

  beforeAll(() => {
    clock = 1_000_000;
  });

  it('un même code répété n’est jamais ralenti', () => {
    const t = throttle();
    for (let i = 0; i < 1000; i++) expect(t.reserve('a', 'ABCD')).toEqual({ wait: 0 });
  });

  it('les premiers codes différents sont immédiats, puis un créneau par intervalle', () => {
    const t = throttle();
    expect(t.reserve('a', 'AAAA')).toEqual({ wait: 0 });
    expect(t.reserve('a', 'BBBB')).toEqual({ wait: 0 });
    expect(t.reserve('a', 'CCCC')).toEqual({ wait: 0 });
    // Connexions parallèles : les créneaux se suivent, sans jamais se doubler.
    expect(t.reserve('a', 'DDDD')).toEqual({ wait: 0 });
    expect(t.reserve('a', 'EEEE')).toEqual({ wait: 2_000 });
    expect(t.reserve('a', 'FFFF')).toEqual({ wait: 4_000 });
  });

  it('refuse sans attendre quand l’attente dépasse le maximum', () => {
    const t = throttle();
    for (const c of ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE', 'FFFF']) t.reserve('a', c);
    expect(t.reserve('a', 'GGGG')).toEqual({ refused: true });
  });

  it('une adresse n’en ralentit pas une autre', () => {
    const t = throttle();
    for (const c of ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE']) t.reserve('a', c);
    expect(t.reserve('b', 'AAAA')).toEqual({ wait: 0 });
  });

  it('la franchise revient à la fenêtre suivante', () => {
    const t = throttle();
    for (const c of ['AAAA', 'BBBB', 'CCCC', 'DDDD']) t.reserve('a', c);
    clock += WINDOW;
    expect(t.reserve('a', 'EEEE')).toEqual({ wait: 0 });
  });

  it('reste borné en mémoire quand beaucoup d’adresses essaient', () => {
    const t = throttle({ maxKeys: 50 });
    for (let i = 0; i < 500; i++) t.reserve(`ip-${i}`, 'AAAA');
    expect(t.trackedKeys).toBeLessThanOrEqual(50);
  });
});

// --- Tests d'intégration : vraies connexions Socket.IO ----------------------------

let server: PartyServer;
let base: string;
let dataDir: string;
const clients: Socket<ClientToServerEvents, ServerToClientEvents>[] = [];
type Client = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Code de test « i » : quatre caractères de l'alphabet officiel. */
function codeAt(i: number): string {
  const n = ROOM_CODE_ALPHABET.length;
  let rest = i;
  let code = '';
  for (let k = 0; k < 4; k++) {
    code += ROOM_CODE_ALPHABET[rest % n];
    rest = Math.floor(rest / n);
  }
  return code;
}

function connectFrom(ip: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = ioClient(base, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { 'x-forwarded-for': ip },
    });
    clients.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

let nameSeq = 0;

/** Une connexion par tentative, comme un téléphone qui retape son code. Chaque pseudo est unique. */
async function tryJoin(ip: string, code: string): Promise<any> {
  const socket = await connectFrom(ip);
  const letters = String.fromCharCode(97 + (nameSeq % 26)) + String.fromCharCode(97 + Math.floor(nameSeq / 26) % 26);
  nameSeq++;
  const ack = await new Promise<any>((resolve) => {
    (socket as any).emit('player:join', { code, name: `Test${letters}` }, (res: unknown) => resolve(res));
  });
  socket.disconnect();
  return ack;
}

const THROTTLE = { freeCodes: 3, intervalMs: 200, maxWaitMs: 500, windowMs: 60_000 };

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'ph-join-protection-'));
  const config: AppConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    dbFile: ':memory:',
    staticDir: '/nonexistent',
    adminPassword: 'join-protection-password',
    logLevel: 'silent',
    secureCookies: false,
  };
  server = await createServer({
    config,
    logger: createLogger('silent', true),
    sweepEveryMs: 0,
    joinThrottle: THROTTLE,
  });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Codes de salle, en conditions réelles', () => {
  let roomCode: string;
  let unknown: string[];

  beforeAll(async () => {
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'sudoku', practice: false }),
    });
    roomCode = ((await res.json()) as { code: string }).code;
    unknown = [];
    for (let i = 0; unknown.length < 60; i++) {
      const code = codeAt(i);
      if (code !== roomCode) unknown.push(code);
    }
  });

  it('un téléphone qui retape le même mauvais code n’est jamais ralenti', async () => {
    const started = Date.now();
    for (let i = 0; i < 30; i++) {
      const ack = await tryJoin('203.0.113.10', unknown[0]!);
      expect(ack.error).toMatch(/inconnu/);
    }
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('au-delà de la franchise, les codes inconnus se suivent à un rythme fixe', async () => {
    const ip = '203.0.113.20';
    // Trois codes gratuits, puis un premier code au-delà, immédiat par construction.
    for (let i = 0; i < 4; i++) await tryJoin(ip, unknown[i]!);
    // Le suivant attend son créneau (200 ms dans ce test).
    const started = Date.now();
    const ack = await tryJoin(ip, unknown[4]!);
    expect(ack.error).toMatch(/inconnu/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it('une adresse ralentie peut toujours rejoindre la salle avec le bon code, sans attendre', async () => {
    const ip = '203.0.113.20';
    const started = Date.now();
    const ack = await tryJoin(ip, roomCode);
    expect(ack.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(150);
  });

  it('une rafale de tentatives parallèles est bornée : les plus lentes sont refusées', async () => {
    const ip = '203.0.113.30';
    for (let i = 0; i < 3; i++) await tryJoin(ip, unknown[10 + i]!);
    const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => tryJoin(ip, unknown[20 + i]!)));
    const refused = burst.filter((ack) => /Trop de codes/.test(ack.error ?? ''));
    expect(refused.length).toBeGreaterThan(0);
    expect(burst.every((ack) => ack.ok === false)).toBe(true);
  });

  it('une autre adresse n’est pas concernée', async () => {
    const ack = await tryJoin('203.0.113.40', roomCode);
    expect(ack.ok).toBe(true);
    expect(typeof ack.playerId).toBe('string');
  });
});
