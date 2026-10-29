import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { z } from 'zod';
import {
  PLATEAU_TEST_ID,
  THEME_IDS,
  formeContient,
  themeDePlateau,
  type ClientToServerEvents,
  type EtatGrille,
  type GameModule,
  type HostRoomView,
  type ServerToClientEvents,
  type ThemeId,
} from '@partyhub/shared';
import { Room, type RoomEnv } from '../rooms/room.js';
import { createServer, type PartyServer } from '../server.js';
import { createLogger } from '../logger.js';
import type { AppConfig } from '../config.js';

/**
 * Plateau en grille d'une salle : départ des joueurs, jeux sans plateau, placement, schéma des gestes, et
 * branche « partie commencée ». Les règles de la grille sont dans shared ; ici, la salle et le hub.
 */

// ---------------------------------------------------------------------------
// Salle seule (sans réseau), sur le modèle de room-pause.test.ts
// ---------------------------------------------------------------------------

interface FauxEtat {
  phase: 'lobby' | 'playing';
}

function makeModule(id: string): GameModule<FauxEtat> {
  return {
    manifest: {
      id,
      category: 'role',
      name: 'Faux plateau',
      description: '',
      icon: 'x',
      version: '1.0.0',
      apiVersion: 1,
      minPlayers: 1,
      maxPlayers: 8,
      durationMin: 1,
      notice: { goal: '', steps: [], tips: [] },
    },
    settingsSchema: z.object({}),
    defaultSettings: {},
    actions: {},
    initialize: () => ({ phase: 'lobby' }),
    onPlayerJoin: (s) => s,
    onPlayerLeave: (s) => s,
    // Contrairement au vrai plateau de test, ce module se lance : il atteint la branche « partie commencée ».
    start: (s) => ({ ok: true, state: { ...s, phase: 'playing' } }),
    handleAction: (s) => ({ ok: true, state: s }),
    onTimer: (s) => s,
    nextRound: (s) => s,
    calculateScores: () => [],
    end: (s) => s,
    getPublicState: (s) => ({ ...s }),
    getPlayerState: () => null,
    getHostState: (s) => ({ ...s }),
    isFinished: () => false,
  };
}

function setupRoom(theme?: ThemeId) {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const env: RoomEnv = {
    now: () => Date.now(),
    random: () => 0.5,
    logger: logger as unknown as RoomEnv['logger'],
    maxPlayers: () => 8,
    graceMs: () => 60_000,
    notice: () => ({ goal: '', steps: [], tips: [] }),
  };
  const hooks = { onChange: () => {}, onGameStarted: () => {}, onGameEnded: () => {} };
  const room = new Room('ABCDE', makeModule(PLATEAU_TEST_ID), env, hooks, { practice: false, theme });
  const rejoindre = (nom: string) => {
    const r = room.join(nom, undefined, `sock-${nom}`);
    if (!r.ok) throw new Error(r.error);
    return r.playerId;
  };
  const grille = (): EtatGrille => room.hostView().lobby.grille!;
  /** Remplace l'état de la grille pour poser une situation précise (l'état est privé à la salle). */
  const poser = (f: (e: EtatGrille) => EtatGrille) => {
    const priv = room as unknown as { grille: EtatGrille };
    priv.grille = f(priv.grille);
  };
  return { room, rejoindre, grille, poser };
}

