import { describe, expect, it } from 'vitest';
import type { CardGameDefinition, GameContext, GameResult, PlayerRef } from '@partyhub/shared';
import { RACE_LOCK_MS, createRaceGame, resembles, type RaceState } from '../cards/race.js';

/**
 * Mécanique « ressemblance » : touches justes et fausses, manches, cartes de réserve, temps écoulé et robots.
 * Les situations sont posées directement (mains, centre, pioche) : le test ne dépend pas du mélange.
 */

const families = [
  { id: 'rouge', label: 'Rouge', color: '#ff3b30' },
  { id: 'bleu', label: 'Bleu', color: '#3f8cff' },
];

const card = (id: string, family: string, symbol: string, points: number) => ({
  id,
  label: `${symbol} ${family}`,
  symbol,
  family,
  effect: 'none',
  count: 2,
  points,
});

/** Huit cartes : « r1 » (2 pts), « b1 » (3 pts), « r2 » (1 pt), « b2 » (1 pt), chacune en deux exemplaires. */
const definition = {
  name: 'Ressemblance test',
  description: 'Test.',
  icon: '🔎',
  theme: 'arcade',
  families,
  cards: [
    card('r1', 'rouge', '1', 2),
    card('b1', 'bleu', '1', 3),
    card('r2', 'rouge', '2', 1),
    card('b2', 'bleu', '2', 1),
  ],
  rules: {
    minPlayers: 2,
    maxPlayers: 2,
    handSize: 3,
    matchOn: 'either',
    targetScore: 100,
    turnSeconds: 0,
    mechanic: 'race',
  },
  notice: { goal: 'Trouver la carte qui ressemble.', steps: ['Touchez.'], tips: [] },
} as unknown as CardGameDefinition;

const players: PlayerRef[] = [
  { id: 'p1', name: 'Léa' },
  { id: 'p2', name: 'Tom' },
];

function makeCtx(connected: string[] = ['p1', 'p2']) {
  const timers = new Map<string, number>();
  let clock = 0;
  const ctx: GameContext = {
    now: () => clock,
    schedule: (key, delayMs) => {
      timers.set(key, delayMs);
    },
    cancel: (key) => {
      timers.delete(key);
    },
    random: () => 0.42,
    connectedPlayerIds: () => connected,
  };
  return { ctx, timers, advance: (ms: number) => (clock += ms) };
}

function build(settings = { targetScore: 100, turnSeconds: 0 }, connected?: string[]) {
  const mod = createRaceGame(definition, { id: 'test-race' });
  const env = makeCtx(connected);
  const started = mod.start(mod.initialize(settings, players, env.ctx), env.ctx);
  if (!started.ok) throw new Error(started.error);
  return { mod, env, base: started.state as RaceState };
}

/** Pose une situation précise sur une partie lancée. */
function situation(base: RaceState, patch: Partial<RaceState>): RaceState {
  return { ...base, ...patch };
}

const c = (uid: string, entry: string) => ({ uid, entry });

function okState(r: GameResult<RaceState>): RaceState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function tap(mod: ReturnType<typeof createRaceGame>, state: RaceState, pid: string, cardId: string, ctx: GameContext) {
  return mod.handleAction(state, { id: pid, name: pid }, 'tap', { cardId }, ctx);
}

describe('Ressemblance : règle de ressemblance', () => {
  const r1 = definition.cards[0]!;
  const b1 = definition.cards[1]!;
  const r2 = definition.cards[2]!;
  const b2 = definition.cards[3]!;

  it('« family » ne regarde que la famille', () => {
    expect(resembles('family', r1, r2)).toBe(true);
    expect(resembles('family', r1, b1)).toBe(false);
  });

  it('« symbol » ne regarde que le symbole', () => {
    expect(resembles('symbol', r1, b1)).toBe(true);
    expect(resembles('symbol', r1, r2)).toBe(false);
  });

  it('« either » accepte la même famille ou le même symbole', () => {
    expect(resembles('either', r1, r2)).toBe(true);
    expect(resembles('either', r1, b1)).toBe(true);
    expect(resembles('either', r1, b2)).toBe(false);
  });
});

describe('Ressemblance : mise en place', () => {
  it('distribue les mains et garde toutes les cartes (mains, pioche et centre)', () => {
    const { base } = build();
    const total =
      base.order.reduce((n, id) => n + base.hands[id]!.length, 0) + base.pile.length + (base.center ? 1 : 0);
    expect(total).toBe(8);
    for (const id of base.order) expect(base.hands[id]!).toHaveLength(3);
    expect(base.center).not.toBeNull();
  });

  it('la vue publique ne montre aucune main : seulement les nombres de cartes', () => {
    const { mod, base } = build();
    const pub = mod.getPublicState(base) as unknown as Record<string, unknown>;
    expect(pub).not.toHaveProperty('hands');
    expect(pub.counts).toEqual({ p1: 3, p2: 3 });
    const serialized = JSON.stringify(pub);
    for (const card of base.hands.p1!) {
      if (card.uid !== base.center?.uid) expect(serialized).not.toContain(`"uid":"${card.uid}"`);
    }
  });

  it('chaque joueur ne reçoit que sa propre main', () => {
    const { mod, base } = build();
    expect(mod.getPlayerState(base, 'p1').hand).toEqual(base.hands.p1);
    expect(mod.getPlayerState(base, 'p2').hand).toEqual(base.hands.p2);
  });
});

