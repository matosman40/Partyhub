import { describe, expect, it } from 'vitest';
import type { CardGameDefinition, GameContext, PlayerRef } from '@partyhub/shared';
import { MEMORY_HIDE_MS, createMemoryGame, pairKey, type MemoryState } from '../cards/memory.js';

/**
 * Mécanique « mémo » : tours, paires trouvées ou ratées, temps écoulé, fin de partie et robots.
 */

const families = [{ id: 'bleu', label: 'Bleu', color: '#3f8cff' }];

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id.toUpperCase(),
  symbol: id.toUpperCase(),
  family: 'bleu',
  effect: 'none',
  count: 2,
  points: 1,
  ...extra,
});

/** Trois paires : « a » (1 point), « b » (2 points) et « c »/« d » reliées par l'étiquette « x » (3 points). */
const definition = {
  name: 'Mémo test',
  description: 'Test.',
  icon: '🧠',
  theme: 'arcade',
  families,
  cards: [
    card('a', { points: 1 }),
    card('b', { points: 2 }),
    card('c', { count: 1, pair: 'x', points: 3 }),
    card('d', { count: 1, pair: 'x', points: 3 }),
  ],
  rules: {
    minPlayers: 2,
    maxPlayers: 4,
    handSize: 3,
    matchOn: 'family',
    targetScore: 100,
    turnSeconds: 20,
    mechanic: 'memory',
  },
  notice: { goal: 'Trouver les paires.', steps: ['Retournez deux cartes.'], tips: [] },
} as unknown as CardGameDefinition;

const players: PlayerRef[] = [
  { id: 'p1', name: 'Léa' },
  { id: 'p2', name: 'Tom' },
];

function makeCtx() {
  const timers = new Map<string, number>();
  let clock = 0;
  const ctx: GameContext = {
    now: () => clock,
    schedule: (key, delayMs) => timers.set(key, delayMs),
    cancel: (key) => {
      timers.delete(key);
    },
    random: () => 0.42,
    connectedPlayerIds: () => ['p1', 'p2'],
  };
  return { ctx, timers, advance: (ms: number) => (clock += ms) };
}

function setup() {
  const mod = createMemoryGame(definition, { id: 'test-memo' });
  const env = makeCtx();
  const initial = mod.initialize(mod.defaultSettings, players, env.ctx);
  const started = mod.start(initial, env.ctx);
  if (!started.ok) throw new Error(started.error);
  return { mod, env, state: started.state as MemoryState };
}

