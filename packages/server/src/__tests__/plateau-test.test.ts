import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { CatalogGame, ClientToServerEvents, HostRoomView, ServerToClientEvents } from '@partyhub/shared';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: PartyServer;
let base: string;
const clients: Client[] = [];

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
  for (const c of clients) c.disconnect();
  await server.close();
});

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket: Client = ioClient(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

// Le retour de chaque appel est typé selon ce que le test attend, sans `any`.
interface Ack {
  ok: boolean;
  error?: string;
  playerId?: string;
  token?: string;
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: Ack) => resolve(res));
  });
}

/** Garde l'historique des vues reçues, pour ne pas manquer un événement déjà passé. */
function track<T>(socket: Client, event: string): T[] {
  const list: T[] = [];
  (socket as unknown as { on: (e: string, cb: (v: T) => void) => void }).on(event, (v: T) => list.push(v));
  return list;
}

async function until<T>(list: T[], predicate: (v: T) => boolean, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const found = [...list].reverse().find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Condition non atteinte à temps');
}

async function createPlateau(extra: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'plateau-test', practice: false, ...extra }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { code: string; hostToken: string };
}

describe('Plateau de test', () => {
  it('n’apparaît pas au catalogue public', async () => {
    const res = await fetch(`${base}/api/catalog`);
    const body = (await res.json()) as { games: CatalogGame[] };
    expect(body.games.some((g) => g.id === 'plateau-test')).toBe(false);
    // Les jeux réels restent listés.
    expect(body.games.some((g) => g.id === 'reflexe')).toBe(true);
  });

  it('ouvre une salle, où le lancement est refusé (aucune partie)', async () => {
    const { code, hostToken } = await createPlateau();
    const host = await connect();
    const views = track<HostRoomView>(host, 'room:host');
    expect((await call(host, 'host:connect', { code, hostToken })).ok).toBe(true);
    const view = await until(views, (v) => v.lobby.game.id === 'plateau-test');
    expect(view.lobby.game.name).toBe('Plateau de test');

    // Avec un joueur présent, la vérification du nombre passe : c'est le plateau qui refuse.
    const player = await connect();
    expect((await call(player, 'player:join', { code, name: 'Test' })).ok).toBe(true);
    const start = await call(host, 'host:start');
    expect(start.ok).toBe(false);
    expect(start.error).toMatch(/ne se lance pas/);
    host.disconnect();
    player.disconnect();
  });

  it('un joueur marche, salue, et un geste refusé le dit sans toucher au compteur', async () => {
    const { code, hostToken } = await createPlateau();
    const host = await connect();
    const views = track<HostRoomView>(host, 'room:host');
    await call(host, 'host:connect', { code, hostToken });

    const player = await connect();
    const joined = await call(player, 'player:join', { code, name: 'Max' });
    expect(joined.ok).toBe(true);
    const id = joined.playerId as string;

    const debut = await until(views, (v) => v.lobby.grille?.personnages[id] !== undefined);
    const depart = debut.lobby.grille!.personnages[id]!;
    const seqDebut = debut.lobby.grille!.seq;

    // Marcher : le départ est déterministe et la case à droite est libre, on avance d’une case.
    const marche = await call(player, 'player:grille', { type: 'marcher', dir: 'right' });
    expect(marche.ok).toBe(true);
    const apresMarche = await until(views, (v) => (v.lobby.grille?.seq ?? -1) === seqDebut + 1);
    const pos = apresMarche.lobby.grille!.personnages[id]!;
    expect(pos.dir).toBe('right');
    expect(pos.x).toBe(depart.x + 1);
    expect(pos.y).toBe(depart.y);

    // Saluer : le geste est partagé à la salle, avec son auteur.
    const salut = await call(player, 'player:grille', { type: 'saluer' });
    expect(salut.ok).toBe(true);
    const apresSalut = await until(views, (v) => v.lobby.grille?.dernier?.geste === 'salut');
    expect(apresSalut.lobby.grille!.dernier!.joueur).toBe(id);

    // Pousser sans rien devant : refusé avec la raison, et l’état ne bouge pas.
    const seqAvant = apresSalut.lobby.grille!.seq;
    const refus = await call(player, 'player:grille', { type: 'pousser', dir: 'up' });
    expect(refus.ok).toBe(false);
    expect(refus.error).toMatch(/Rien à pousser/);
    await new Promise((r) => setTimeout(r, 150));
    expect(Math.max(...views.map((v) => v.lobby.grille?.seq ?? -1))).toBe(seqAvant);

    // Le geste suivant est le premier à faire avancer le compteur : le refus n’en a consommé aucun.
    expect((await call(player, 'player:grille', { type: 'saluer' })).ok).toBe(true);
    const apresRefus = await until(views, (v) => (v.lobby.grille?.seq ?? -1) > seqAvant);
    expect(apresRefus.lobby.grille!.seq).toBe(seqAvant + 1);

    // Une action inconnue est rejetée par le schéma.
    const invalide = await call(player, 'player:grille', { type: 'voler' });
    expect(invalide.ok).toBe(false);

    host.disconnect();
    player.disconnect();
  });
});

describe('Décor du plateau', () => {
  it('la salle prend le décor demandé, et le décor par défaut sinon', async () => {
    const choisi = await createPlateau({ theme: 'arene' });
    const defaut = await createPlateau();
    const hostChoisi = await connect();
    const hostDefaut = await connect();
    const viewsChoisi = track<HostRoomView>(hostChoisi, 'room:host');
    const viewsDefaut = track<HostRoomView>(hostDefaut, 'room:host');
    expect((await call(hostChoisi, 'host:connect', { code: choisi.code, hostToken: choisi.hostToken })).ok).toBe(true);
    expect((await call(hostDefaut, 'host:connect', { code: defaut.code, hostToken: defaut.hostToken })).ok).toBe(true);
    const vChoisi = await until(viewsChoisi, (v) => v.lobby.grille !== null);
    const vDefaut = await until(viewsDefaut, (v) => v.lobby.grille !== null);
    expect(vChoisi.lobby.grille!.theme).toBe('arene');
    expect(vDefaut.lobby.grille!.theme).toBe('fete');
    hostChoisi.disconnect();
    hostDefaut.disconnect();
  });

  it('un décor inconnu est refusé à la création', async () => {
    const res = await fetch(`${base}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'plateau-test', practice: false, theme: 'volcan' }),
    });
    expect(res.status).toBe(400);
  });
});
