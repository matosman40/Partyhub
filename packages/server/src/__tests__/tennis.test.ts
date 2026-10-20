import { describe, expect, it } from 'vitest';
import { tennisParty, type TennisState } from '@partyhub/games';
import type { GameContext, PlayerRef } from '@partyhub/shared';

/**
 * Tennis party : le serveur place les joueurs sur les côtés, tient les vies et les points, et ne croit un coup
 * ou une balle perdue que pour un côté occupé par un joueur vivant.
 */

const A: PlayerRef = { id: 'a', name: 'Alice' };
const B: PlayerRef = { id: 'b', name: 'Bob' };
const C: PlayerRef = { id: 'c', name: 'Chloé' };
const D: PlayerRef = { id: 'd', name: 'Didier' };

function makeCtx(connected: string[]) {
  const clock = { t: 1_000_000 };
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random: () => 0.42,
    connectedPlayerIds: () => connected,
  };
  return { ctx, clock, timers };
}

function started(players: PlayerRef[], lives?: number) {
  const h = makeCtx(players.map((p) => p.id));
  const settings = tennisParty.settingsSchema.parse(lives === undefined ? {} : { lives });
  const init = tennisParty.initialize(settings, players, h.ctx);
  const res = tennisParty.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  return { ...h, state: res.state };
}

function hostAction(state: TennisState, type: string, side: number, ctx: GameContext) {
  const handler = tennisParty.handleHostAction;
  if (!handler) throw new Error('pas d’actions de l’écran principal');
  return handler(state, type, { side }, ctx);
}

describe('Tennis party : règles serveur', () => {
  it('démarre à deux joueurs, qui se font face (bas et haut)', () => {
    const { state } = started([A, B]);
    expect(state.phase).toBe('play');
    expect(state.seats).toEqual(['a', 'b', null, null]);
    expect(state.lives).toEqual({ a: 3, b: 3 });
  });

  it('quatre joueurs occupent les quatre côtés', () => {
    const { state } = started([A, B, C, D]);
    expect(state.seats).toEqual(['a', 'b', 'c', 'd']);
  });

  it('refuse de démarrer seul', () => {
    const h = makeCtx(['a']);
    const init = tennisParty.initialize(tennisParty.settingsSchema.parse({}), [A], h.ctx);
    const res = tennisParty.start(init, h.ctx);
    expect(res.ok).toBe(false);
  });

  it('un coup réussi rapporte des points ; un second coup trop vite n’en rapporte pas', () => {
    const { state, ctx, clock } = started([A, B]);
    const first = hostAction(state, 'hit', 0, ctx);
    expect(first.ok && first.state.points.a).toBe(10);
    const tooSoon = hostAction(first.ok ? first.state : state, 'hit', 0, ctx);
    expect(tooSoon.ok && tooSoon.state.points.a).toBe(10);
    clock.t += 100;
    const later = hostAction(first.ok ? first.state : state, 'hit', 0, ctx);
    expect(later.ok && later.state.points.a).toBe(20);
  });

  it('une balle perdue retire une vie, puis élimine ; le dernier debout termine la partie', () => {
    const h = started([A, B]);
    let s = h.state;
    for (let i = 0; i < 2; i++) {
      const res = hostAction(s, 'lost', 1, h.ctx);
      if (!res.ok) throw new Error(res.error);
      s = res.state;
    }
    expect(s.lives.b).toBe(1);
    expect(s.phase).toBe('play');

    const last = hostAction(s, 'lost', 1, h.ctx);
    if (!last.ok) throw new Error(last.error);
    expect(last.state.lives.b).toBe(0);
    expect(last.state.eliminated).toEqual(['b']);
    expect(last.state.phase).toBe('final');
    // Alice garde ses trois vies (15 points) et reçoit la prime du dernier debout (50 points).
    expect(last.state.points.a).toBe(65);
    expect(last.state.points.b).toBe(0);
  });

  it('un côté libre ou un événement après la fin ne change rien', () => {
    const { state, ctx } = started([A, B]);
    const empty = hostAction(state, 'lost', 2, ctx);
    expect(empty.ok && empty.state.lives).toEqual({ a: 3, b: 3 });
    const finished = tennisParty.end(state, ctx);
    const late = hostAction(finished, 'hit', 0, ctx);
    expect(late.ok && late.state.points.a).toBe(finished.points.a);
  });

  it('refuse un côté hors du terrain', () => {
    const { state, ctx } = started([A, B]);
    const handler = tennisParty.handleHostAction!;
    const res = handler(state, 'hit', { side: 7 }, ctx);
    expect(res.ok).toBe(false);
  });

  it('à la fin du temps, les survivants gagnent leurs vies restantes', () => {
    const { state, ctx } = started([A, B], 2);
    const finished = tennisParty.onTimer(state, 'match-end', ctx);
    expect(finished.phase).toBe('final');
    expect(finished.points).toEqual({ a: 10, b: 10 });
  });

  it('la vue du téléphone donne le côté ; la vue publique montre les vies de chacun', () => {
    const { state } = started([A, B, C]);
    expect(tennisParty.getPlayerState(state, 'c')).toMatchObject({ side: 2, alive: true, lives: 3 });
    expect(tennisParty.getPlayerState(state, 'zz')).toMatchObject({ side: null, alive: false });
    const pub = tennisParty.getPublicState(state) as { seats: { side: number; name: string | null }[] };
    expect(pub.seats.map((s) => s.name)).toEqual(['Alice', 'Bob', 'Chloé', null]);
  });

  it('le classement reprend les points de chacun', () => {
    const { state } = started([A, B]);
    const rows = tennisParty.calculateScores(state);
    expect(rows.map((r) => r.playerId)).toEqual(expect.arrayContaining(['a', 'b']));
  });
});
