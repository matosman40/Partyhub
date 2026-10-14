import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { president, validatePlay, rankValue, type PresidentState } from '@partyhub/games';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCtx(connected: string[], random = seeded(11)) {
  const timers = new Map<string, number>();
  const clock = { t: 1_000_000 };
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random,
    connectedPlayerIds: () => connected,
  };
  return { ctx, timers };
}

const P = (id: string): PlayerRef => ({ id, name: id.toUpperCase() });
const card = (uid: string) => ({ uid, entry: uid });

function start(players: PlayerRef[], settings = { rounds: 2, turnSeconds: 0 }) {
  const h = makeCtx(players.map((p) => p.id));
  const init = president.initialize(president.settingsSchema.parse(settings), players, h.ctx);
  const res = president.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  return { state: res.state, ...h };
}

describe('règles de pli du Président', () => {
  it('valide un coup de même rang qui bat le pli', () => {
    expect(validatePlay(0, 0, [{ label: '7' }]).ok).toBe(true);
    expect(validatePlay(rankValue('7'), 1, [{ label: '9' }]).ok).toBe(true);
    expect(validatePlay(rankValue('9'), 1, [{ label: '7' }]).ok).toBe(false);
  });

  it('exige le même rang et le même nombre de cartes que le pli', () => {
    expect(validatePlay(0, 0, [{ label: '7' }, { label: '8' }]).ok).toBe(false);
    expect(validatePlay(rankValue('5'), 2, [{ label: 'K' }]).ok).toBe(false);
    expect(validatePlay(rankValue('5'), 2, [{ label: 'K' }, { label: 'K' }]).ok).toBe(true);
  });

  it('le 2 est la carte la plus forte, le 3 la plus faible', () => {
    expect(validatePlay(rankValue('A'), 1, [{ label: '2' }]).ok).toBe(true);
    expect(validatePlay(rankValue('3'), 1, [{ label: '4' }]).ok).toBe(true);
    expect(validatePlay(rankValue('4'), 1, [{ label: '3' }]).ok).toBe(false);
  });

  it('un 10 ou un carré brûle le pli, quelle que soit la valeur précédente', () => {
    expect(validatePlay(rankValue('A'), 1, [{ label: '10' }]).ok).toBe(true);
    expect(
      validatePlay(rankValue('A'), 1, [{ label: '10' }]).ok && validatePlay(rankValue('A'), 1, [{ label: '10' }]).burns,
    ).toBe(true);
  });
});