describe('Ressemblance : touches', () => {
  it('une touche juste prend la carte centrale, marque ses points et pose sa carte au centre', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b2'), c('a3', 'r2')], p2: [c('x1', 'b2')] },
      center: c('k0', 'r1'),
      pile: [],
      scores: { p1: 0, p2: 0 },
      locked: {},
    });
    const next = okState(tap(mod, s, 'p1', 'a1', env.ctx));
    expect(next.scores.p1).toBe(2);
    expect(next.center?.uid).toBe('a1');
    expect(next.hands.p1!.map((x) => x.uid)).toEqual(['a2', 'a3']);
    expect(next.phase).toBe('play');
    expect(env.timers.has('turn')).toBe(false);
  });

  it('une touche fausse bloque son auteur le temps du verrou, sans changer le centre', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b2')], p2: [c('x1', 'r2')] },
      center: c('k0', 'r1'),
      pile: [],
      scores: { p1: 0, p2: 0 },
      locked: {},
    });
    const wrong = okState(tap(mod, s, 'p1', 'a2', env.ctx));
    expect(wrong.center?.uid).toBe('k0');
    expect(wrong.scores.p1).toBe(0);
    expect(wrong.locked.p1).toBe(RACE_LOCK_MS);
    expect(env.timers.get('unlock:p1')).toBe(RACE_LOCK_MS);

    const blocked = mod.handleAction(wrong, { id: 'p1', name: 'Léa' }, 'tap', { cardId: 'a1' }, env.ctx);
    expect(blocked).toMatchObject({ ok: false });
    expect(blocked.ok === false && blocked.error).toContain('bloquée');

    env.advance(RACE_LOCK_MS);
    const unlocked = mod.onTimer(wrong, 'unlock:p1', env.ctx);
    expect(unlocked.locked.p1).toBeUndefined();
    expect(okState(tap(mod, unlocked, 'p1', 'a1', env.ctx)).center?.uid).toBe('a1');
  });

  it('le verrou d’un joueur n’empêche pas les autres de répondre', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b2')], p2: [c('x1', 'r2')] },
      center: c('k0', 'r1'),
      pile: [],
      scores: { p1: 0, p2: 0 },
      locked: {},
    });
    const locked = okState(tap(mod, s, 'p1', 'a2', env.ctx));
    const answered = okState(tap(mod, locked, 'p2', 'x1', env.ctx));
    expect(answered.scores.p2).toBe(2);
    expect(answered.center?.uid).toBe('x1');
  });

  it('refuse une carte qui n’est pas dans la main du joueur', () => {
    const { mod, env, base } = build();
    const s = situation(base, { hands: { p1: [c('a1', 'r1')], p2: [c('x1', 'r2')] }, center: c('k0', 'r1'), pile: [] });
    const r = tap(mod, s, 'p1', 'x1', env.ctx);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('pas dans votre main');
  });

  it('un joueur qui n’est pas dans la partie ne peut pas toucher', () => {
    const { mod, env, base } = build();
    const r = mod.handleAction(base, { id: 'p3', name: 'Ana' }, 'tap', { cardId: 'a1' }, env.ctx);
    expect(r.ok).toBe(false);
  });
});

