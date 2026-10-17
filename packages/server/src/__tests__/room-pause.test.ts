import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { GameModule } from '@partyhub/shared';
import { Room, type RoomEnv } from '../rooms/room.js';

/**
 * Pause de l'écran principal : l'horloge de la partie s'arrête. Les minuteurs du jeu reprennent avec le temps
 * qui leur restait, les décomptes publiés sont figés, et les actions des joueurs sont refusées.
 */

interface PauseState {
  phase: 'lobby' | 'playing' | 'finished';
  ticks: string[];
  moves: number;
}

const TICK_MS = 5000;

function makeModule(): GameModule<PauseState> {
  return {
    manifest: {
      id: 'fake-pause',
      category: 'role',
      name: 'Faux jeu à minuteur',
      description: '',
      icon: 'x',
      version: '1.0.0',
      apiVersion: 1,
      minPlayers: 1,
      maxPlayers: 4,
      durationMin: 1,
      notice: { goal: '', steps: [], tips: [] },
    },
    settingsSchema: z.object({}),
    defaultSettings: {},
    actions: { move: z.object({}) },
    initialize: () => ({ phase: 'lobby', ticks: [], moves: 0 }),
    onPlayerJoin: (s) => s,
    onPlayerLeave: (s) => s,
    start: (s, ctx) => {
      ctx.schedule('tick', TICK_MS);
      return { ok: true, state: { ...s, phase: 'playing' } };
    },
    handleAction: (s) => ({ ok: true, state: { ...s, moves: s.moves + 1 } }),
    onTimer: (s, key, ctx) => {
      ctx.schedule('tick', TICK_MS);
      return { ...s, ticks: [...s.ticks, key] };
    },
    nextRound: (s) => s,
    calculateScores: () => [],
    end: (s) => ({ ...s, phase: 'finished' }),
    getPublicState: (s) => ({ phase: s.phase, ticks: s.ticks.length, moves: s.moves }),
    getPlayerState: () => null,
    getHostState: (s) => ({ ...s }),
    isFinished: (s) => s.phase === 'finished',
  };
}

function setupRoom() {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const env: RoomEnv = {
    now: () => Date.now(),
    random: () => 0.5,
    logger: logger as unknown as RoomEnv['logger'],
    maxPlayers: () => 4,
    graceMs: () => 60_000,
    notice: () => ({ goal: '', steps: [], tips: [] }),
  };
  const hooks = { onChange: () => {}, onGameStarted: () => {}, onGameEnded: () => {} };
  const room = new Room('ABCDE', makeModule(), env, hooks);
  room.join('Alice', undefined, 'sock-1');
  const playerId = [...room.players.keys()][0]!;
  return { room, playerId };
}

describe('pause de la partie', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('suspend le minuteur du jeu, puis le reprend avec le temps qui lui restait', () => {
    const { room } = setupRoom();
    room.start();
    const ticks = () => (room.hostView().game?.public as { ticks: number }).ticks;

    vi.advanceTimersByTime(2000);
    expect(room.setPaused(true)).toEqual({ ok: true });
    vi.advanceTimersByTime(60_000);
    expect(ticks()).toBe(0);

    expect(room.setPaused(false)).toEqual({ ok: true });
    vi.advanceTimersByTime(TICK_MS - 2000 - 1);
    expect(ticks()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ticks()).toBe(1);
  });

  it('fige le décompte publié pendant la pause, et le fait repartir à la reprise', () => {
    const { room } = setupRoom();
    room.start();
    vi.advanceTimersByTime(1000);
    room.setPaused(true);
    const frozen = room.hostView().now;

    vi.advanceTimersByTime(30_000);
    expect(room.hostView().now).toBe(frozen);

    room.setPaused(false);
    vi.advanceTimersByTime(4000);
    expect(room.hostView().now - frozen).toBe(4000);
  });

  it('refuse les actions des joueurs et de l’hôte pendant la pause', () => {
    const { room, playerId } = setupRoom();
    room.start();
    room.setPaused(true);

    const refused = room.handleAction(playerId, 'cmd-1', 'move', {});
    expect(refused).toEqual({ ok: false, error: 'La partie est en pause.' });
    expect(room.hostAction('move', {})).toEqual({ ok: false, error: 'La partie est en pause.' });

    room.setPaused(false);
    expect(room.handleAction(playerId, 'cmd-2', 'move', {})).toEqual({ ok: true, duplicate: false });
  });

  it('se signale dans la vue de la salle', () => {
    const { room } = setupRoom();
    room.start();
    expect(room.hostView().lobby.paused).toBe(false);
    room.setPaused(true);
    expect(room.hostView().lobby.paused).toBe(true);
    expect(room.playerView(room.hostView().lobby.players[0]!.id)?.lobby.paused).toBe(true);
  });

  it('ne se met pas en pause hors partie, et ne fait rien si elle l’est déjà', () => {
    const { room } = setupRoom();
    expect(room.setPaused(true)).toEqual({ ok: false, error: 'Aucune partie en cours.' });
    room.start();
    expect(room.setPaused(true)).toEqual({ ok: true });
    expect(room.setPaused(true)).toEqual({ ok: true });
    expect(room.hostView().lobby.paused).toBe(true);
  });

  it('une partie terminée pendant la pause en lève la pause', () => {
    const { room } = setupRoom();
    room.start();
    room.setPaused(true);
    expect(room.end()).toEqual({ ok: true });
    expect(room.hostView().lobby.status).toBe('ended');
    expect(room.hostView().lobby.paused).toBe(false);
  });
});