/** Action qui doit réussir. */
function act(
  mod: ReturnType<typeof createMemoryGame>,
  state: MemoryState,
  pid: string,
  cardId: string,
  ctx: GameContext,
): MemoryState {
  const r = mod.handleAction(state, { id: pid, name: pid }, 'flip', { cardId }, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.state as MemoryState;
}

const uidsOf = (s: MemoryState, entryId: string) => s.board.filter((c) => c.entry === entryId).map((c) => c.uid);

describe('Mémo : mise en place', () => {
  it('pose toutes les cartes face cachée : le contenu n’apparaît pas dans la vue publique', () => {
    const { mod, state } = setup();
    expect(state.board).toHaveLength(6);
    const pub = mod.getPublicState(state) as { board: { entry: string | null }[]; kind: string };
    expect(pub.kind).toBe('memory');
    expect(pub.board.every((c) => c.entry === null)).toBe(true);
  });

  it('commence par le premier joueur, avec un minuteur de tour', () => {
    const { mod, env, state } = setup();
    const pub = mod.getPublicState(state) as { current: string };
    expect(pub.current).toBe('p1');
    expect(env.timers.get('turn')).toBe(20_000);
  });
});

describe('Mémo : déroulement des tours', () => {
  it('une paire trouvée rapporte ses points et le joueur rejoue', () => {
    const { mod, env, state: s0 } = setup();
    const [a1, a2] = uidsOf(s0, 'a');
    let s = act(mod, s0, 'p1', a1!, env.ctx);
    expect(s.open).toEqual([a1]);
    s = act(mod, s, 'p1', a2!, env.ctx);
    expect(s.scores.p1).toBe(1);
    expect(s.matches).toBe(1);
    expect(s.open).toEqual([]);
    expect(s.order[s.turn]).toBe('p1');
  });

  it('une paire ratée laisse les cartes visibles un instant, puis passe la main', () => {
    const { mod, env, state: s0 } = setup();
    let s = act(mod, s0, 'p1', uidsOf(s0, 'a')[0]!, env.ctx);
    s = act(mod, s, 'p1', uidsOf(s0, 'b')[0]!, env.ctx);
    expect(s.phase).toBe('peek');
    expect(env.timers.get('hide')).toBe(MEMORY_HIDE_MS);
    expect(mod.getPublicState(s)).toMatchObject({ open: s.open });

    s = mod.onTimer(s, 'hide', env.ctx);
    expect(s.phase).toBe('play');
    expect(s.open).toEqual([]);
    expect(s.order[s.turn]).toBe('p2');
  });

  it('refuse un coup hors de son tour, une carte déjà retournée et une carte trouvée', () => {
    const { mod, env, state: s0 } = setup();
    const [a1] = uidsOf(s0, 'a');
    const notMine = mod.handleAction(s0, { id: 'p2', name: 'Tom' }, 'flip', { cardId: a1 }, env.ctx);
    expect(notMine).toEqual({ ok: false, error: "Ce n'est pas votre tour." });

    const s1 = act(mod, s0, 'p1', a1!, env.ctx);
    const twice = mod.handleAction(s1, { id: 'p1', name: 'Léa' }, 'flip', { cardId: a1 }, env.ctx);
    expect(twice).toEqual({ ok: false, error: 'Cette carte est déjà retournée.' });

    const [a2] = uidsOf(s0, 'a').filter((u) => u !== a1);
    const s2 = act(mod, s1, 'p1', a2!, env.ctx);
    const found = mod.handleAction(s2, { id: 'p1', name: 'Léa' }, 'flip', { cardId: a1 }, env.ctx);
    expect(found.ok).toBe(false);
  });

  it('le temps écoulé retourne la carte seule et passe au joueur suivant', () => {
    const { mod, env, state: s0 } = setup();
    let s = act(mod, s0, 'p1', uidsOf(s0, 'b')[0]!, env.ctx);
    s = mod.onTimer(s, 'turn', env.ctx);
    expect(s.open).toEqual([]);
    expect(s.order[s.turn]).toBe('p2');
    expect(env.timers.get('turn')).toBe(20_000);
  });

  it('une paire reliée par une étiquette commune (pair) se trouve comme une paire identique', () => {
    const { mod, env, state: s0 } = setup();
    let s = act(mod, s0, 'p1', uidsOf(s0, 'c')[0]!, env.ctx);
    s = act(mod, s, 'p1', uidsOf(s0, 'd')[0]!, env.ctx);
    expect(s.scores.p1).toBe(3);
    expect(s.matches).toBe(1);
  });
});

describe('Mémo : fin de partie', () => {
  it('se termine quand toutes les paires sont trouvées, avec le classement des scores', () => {
    const { mod, env, state: s0 } = setup();
    let s = s0;
    for (const entry of ['a', 'b', 'c']) {
      const uids = entry === 'c' ? [uidsOf(s0, 'c')[0]!, uidsOf(s0, 'd')[0]!] : uidsOf(s0, entry);
      for (const uid of uids) s = act(mod, s, 'p1', uid, env.ctx);
    }
    expect(mod.isFinished(s)).toBe(true);
    const ranking = mod.calculateScores(s);
    expect(ranking[0]).toMatchObject({ playerId: 'p1', points: 6, rank: 1 });
    expect(env.timers.has('turn')).toBe(false);
  });

  it('la partie s’arrête dès qu’un joueur atteint l’objectif de points', () => {
    const mod = createMemoryGame(definition, { id: 'test-memo' });
    const env = makeCtx();
    const initial = mod.initialize({ targetScore: 3, turnSeconds: 20 }, players, env.ctx);
    const started = mod.start(initial, env.ctx);
    if (!started.ok) throw new Error(started.error);
    const s0 = started.state as MemoryState;
    let s = act(mod, s0, 'p1', uidsOf(s0, 'c')[0]!, env.ctx);
    s = act(mod, s, 'p1', uidsOf(s0, 'd')[0]!, env.ctx);
    expect(mod.isFinished(s)).toBe(true);
    expect(s.matches).toBe(1);
  });

  it('un coup après la fin est refusé', () => {
    const { mod, env, state: s0 } = setup();
    let s = s0;
    for (const uid of [...uidsOf(s0, 'a'), ...uidsOf(s0, 'b'), uidsOf(s0, 'c')[0]!, uidsOf(s0, 'd')[0]!]) {
      s = act(mod, s, 'p1', uid, env.ctx);
    }
    const late = mod.handleAction(s, { id: 'p1', name: 'Léa' }, 'flip', { cardId: 'c1' }, env.ctx);
    expect(late).toEqual({ ok: false, error: 'La partie est terminée.' });
  });
});

describe('Mémo : robots et identifiants de paires', () => {
  it('le robot retourne une carte cachée uniquement quand c’est son tour', () => {
    const { mod, state } = setup();
    const suggestion = mod.suggest?.(state, 'p1', () => 0.5);
    expect(suggestion).toMatchObject({ type: 'flip' });
    expect(mod.suggest?.(state, 'p2', () => 0.5)).toBeNull();
  });

  it('une étiquette de paire ne se confond jamais avec l’identifiant d’une autre carte', () => {
    expect(pairKey({ id: 'x' })).not.toBe(pairKey({ id: 'z', pair: 'x' }));
    expect(pairKey({ id: 'a' })).not.toBe(pairKey({ id: 'b', pair: 'a' }));
    expect(pairKey({ id: 'a', pair: 'a' })).toBe(pairKey({ id: 'z', pair: 'a' }));
  });
});
