import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { GameModule } from '@partyhub/shared';
import { Room, type RoomEnv } from '../rooms/room.js';

/** Une mise à jour demandée suspend les nouvelles parties : la salle reste au salon, sans rien perdre. */

const MESSAGE = 'Une mise à jour est demandée : aucune nouvelle partie ne peut démarrer avant qu’elle soit faite.';

function makeModule(): GameModule<{ phase: string }> {
  return {
    manifest: {
      id: 'fake-gate',
      category: 'role',
      name: 'Faux jeu',
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
    initialize: () => ({ phase: 'lobby' }),
    onPlayerJoin: (s) => s,
    onPlayerLeave: (s) => s,
    start: (s) => ({ ok: true, state: { ...s, phase: 'playing' } }),
    handleAction: (s) => ({ ok: true, state: s }),
    onTimer: (s) => s,
    nextRound: (s) => s,
    calculateScores: () => [],
    end: (s) => ({ ...s, phase: 'finished' }),
    getPublicState: (s) => ({ phase: s.phase }),
    getPlayerState: () => null,
    getHostState: (s) => ({ ...s }),
    isFinished: (s) => s.phase === 'finished',
  };
}

describe('Mise à jour demandée : aucune partie ne démarre', () => {
  it('start() est refusé avec la raison, puis accepté quand le verrou est levé', () => {
    let blocked: string | null = MESSAGE;
    const env: RoomEnv = {
      now: () => Date.now(),
      random: () => 0.5,
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as RoomEnv['logger'],
      maxPlayers: () => 4,
      graceMs: () => 60_000,
      notice: () => ({ goal: '', steps: [], tips: [] }),
      startBlocked: () => blocked,
    };
    const hooks = { onChange: () => {}, onGameStarted: () => {}, onGameEnded: () => {} };
    const room = new Room('ABCDE', makeModule(), env, hooks);
    room.join('Alice', undefined, 'sock-1');

    expect(room.start()).toEqual({ ok: false, error: MESSAGE });
    expect(room.status).not.toBe('in_game');

    blocked = null;
    expect(room.start()).toEqual({ ok: true });
    expect(room.status).toBe('in_game');
  });
});
