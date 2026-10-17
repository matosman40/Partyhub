import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AiClient, GameJob, GameModule } from '@partyhub/shared';
import { Room, type RoomEnv } from '../rooms/room.js';

/**
 * Travaux asynchrones d'un jeu (ex. génération par IA) pilotés par la salle : un seul à la fois,
 * résultat intégré par `completeJob`, travail abandonné si la partie change de main.
 */

interface FakeState {
  phase: 'lobby' | 'playing' | 'finished';
  pending: boolean;
  jobNo: number;
  result: string | null;
}

type RunJob = NonNullable<GameModule<FakeState>['runJob']>;

function makeModule(runJob: RunJob): GameModule<FakeState> {
  return {
    manifest: {
      id: 'fake-job',
      category: 'role',
      name: 'Faux jeu à travaux',
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
    actions: {},
    initialize: () => ({ phase: 'lobby', pending: false, jobNo: 0, result: null }),
    onPlayerJoin: (s) => s,
    onPlayerLeave: (s) => s,
    start: (s) => ({ ok: true, state: { ...s, phase: 'playing', pending: true, jobNo: s.jobNo + 1 } }),
    handleAction: (s) => ({ ok: true, state: s }),
    onTimer: (s) => s,
    nextRound: (s) => s,
    calculateScores: () => [],
    end: (s) => ({ ...s, phase: 'finished', pending: false }),
    getPublicState: (s) => ({ phase: s.phase, pending: s.pending, result: s.result }),
    getPlayerState: () => null,
    getHostState: (s) => ({ ...s }),
    isFinished: (s) => s.phase === 'finished',
    hostActions: { retry: z.object({}) },
    handleHostAction: (s) => ({ ok: true, state: { ...s, pending: true, jobNo: s.jobNo + 1 } }),
    pendingJob: (s): GameJob | null => (s.pending ? { id: `job-${s.jobNo}`, kind: 'test', input: s.jobNo } : null),
    runJob,
    completeJob: (s, jobId, outcome) => {
      if (!s.pending || jobId !== `job-${s.jobNo}`) return s;
      return { ...s, pending: false, result: outcome.ok ? String(outcome.value) : 'secours' };
    },
  };
}

function setupRoom(module: GameModule<FakeState>, options: { ai?: AiClient } = {}) {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const env: RoomEnv = {
    now: () => Date.now(),
    random: () => 0.5,
    logger: logger as unknown as RoomEnv['logger'],
    maxPlayers: () => 4,
    graceMs: () => 60_000,
    notice: () => ({ goal: '', steps: [], tips: [] }),
    ...(options.ai ? { ai: options.ai } : {}),
  };
  const hooks = { onChange: () => {}, onGameStarted: () => {}, onGameEnded: () => {} };
  const room = new Room('ABCDE', module, env, hooks);
  room.join('Alice', undefined, 'sock-1');
  return { room, logger };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

interface Pending {
  job: GameJob;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
}

describe('travaux du jeu dans la salle', () => {
  it('lance le travail au démarrage et intègre son résultat', async () => {
    const started: string[] = [];
    const { room } = setupRoom(
      makeModule(async (job) => {
        started.push(job.id);
        return 'Bonjour';
      }),
    );

    expect(room.start()).toEqual({ ok: true });
    await flush();

    expect(started).toEqual(['job-1']);
    expect(room.hostView().game?.public).toEqual({ phase: 'playing', pending: false, result: 'Bonjour' });
  });

  it('une nouvelle demande abandonne le travail précédent, dont le résultat tardif est ignoré', async () => {
    const pending: Pending[] = [];
    const { room } = setupRoom(
      makeModule(
        (job, _ctx, signal) =>
          new Promise((resolve) => {
            pending.push({ job, signal, resolve });
          }),
      ),
    );

    room.start();
    await flush();
    expect(pending).toHaveLength(1);

    expect(room.hostAction('retry', {})).toEqual({ ok: true });
    await flush();
    expect(pending[0]!.signal.aborted).toBe(true);
    expect(pending).toHaveLength(2);

    pending[0]!.resolve('ancien');
    pending[1]!.resolve('nouveau');
    await flush();

    expect(room.hostView().game?.public).toEqual({ phase: 'playing', pending: false, result: 'nouveau' });
  });

  it('un échec du travail donne le repli au jeu, et la partie continue', async () => {
    const { room, logger } = setupRoom(
      makeModule(async () => {
        throw new Error('réseau coupé');
      }),
    );

    room.start();
    await flush();

    expect(room.status).toBe('in_game');
    expect(room.hostView().game?.public).toEqual({ phase: 'playing', pending: false, result: 'secours' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'room.job-failed', error: 'réseau coupé' }),
      expect.any(String),
    );
  });

  it('la fin de partie annule le travail en cours, et son résultat tardif n’a aucun effet', async () => {
    const pending: Pending[] = [];
    const { room } = setupRoom(
      makeModule(
        (job, _ctx, signal) =>
          new Promise((resolve) => {
            pending.push({ job, signal, resolve });
          }),
      ),
    );

    room.start();
    await flush();
    expect(room.end()).toEqual({ ok: true });
    expect(pending[0]!.signal.aborted).toBe(true);

    pending[0]!.resolve('tardif');
    await flush();

    expect(room.status).toBe('ended');
    expect(room.hostView().game?.public).toEqual({ phase: 'finished', pending: false, result: null });
  });

  it('le contexte du jeu ne donne le client d’IA que s’il est configuré', async () => {
    const complete = vi.fn(async () => 'texte de l’IA');
    const ai: AiClient = { complete };
    const runJob: RunJob = async (_job, ctx) =>
      ctx.ai ? await ctx.ai.complete({ system: 's', user: 'u', maxTokens: 10 }) : 'sans IA';

    const withAi = setupRoom(makeModule(runJob), { ai });
    withAi.room.start();
    await flush();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(withAi.room.hostView().game?.public).toMatchObject({ result: 'texte de l’IA' });

    const withoutAi = setupRoom(makeModule(runJob));
    withoutAi.room.start();
    await flush();
    expect(withoutAi.room.hostView().game?.public).toMatchObject({ result: 'sans IA' });
  });

  it('une action de l’écran principal est refusée hors partie ou si elle est inconnue', async () => {
    const { room } = setupRoom(makeModule(async () => 'x'));

    expect(room.hostAction('retry', {})).toEqual({ ok: false, error: 'Aucune partie en cours.' });

    room.start();
    await flush();
    expect(room.hostAction('inconnue', {})).toEqual({ ok: false, error: 'Action inconnue.' });
  });

  it('une action de l’écran principal envoyée sans payload est acceptée (régénérer)', async () => {
    const started: string[] = [];
    const { room } = setupRoom(
      makeModule(async (job) => {
        started.push(job.id);
        return 'x';
      }),
    );
    room.start();
    await flush();
    expect(room.hostAction('retry', undefined)).toEqual({ ok: true });
    await flush();
    expect(started).toEqual(['job-1', 'job-2']);
  });
});