describe('départ d’un joueur du plateau', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Alice porte une boîte posée juste à côté d'elle. */
  function aliceQuiPorte() {
    const ctx = setupRoom('arene');
    const alice = ctx.rejoindre('Alice');
    const bob = ctx.rejoindre('Bob');
    const { x, y } = ctx.grille().personnages[alice]!;
    // Une boîte à droite d'Alice, sur une case de sol vide.
    ctx.poser((e) => {
      const decor = e.decor.map((ligne, ly) => (ly === y ? ligne.slice(0, x + 1) + '.' + ligne.slice(x + 2) : ligne));
      const premiere = e.objets.findIndex((o) => o.nature === 'boite');
      const objets = e.objets
        .filter((o) => !(o.x === x + 1 && o.y === y))
        .map((o, i) => (i === premiere ? { ...o, x: x + 1, y } : o));
      return { ...e, decor, objets };
    });
    const boite = ctx.grille().objets.find((o) => o.x === x + 1 && o.y === y && o.nature === 'boite')!;
    expect(ctx.room.grilleAction(alice, { type: 'porter', dir: 'right' })).toMatchObject({ ok: true });
    expect(ctx.grille().objets.find((o) => o.id === boite.id)!.porte).toBe(alice);
    return { ...ctx, alice, bob, boite, depart: { x, y } };
  }

  it('player:leave retire le personnage et pose la boîte portée là où il était', () => {
    const { room, grille, alice, bob, boite, depart } = aliceQuiPorte();
    expect(room.leave(alice)).toEqual({ ok: true });
    expect(grille().personnages[alice]).toBeUndefined();
    expect(grille().personnages[bob]).toBeDefined();
    const posee = grille().objets.find((o) => o.id === boite.id)!;
    expect(posee.porte).toBeNull();
    expect({ x: posee.x, y: posee.y }).toEqual(depart);
  });

  it('host:kick retire aussi le personnage et pose la boîte portée', () => {
    const { room, grille, alice, boite } = aliceQuiPorte();
    expect(room.kick(alice)).toMatchObject({ ok: true });
    expect(grille().personnages[alice]).toBeUndefined();
    expect(grille().objets.find((o) => o.id === boite.id)!.porte).toBeNull();
  });

  it('une simple déconnexion garde le personnage et la boîte portée, le joueur est seulement hors ligne', () => {
    const { room, grille, alice, boite } = aliceQuiPorte();
    room.removeSocket('sock-Alice');
    const joueur = room.hostView().lobby.players.find((p) => p.id === alice)!;
    expect(joueur.connected).toBe(false);
    expect(grille().personnages[alice]).toBeDefined();
    expect(grille().objets.find((o) => o.id === boite.id)!.porte).toBe(alice);
  });

  it('un robot ajouté a son personnage, retiré il disparaît', () => {
    const { room, grille } = setupRoom();
    expect(room.addBot()).toEqual({ ok: true });
    const bot = room.hostView().lobby.players.find((p) => p.bot)!;
    expect(grille().personnages[bot.id]).toBeDefined();
    expect(room.removeBot(bot.id)).toEqual({ ok: true });
    expect(Object.keys(grille().personnages)).toHaveLength(0);
  });
});

describe('placement des joueurs', () => {
  it('trois joueurs ont des cases distinctes, et A ne marche pas sur B', () => {
    const { room, rejoindre, grille, poser } = setupRoom('arene');
    const [a, b, c] = ['Ana', 'Ben', 'Cléo'].map(rejoindre) as [string, string, string];
    const cases = [a, b, c].map((id) => `${grille().personnages[id]!.x},${grille().personnages[id]!.y}`);
    expect(new Set(cases).size).toBe(3);

    // B se place juste à droite de A, sur du sol : A, qui marche vers lui, ne bouge pas mais se tourne.
    const pa = grille().personnages[a]!;
    poser((e) => ({
      ...e,
      decor: e.decor.map((l, y) => (y === pa.y ? l.slice(0, pa.x + 1) + '.' + l.slice(pa.x + 2) : l)),
      objets: e.objets.filter((o) => !(o.x === pa.x + 1 && o.y === pa.y)),
      personnages: { ...e.personnages, [b]: { ...e.personnages[b]!, x: pa.x + 1, y: pa.y } },
    }));
    expect(room.grilleAction(a, { type: 'marcher', dir: 'right' })).toMatchObject({ ok: true });
    expect(grille().personnages[a]).toMatchObject({ x: pa.x, y: pa.y, dir: 'right' });
    expect(grille().personnages[b]).toMatchObject({ x: pa.x + 1, y: pa.y });
    // Sauter par-dessus B depuis A n'atterrit pas sur lui non plus.
    expect(room.grilleAction(a, { type: 'sauter', dir: 'right' })).toMatchObject({ ok: true });
    const apres = Object.values(grille().personnages).map((p) => `${p.x},${p.y}`);
    expect(new Set(apres).size).toBe(3);
  });

  it.each(THEME_IDS)('huit joueurs sont tous posés sur du sol libre, une case chacun (%s)', (theme) => {
    const { rejoindre, grille } = setupRoom(theme);
    const ids = Array.from({ length: 8 }, (_, i) => rejoindre(`J${i + 1}`));
    const persos = ids.map((id) => grille().personnages[id]);
    expect(persos.every((p) => p !== undefined)).toBe(true);
    const cases = new Set(persos.map((p) => `${p!.x},${p!.y}`));
    expect(cases.size).toBe(8);
    const forme = themeDePlateau(theme).forme;
    for (const p of persos) {
      expect(grille().decor[p!.y]![p!.x]).toBe('.');
      expect(formeContient(forme, grille().largeur, grille().hauteur, p!.x, p!.y)).toBe(true);
      expect(grille().objets.some((o) => o.porte === null && o.x === p!.x && o.y === p!.y)).toBe(false);
    }
  });
});