describe('Ressemblance : manches et fin de partie', () => {
  it('vider sa main termine la manche et programme la suivante', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1')], p2: [c('x1', 'b2'), c('x2', 'r2')] },
      center: c('k0', 'r1'),
      pile: [],
      scores: { p1: 0, p2: 0 },
      locked: {},
    });
    const done = okState(tap(mod, s, 'p1', 'a1', env.ctx));
    expect(done.phase).toBe('round-over');
    expect(done.roundWinner).toBe('p1');
    expect(done.scores.p1).toBe(2);
    expect(env.timers.get('next-round')).toBe(5000);

    const next = mod.onTimer(done, 'next-round', env.ctx);
    expect(next.phase).toBe('play');
    expect(next.round).toBe(done.round + 1);
    expect(next.locked).toEqual({});
  });

  it('personne ne peut répondre et la pioche est vide : la manche s’arrête sans gagnant', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b2')], p2: [c('x1', 'b2')] },
      center: c('k0', 'r1'),
      pile: [],
      scores: { p1: 0, p2: 0 },
      locked: {},
    });
    const done = okState(tap(mod, s, 'p1', 'a1', env.ctx));
    expect(done.phase).toBe('round-over');
    expect(done.roundWinner).toBeNull();
    expect(env.timers.has('next-round')).toBe(true);
  });

  it('personne ne peut répondre : la carte centrale est remplacée par la carte suivante de la pioche', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b2')], p2: [c('x1', 'b2')] },
      center: c('k0', 'r1'),
      pile: [c('q1', 'b1')],
      scores: { p1: 0, p2: 0 },
      locked: {},
    });
    const next = okState(tap(mod, s, 'p1', 'a1', env.ctx));
    expect(next.center?.uid).toBe('q1');
    expect(next.pile).toHaveLength(0);
    expect(next.phase).toBe('play');
  });

  it('un joueur déconnecté ne peut pas bloquer la manche : seules les cartes des connectés comptent', () => {
    const { mod, env, base } = build(undefined, ['p1']);
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b2')], p2: [c('x1', 'r2')] },
      center: c('k0', 'r1'),
      pile: [],
      scores: { p1: 0, p2: 0 },
      locked: {},
    });
    const done = okState(tap(mod, s, 'p1', 'a1', env.ctx));
    expect(done.phase).toBe('round-over');
    expect(done.roundWinner).toBeNull();
  });

  it('atteindre l’objectif de points termine la partie tout de suite', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b2')], p2: [c('x1', 'b2')] },
      center: c('k0', 'r1'),
      pile: [],
      scores: { p1: 99, p2: 0 },
      locked: {},
    });
    const done = okState(tap(mod, s, 'p1', 'a1', env.ctx));
    expect(mod.isFinished(done)).toBe(true);
    expect(mod.calculateScores(done)[0]).toMatchObject({ playerId: 'p1', points: 101, rank: 1 });
    expect(env.timers.has('next-round')).toBe(false);
  });

  it('une partie interrompue est terminée et n’accepte plus de coup', () => {
    const { mod, env, base } = build();
    const ended = mod.end(base, env.ctx);
    expect(mod.isFinished(ended)).toBe(true);
    const late = mod.handleAction(ended, { id: 'p1', name: 'Léa' }, 'tap', { cardId: 'a1' }, env.ctx);
    expect(late).toEqual({ ok: false, error: 'La partie est terminée.' });
  });

  it('nextRound lance une nouvelle manche quand la précédente est terminée', () => {
    const { mod, env, base } = build();
    const over = situation(base, { phase: 'round-over' });
    const next = mod.nextRound(over, env.ctx);
    expect(next.phase).toBe('play');
    expect(next.round).toBe(over.round + 1);
  });
});

describe('Ressemblance : temps écoulé', () => {
  it('avec turnSeconds positif, le temps écoulé change la carte centrale', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      settings: { targetScore: 100, turnSeconds: 20 },
      hands: { p1: [c('a2', 'b2')], p2: [c('x1', 'b2')] },
      center: c('k0', 'r1'),
      pile: [c('q1', 'b1')],
    });
    const next = mod.onTimer(s, 'turn', env.ctx);
    expect(next.center?.uid).toBe('q1');
    expect(env.timers.get('turn')).toBe(20_000);
    expect(next.turnEndsAt).toBe(20_000);
  });

  it('avec turnSeconds à zéro, aucun minuteur ne touche au centre', () => {
    const { base } = build();
    expect(base.turnEndsAt).toBeNull();
  });
});

describe('Ressemblance : robots', () => {
  it('le robot touche une carte qui répond au centre, sauf quand il laisse passer', () => {
    const { mod, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b2')], p2: [] },
      center: c('k0', 'r1'),
      pile: [],
    });
    expect(mod.suggest?.(s, 'p1', () => 0.9, 0)).toMatchObject({ type: 'tap', payload: { cardId: 'a1' } });
    expect(mod.suggest?.(s, 'p1', () => 0.1, 0)).toBeNull();
  });

  it('le robot ne joue rien sans carte qui réponde, pendant un verrou, ou hors partie', () => {
    const { mod, base } = build();
    const none = situation(base, { hands: { p1: [c('a2', 'b2')], p2: [] }, center: c('k0', 'r1'), pile: [] });
    expect(mod.suggest?.(none, 'p1', () => 0.9, 0)).toBeNull();

    // Le verrou s’écrit sur l’horloge de la partie (ctx.now) : le robot le compare à `now`, pas à Date.now().
    const yes = situation(base, { hands: { p1: [c('a1', 'r1')], p2: [] }, center: c('k0', 'r1'), pile: [] });
    const locked = situation(yes, { locked: { p1: 60_000 } });
    expect(mod.suggest?.(locked, 'p1', () => 0.9, 0)).toBeNull();
    expect(mod.suggest?.(locked, 'p1', () => 0.9, 60_000)).toMatchObject({ type: 'tap' });
    expect(mod.suggest?.(yes, 'p9', () => 0.9, 0)).toBeNull();
  });
});
