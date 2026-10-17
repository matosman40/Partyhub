import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { GameModule, LobbyView } from '@partyhub/shared';
import { Room, type RoomEnv } from '../rooms/room.js';

/**
 * Championnat d'un salon, vu depuis la salle : réglage avant la partie, manches qui s'enchaînent,
 * podium de chaque partie, équipes stables, et remise à zéro quand le championnat est terminé.
 */

interface FakeState {
  phase: 'lobby' | 'playing' | 'finished';
  names: Record<string, string>;
  points: Record<string, number>;
}

const fake: GameModule<FakeState> = {
  manifest: {
    id: 'fake-series',
    category: 'party',
    name: 'Faux championnat',
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
  actions: {
    score: z.object({ points: z.number().int().min(0).max(100) }),
    finish: z.object({}),
  },
  initialize: (_settings, players) => ({
    phase: 'lobby',
    names: Object.fromEntries(players.map((p) => [p.id, p.name])),
    points: {},
  }),
  onPlayerJoin: (s, player) => ({ ...s, names: { ...s.names, [player.id]: player.name } }),
  onPlayerLeave: (s, player) => {
    const names = { ...s.names };
    const points = { ...s.points };
    delete names[player.id];
    delete points[player.id];
    return { ...s, names, points };
  },
  start: (s) => ({ ok: true, state: { ...s, phase: 'playing', points: {} } }),
  handleAction: (s, player, type, payload) => {
    if (type === 'finish') return { ok: true, state: { ...s, phase: 'finished' } };
    const { points } = payload as { points: number };
    return { ok: true, state: { ...s, points: { ...s.points, [player.id]: points } } };
  },
  onTimer: (s) => s,
  nextRound: (s) => s,
  calculateScores: (s) => {
    const entries = Object.keys(s.names).map((id) => ({
      playerId: id,
      name: s.names[id]!,
      points: s.points[id] ?? 0,
    }));
    return entries.map((e) => ({ ...e, rank: 1 + entries.filter((o) => o.points > e.points).length }));
  },
  end: (s) => ({ ...s, phase: 'finished' }),
  getPublicState: (s) => ({ phase: s.phase }),
  getPlayerState: () => null,
  getHostState: (s) => ({ ...s }),
  isFinished: (s) => s.phase === 'finished',
};

function setup(): Room {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const env: RoomEnv = {
    now: () => Date.now(),
    random: () => 0.5,
    logger: logger as unknown as RoomEnv['logger'],
    maxPlayers: () => 8,
    graceMs: () => 60_000,
    notice: () => ({ goal: '', steps: [], tips: [] }),
  };
  return new Room('ABCDE', fake, env, { onChange: () => {}, onGameStarted: () => {}, onGameEnded: () => {} });
}

let commandNo = 0;

function join(room: Room, name: string): string {
  const res = room.join(name, undefined, `sock-${name}`);
  if (!res.ok) throw new Error(res.error);
  return res.playerId;
}

function lobbyOf(room: Room): LobbyView {
  return room.hostView().lobby;
}

/** Une manche : chacun marque ses points, puis la partie se termine. */
function playGame(room: Room, points: Record<string, number>): void {
  for (const [playerId, value] of Object.entries(points)) {
    const res = room.handleAction(playerId, `cmd-${commandNo++}`, 'score', { points: value });
    expect(res.ok).toBe(true);
  }
  const [anyId] = Object.keys(points);
  const done = room.handleAction(anyId!, `cmd-${commandNo++}`, 'finish', {});
  expect(done.ok).toBe(true);
}

describe('championnat du salon', () => {
  it('se règle avant la partie seulement', () => {
    const room = setup();
    join(room, 'Ana');
    join(room, 'Bruno');
    expect(room.setChampionship({ length: 3, teams: 0 }).ok).toBe(true);
    expect(lobbyOf(room).championship).toEqual({ length: 3, teams: 0 });

    expect(room.start().ok).toBe(true);
    const refused = room.setChampionship({ length: 2, teams: 0 });
    expect(refused.ok).toBe(false);
    expect(lobbyOf(room).championship).toEqual({ length: 3, teams: 0 });
  });

  it('enchaîne deux manches, donne le titre à la fin, puis ouvre un nouveau championnat', () => {
    const room = setup();
    const ana = join(room, 'Ana');
    const bruno = join(room, 'Bruno');
    const chloe = join(room, 'Chloé');
    room.setChampionship({ length: 2, teams: 0 });

    // Manche 1 : Ana 1re (10 pts), Bruno 2e (6), Chloé 3e (4).
    room.start();
    playGame(room, { [ana]: 9, [bruno]: 7, [chloe]: 5 });
    let lobby = lobbyOf(room);
    expect(lobby.status).toBe('ended');
    expect(lobby.lastResult?.game).toBe('Faux championnat');
    expect(lobby.lastResult?.ranking.map((r) => [r.name, r.rank])).toEqual([
      ['Ana', 1],
      ['Bruno', 2],
      ['Chloé', 3],
    ]);
    expect(lobby.series?.played).toBe(1);
    expect(lobby.series?.finished).toBe(false);
    expect(lobby.series?.champion).toBeNull();

    // Rejouer : la série continue (pas encore terminée).
    expect(room.replay().ok).toBe(true);
    lobby = lobbyOf(room);
    expect(lobby.series?.played).toBe(1);

    // Manche 2 : Bruno 1er (+10 → 16), Chloé 2e (+6 → 10), Ana 3e (+4 → 14).
    room.start();
    playGame(room, { [ana]: 0, [bruno]: 20, [chloe]: 5 });
    lobby = lobbyOf(room);
    expect(lobby.series?.finished).toBe(true);
    expect(lobby.series?.standings.map((r) => [r.name, r.points, r.rank])).toEqual([
      ['Bruno', 16, 1],
      ['Ana', 14, 2],
      ['Chloé', 10, 3],
    ]);
    expect(lobby.series?.champion).toEqual({ names: ['Bruno'], team: null });
    expect(lobby.series?.standings[0]?.tier.label).toBe('Habitué');

    // Rejouer après le titre : nouveau championnat, classements vides.
    expect(room.replay().ok).toBe(true);
    lobby = lobbyOf(room);
    expect(lobby.series?.played).toBe(0);
    expect(lobby.series?.finished).toBe(false);
    expect(lobby.series?.standings).toEqual([]);
    expect(lobby.series?.champion).toBeNull();
    // Le dernier podium reste affiché tant qu'une nouvelle partie n'est pas terminée.
    expect(lobby.lastResult?.ranking.length).toBe(3);
  });

  it('garde la progression si le réglage ne change pas, la remet à zéro sinon', () => {
    const room = setup();
    const ana = join(room, 'Ana');
    join(room, 'Bruno');
    room.setChampionship({ length: 3, teams: 0 });
    room.start();
    playGame(room, { [ana]: 5, [room.hostView().lobby.players[1]!.id]: 1 });
    room.replay();

    expect(room.setChampionship({ length: 3, teams: 0 }).ok).toBe(true);
    expect(lobbyOf(room).series?.played).toBe(1);

    expect(room.setChampionship({ length: 2, teams: 0 }).ok).toBe(true);
    expect(lobbyOf(room).series?.played).toBe(0);
  });

  it('répartit les joueurs en équipes équilibrées, puis classe les équipes', () => {
    const room = setup();
    const ana = join(room, 'Ana');
    const bruno = join(room, 'Bruno');
    const chloe = join(room, 'Chloé');
    const dan = join(room, 'Dan');
    room.setChampionship({ length: 2, teams: 2 });

    const teamOf = (name: string) => lobbyOf(room).players.find((p) => p.name === name)?.team;
    expect([teamOf('Ana'), teamOf('Bruno'), teamOf('Chloé'), teamOf('Dan')]).toEqual([0, 1, 0, 1]);

    // Manche 1 : Rouge (Ana, Chloé) 10 + 4 = 14 ; Bleue (Bruno, Dan) 6 + 3 = 9.
    room.start();
    playGame(room, { [ana]: 9, [bruno]: 7, [chloe]: 5, [dan]: 1 });
    let lobby = lobbyOf(room);
    expect(lobby.series?.teams?.map((t) => [t.name, t.points, t.rank])).toEqual([
      ['Rouge', 14, 1],
      ['Bleue', 9, 2],
    ]);

    // Rejouer : chacun garde son équipe.
    room.replay();
    expect([teamOf('Ana'), teamOf('Bruno'), teamOf('Chloé'), teamOf('Dan')]).toEqual([0, 1, 0, 1]);

    // Manche 2 : Ana 14, Chloé 7 (Rouge : 21) ; Bruno 16, Dan 9 (Bleue : 25) → Bleue remporte le titre.
    room.start();
    playGame(room, { [bruno]: 9, [dan]: 7, [ana]: 1, [chloe]: 0 });
    lobby = lobbyOf(room);
    expect(lobby.series?.finished).toBe(true);
    expect(lobby.series?.champion).toEqual({ names: ['Bleue'], team: 1 });
    expect(lobby.lastResult?.game).toBe('Faux championnat');

    const playerView = room.playerView(ana);
    expect(playerView?.lobby.players.find((p) => p.id === ana)?.team).toBe(0);
    expect(playerView?.lobby.series?.played).toBe(2);
  });

  it('un nouveau joueur rejoint l’équipe la moins fournie, et un départ rééquilibre', () => {
    const room = setup();
    join(room, 'Ana');
    const bruno = join(room, 'Bruno');
    join(room, 'Chloé');
    room.setChampionship({ length: 1, teams: 2 });
    const teamOf = (name: string) => lobbyOf(room).players.find((p) => p.name === name)?.team;
    expect([teamOf('Ana'), teamOf('Bruno'), teamOf('Chloé')]).toEqual([0, 1, 0]);

    join(room, 'Dan'); // Équipes : 2 contre 1, Dan va dans la plus petite.
    expect(teamOf('Dan')).toBe(1);

    room.leave(bruno); // Bruno part : Ana et Chloé restent Rouge, Dan reste Bleue.
    expect(lobbyOf(room).players.some((p) => p.name === 'Bruno')).toBe(false);
    expect(teamOf('Ana')).toBe(0);
    expect(teamOf('Chloé')).toBe(0);

    join(room, 'Eve'); // Rouge a 2 membres, Bleue 1 : Eve va dans Bleue.
    expect(teamOf('Eve')).toBe(1);
  });

  it('ne donne pas d’équipes quand le salon n’en a pas', () => {
    const room = setup();
    join(room, 'Ana');
    join(room, 'Bruno');
    const lobby = lobbyOf(room);
    expect(lobby.championship).toEqual({ length: 1, teams: 0 });
    expect(lobby.series?.teams).toBeNull();
    expect(lobby.players.every((p) => p.team === null)).toBe(true);
  });
});