describe('plateau et partie commencée', () => {
  it('une fois la partie lancée, un geste est refusé : le plateau ne sert qu’avant la partie', () => {
    const { room, rejoindre, grille } = setupRoom();
    const id = rejoindre('Alice');
    expect(room.grilleAction(id, { type: 'saluer' })).toMatchObject({ ok: true });
    const seq = grille().seq;
    // Ce faux module (d'identifiant PLATEAU_TEST_ID) se lance, ce que le vrai plateau de test refuse.
    expect(room.start()).toEqual({ ok: true });
    expect(room.inLobby).toBe(false);
    const refus = room.grilleAction(id, { type: 'saluer' });
    expect(refus).toMatchObject({ ok: false });
    expect(refus.ok ? '' : refus.error).toMatch(/avant la partie/);
    expect(room.hostView().lobby.grille?.seq).toBe(seq);
  });

  it('un joueur inconnu est refusé avant tout', () => {
    const { room } = setupRoom();
    const refus = room.grilleAction('inconnu', { type: 'saluer' });
    expect(refus.ok).toBe(false);
    expect(refus.ok ? '' : refus.error).toMatch(/Joueur inconnu/);
  });
});

// ---------------------------------------------------------------------------
// Par le hub (sockets)
// ---------------------------------------------------------------------------

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

interface Ack {
  ok: boolean;
  error?: string;
  playerId?: string;
}

function call(socket: Client, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve) => {
    (socket as unknown as { emit: (...a: unknown[]) => void }).emit(event, ...args, (res: Ack) => resolve(res));
  });
}

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

async function creerSalle(body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ practice: false, ...body }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { code: string; hostToken: string };
}

describe('plateau par le hub', () => {
  it('un jeu sans plateau (réflexe), même avec un décor demandé : pas de grille, le geste répond qu’il n’y en a pas', async () => {
    const { code, hostToken } = await creerSalle({ gameId: 'reflexe', theme: 'arene' });
    const host = await connect();
    const views = track<HostRoomView>(host, 'room:host');
    expect((await call(host, 'host:connect', { code, hostToken })).ok).toBe(true);
    const joueur = await connect();
    expect((await call(joueur, 'player:join', { code, name: 'Lou' })).ok).toBe(true);
    const vue = await until(views, (v) => v.lobby.players.length === 1);
    expect(vue.lobby.grille).toBeNull();
    const refus = await call(joueur, 'player:grille', { type: 'saluer' });
    expect(refus.ok).toBe(false);
    expect(refus.error).toMatch(/n’a pas de plateau/);
  });

  it('un socket qui n’est dans aucune salle est refusé, geste valide ou non', async () => {
    const seul = await connect();
    const valide = await call(seul, 'player:grille', { type: 'saluer' });
    expect(valide.ok).toBe(false);
    expect(valide.error).toMatch(/pas dans une salle/);
    const invalide = await call(seul, 'player:grille', { type: 'voler' });
    expect(invalide.ok).toBe(false);
    expect(invalide.error).toMatch(/pas dans une salle/);
  });

  it('le schéma refuse un geste sans direction, un salut avec direction, et null', async () => {
    const { code, hostToken } = await creerSalle({ gameId: PLATEAU_TEST_ID });
    const host = await connect();
    const views = track<HostRoomView>(host, 'room:host');
    await call(host, 'host:connect', { code, hostToken });
    const joueur = await connect();
    const joined = await call(joueur, 'player:join', { code, name: 'Max' });
    const id = joined.playerId!;
    const vue = await until(views, (v) => v.lobby.grille?.personnages[id] !== undefined);
    const seq = vue.lobby.grille!.seq;

    for (const mauvais of [
      { type: 'marcher' },
      { type: 'saluer', dir: 'up' },
      { type: 'marcher', dir: 'haut' },
      null,
    ]) {
      const res = await call(joueur, 'player:grille', mauvais);
      expect(res.ok, JSON.stringify(mauvais)).toBe(false);
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(Math.max(...views.map((v) => v.lobby.grille?.seq ?? -1))).toBe(seq);
  });

  it('trois joueurs par sockets : cases distinctes, et chacun voit la grille complète', async () => {
    const { code, hostToken } = await creerSalle({ gameId: PLATEAU_TEST_ID, theme: 'tennis' });
    const host = await connect();
    const views = track<HostRoomView>(host, 'room:host');
    await call(host, 'host:connect', { code, hostToken });
    const ids: string[] = [];
    for (const nom of ['Ana', 'Ben', 'Cléo']) {
      const s = await connect();
      const r = await call(s, 'player:join', { code, name: nom });
      expect(r.ok).toBe(true);
      ids.push(r.playerId!);
    }
    const vue = await until(views, (v) => ids.every((id) => v.lobby.grille?.personnages[id] !== undefined));
    const cases = ids.map((id) => `${vue.lobby.grille!.personnages[id]!.x},${vue.lobby.grille!.personnages[id]!.y}`);
    expect(new Set(cases).size).toBe(3);
    expect(vue.lobby.grille!.theme).toBe('tennis');
  });
});
