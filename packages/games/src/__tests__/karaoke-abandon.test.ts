import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { karaoke, type KaraokeState } from '../karaoke/module.js';

/** Le chanteur qui arrête son passage : pas de vote sur une prestation inachevée, et le tour suivant reprend. */

const players: PlayerRef[] = [
  { id: 'p1', name: 'Léa' },
  { id: 'p2', name: 'Tom' },
  { id: 'p3', name: 'Ana' },
];

const song = { videoId: 'VHoT4N43jK8', title: 'Alors on danse', channel: 'Stromae', startSec: 45 };

function makeCtx() {
  const timers = new Map<string, number>();
  const clock = 0;
  const ctx: GameContext = {
    now: () => clock,
    schedule: (key, delayMs) => {
      timers.set(key, delayMs);
    },
    cancel: (key) => {
      timers.delete(key);
    },
    random: () => 0.42,
    connectedPlayerIds: () => ['p1', 'p2', 'p3'],
  };
  return { ctx, timers };
}

function started() {
  const env = makeCtx();
  const initial = karaoke.initialize(karaoke.defaultSettings, players, env.ctx);
  const result = karaoke.start(initial, env.ctx);
  if (!result.ok) throw new Error(result.error);
  return { env, state: result.state as KaraokeState };
}

describe('Karaoké : abandon du passage', () => {
  it('le chanteur peut arrêter pendant le chant : on passe à la révélation, sans point', () => {
    const { env, state } = started();
    const singer = state.order[0]!;
    const sung = karaoke.handleAction(state, { id: singer, name: singer }, 'sing', song, env.ctx);
    if (!sung.ok) throw new Error(sung.error);

    const abandoned = karaoke.handleAction(sung.state, { id: singer, name: singer }, 'abandon', {}, env.ctx);
    expect(abandoned.ok).toBe(true);
    if (!abandoned.ok) return;
    expect(abandoned.state.phase).toBe('reveal');
    expect(abandoned.state.points[singer]).toBe(0);
    expect(abandoned.state.clip).toBeNull();
    expect(abandoned.state.abandoned).toBe(true);
    expect((karaoke.getPublicState(abandoned.state) as { abandoned: boolean }).abandoned).toBe(true);
    // Aucun minuteur de vote ne reste en route.
    expect(env.timers.has('vote-timeout')).toBe(false);
    expect(env.timers.has('sing-timeout')).toBe(false);
  });

  it('un auditeur ne peut pas arrêter le passage du chanteur', () => {
    const { env, state } = started();
    const singer = state.order[0]!;
    const listener = state.order[1]!;
    const sung = karaoke.handleAction(state, { id: singer, name: singer }, 'sing', song, env.ctx);
    if (!sung.ok) throw new Error(sung.error);
    const refused = karaoke.handleAction(sung.state, { id: listener, name: listener }, 'abandon', {}, env.ctx);
    expect(refused.ok).toBe(false);
  });

  it('abandonner hors du chant est refusé', () => {
    const { env, state } = started();
    const singer = state.order[0]!;
    const refused = karaoke.handleAction(state, { id: singer, name: singer }, 'abandon', {}, env.ctx);
    expect(refused.ok).toBe(false);
  });

  it('après un abandon, le tour suivant reprend avec le chanteur suivant', () => {
    const { env, state } = started();
    const singer = state.order[0]!;
    const sung = karaoke.handleAction(state, { id: singer, name: singer }, 'sing', song, env.ctx);
    if (!sung.ok) throw new Error(sung.error);
    const abandoned = karaoke.handleAction(sung.state, { id: singer, name: singer }, 'abandon', {}, env.ctx);
    if (!abandoned.ok) throw new Error(abandoned.error);
    const next = karaoke.onTimer(abandoned.state, 'reveal-next', env.ctx);
    expect(next.phase).toBe('pick');
    expect(next.index).toBe(1);
    // Le drapeau retombe avec le tour suivant : le passage suivant n’est pas marqué comme arrêté.
    expect(next.abandoned).toBe(false);
  });

  it('un passage sans note (délai de choix dépassé) n’est pas marqué comme arrêté', () => {
    const { env, state } = started();
    const timedOut = karaoke.onTimer(state, 'pick-timeout', env.ctx);
    expect(timedOut.phase).toBe('reveal');
    expect(timedOut.abandoned).toBe(false);
    expect((karaoke.getPublicState(timedOut) as { abandoned: boolean }).abandoned).toBe(false);
  });
});