describe('moteur du Président', () => {
  it('distribue les 52 cartes entre les joueurs', () => {
    const { state } = start([P('a'), P('b'), P('c')]);
    const total = Object.values(state.hands).reduce((n, h) => n + h.length, 0);
    expect(total).toBe(52);
    expect(
      Object.values(state.hands)
        .map((h) => h.length)
        .sort(),
    ).toEqual([17, 17, 18]);
  });

  it('refuse de jouer hors de son tour et de passer sur une table vide', () => {
    const { state, ctx } = start([P('a'), P('b'), P('c')]);
    const first = state.order[state.turn]!;
    const other = state.order.find((id) => id !== first)!;
    expect(president.handleAction(state, P(other), 'pass', undefined, ctx).ok).toBe(false);
    expect(president.handleAction(state, P(first), 'pass', undefined, ctx).ok).toBe(false);
  });

  it('un pli se termine quand les autres ont tous passé : le dernier à poser reprend la main', () => {
    const { ctx } = start([P('a'), P('b'), P('c')]);
    const base = start([P('a'), P('b'), P('c')]).state;
    const s: PresidentState = {
      ...base,
      started: true,
      finished: [],
      hands: { a: [card('5s'), card('9h')], b: [card('6h'), card('2d')], c: [card('kc'), card('3c')] },
      pile: [],
      pileRank: 0,
      pileCount: 0,
      leader: null,
      passed: [],
      turn: 0,
    };
    const played = president.handleAction(s, P('a'), 'play', { cardIds: ['5s'] }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.order[played.state.turn]).toBe('b');
    const b = president.handleAction(played.state, P('b'), 'pass', undefined, ctx);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.state.order[b.state.turn]).toBe('c');
    const c = president.handleAction(b.state, P('c'), 'pass', undefined, ctx);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.state.pileCount).toBe(0);
    expect(c.state.order[c.state.turn]).toBe('a');
  });

  it('un 10 brûle le pli et le joueur rejoue immédiatement', () => {
    const { ctx } = start([P('a'), P('b'), P('c')]);
    const base = start([P('a'), P('b'), P('c')]).state;
    const s: PresidentState = {
      ...base,
      started: true,
      finished: [],
      hands: { a: [card('10h'), card('9h')], b: [card('kc'), card('2d')], c: [card('qc'), card('4s')] },
      pile: [card('7s')],
      pileRank: rankValue('7'),
      pileCount: 1,
      leader: 'c',
      passed: [],
      turn: 0,
    };
    const res = president.handleAction(s, P('a'), 'play', { cardIds: ['10h'] }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pile).toHaveLength(0);
    expect(res.state.pileCount).toBe(0);
    expect(res.state.order[res.state.turn]).toBe('a');
  });

  it('la manche se termine quand il reste un seul joueur, avec les rangs et les points', () => {
    const { ctx } = start([P('a'), P('b'), P('c')]);
    const base = start([P('a'), P('b'), P('c')]).state;
    const s: PresidentState = {
      ...base,
      started: true,
      finished: [],
      hands: { a: [card('3d')], b: [card('4d')], c: [card('kc')] },
      pile: [],
      pileRank: 0,
      pileCount: 0,
      leader: null,
      passed: [],
      turn: 0,
      round: 1,
      settings: { rounds: 3, turnSeconds: 0 },
    };
    const first = president.handleAction(s, P('a'), 'play', { cardIds: ['3d'] }, ctx);
    if (!first.ok) throw new Error(first.error);
    const second = president.handleAction(first.state, P('b'), 'play', { cardIds: ['4d'] }, ctx);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.phase).toBe('round-over');
    expect(second.state.finished).toEqual(['a', 'b', 'c']);
    expect(second.state.scores).toEqual({ a: 2, b: 1, c: 0 });
    expect(second.state.roles).toEqual({ a: 'Président', b: 'Vice-président', c: 'Trou du cul' });
  });

  it('la manche suivante redonne 52 cartes et applique l’échange entre rangs', () => {
    const { ctx } = start([P('a'), P('b'), P('c')]);
    const base = start([P('a'), P('b'), P('c')]).state;
    const roundOver: PresidentState = {
      ...base,
      started: true,
      phase: 'round-over',
      round: 1,
      finished: ['a', 'b', 'c'],
      scores: { a: 2, b: 1, c: 0 },
      settings: { rounds: 3, turnSeconds: 0 },
    };
    const next = president.nextRound(roundOver, ctx);
    expect(next.phase).toBe('play');
    expect(next.round).toBe(2);
    const total = Object.values(next.hands).reduce((n, h) => n + h.length, 0);
    expect(total).toBe(52);
    expect(next.lastEvent).toContain('Échange');
  });

  it('une partie complète jouée par des robots se termine sans blocage', () => {
    const players = [P('a'), P('b'), P('c'), P('d')];
    const random = seeded(5);
    const { state: first, ctx } = start(players, { rounds: 2, turnSeconds: 0 });
    let state = first;
    let steps = 0;
    while (!president.isFinished(state) && steps < 5000) {
      steps++;
      if (state.phase === 'round-over') {
        state = president.nextRound(state, ctx);
        continue;
      }
      const actor = state.order[state.turn]!;
      const sug = president.suggest?.(state, actor, random);
      expect(sug, `le robot ${actor} doit proposer une action`).toBeTruthy();
      const res = president.handleAction(state, P(actor), sug!.type, sug!.payload, ctx);
      expect(res.ok, res.ok ? '' : res.error).toBe(true);
      if (res.ok) state = res.state;
    }
    expect(president.isFinished(state), `partie non terminée après ${steps} actions`).toBe(true);
    expect(state.round).toBe(2);
  });
});
