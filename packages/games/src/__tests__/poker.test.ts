import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { pokerTexas, type PokerState } from '../poker/module.js';
import { handStrength } from '../poker/bot.js';
import { buildPots, compareScores, evaluateHand, settlePots, type PokerCard, type Suit } from '../poker/rules.js';

/**
 * Poker Texas : évaluation des mains, pots latéraux, règles de mise, déroulé complet d'une donne, conservation
 * des jetons, joueurs absents, temps écoulé, et parties jouées par les robots.
 */

const k = (rank: number, suit: Suit = 's'): PokerCard => ({ rank, suit });

describe('Poker : valeur des mains', () => {
  it('reconnaît chaque combinaison, de la carte haute à la quinte flush royale', () => {
    const cases: [PokerCard[], string][] = [
      [[k(10), k(11), k(12), k(13), k(14)], 'Quinte flush royale'],
      [[k(14, 'h'), k(2, 'h'), k(3, 'h'), k(4, 'h'), k(5, 'h')], 'Quinte flush'],
      [[k(9), k(9, 'h'), k(9, 'd'), k(9, 'c'), k(2)], 'Carré'],
      [[k(9), k(9, 'h'), k(9, 'd'), k(4), k(4, 'h')], 'Full'],
      [[k(2), k(5), k(7), k(9), k(11)], 'Couleur'],
      [[k(14), k(2, 'h'), k(3, 'd'), k(4, 'c'), k(5, 'h')], 'Quinte'],
      [[k(7), k(7, 'h'), k(7, 'd'), k(13), k(2)], 'Brelan'],
      [[k(13), k(13, 'h'), k(5), k(5, 'h'), k(2)], 'Deux paires'],
      [[k(14), k(14, 'h'), k(9), k(4), k(2)], 'Paire'],
      [[k(14), k(11), k(9), k(4, 'h'), k(2)], 'Carte haute'],
    ];
    for (const [cards, name] of cases) expect(evaluateHand(cards).name).toBe(name);
  });

  it('la quinte à l’as bas (la roue) vaut la carte haute 5', () => {
    expect(evaluateHand([k(14), k(2, 'h'), k(3, 'd'), k(4, 'c'), k(5, 'h')]).score).toEqual([4, 5]);
  });

  it('choisit la meilleure main parmi sept cartes', () => {
    const seven = [k(14), k(2, 'h'), k(2, 'd'), k(2, 'c'), k(9), k(9, 'h'), k(3, 'd')];
    const best = evaluateHand(seven);
    expect(best.name).toBe('Full');
    expect(best.score).toEqual([6, 2, 9]);
  });

  it('départage les paires par leur valeur, puis par le kicker', () => {
    const kings = evaluateHand([k(13), k(13, 'h'), k(4), k(3), k(2)]);
    const queens = evaluateHand([k(12), k(12, 'h'), k(14), k(3), k(2)]);
    expect(compareScores(kings.score, queens.score)).toBeGreaterThan(0);
    const kingsKicker = evaluateHand([k(13), k(13, 'h'), k(14), k(3), k(2)]);
    const kingsLowKicker = evaluateHand([k(13, 'd'), k(13, 'c'), k(9), k(3, 'h'), k(2, 'h')]);
    expect(compareScores(kingsKicker.score, kingsLowKicker.score)).toBeGreaterThan(0);
  });
});

describe('Poker : pots', () => {
  it('un tapis plus petit crée un pot latéral que seuls les autres peuvent gagner', () => {
    const pots = buildPots({ a: 50, b: 100, c: 100 }, ['a', 'b', 'c']);
    expect(pots).toEqual([
      { amount: 150, eligible: ['a', 'b', 'c'] },
      { amount: 100, eligible: ['b', 'c'] },
    ]);
  });

  it('une mise non suivie revient à son auteur', () => {
    const pots = buildPots({ a: 100, b: 40 }, ['a', 'b']);
    expect(pots).toEqual([
      { amount: 80, eligible: ['a', 'b'] },
      { amount: 60, eligible: ['a'] },
    ]);
  });

  it('un pot à égalité se partage, le reliquat va d’abord au joueur après le bouton', () => {
    const board = [k(10, 'c'), k(11, 'd'), k(12, 'h'), k(13, 's'), k(14, 'c')];
    const holes = { p1: [k(2, 'd'), k(3, 'd')], p2: [k(4, 'h'), k(5, 'h')] };
    const { payouts, awards } = settlePots([{ amount: 101, eligible: ['p1', 'p2'] }], holes, board, ['p1', 'p2'], 0);
    expect(payouts).toEqual({ p2: 51, p1: 50 });
    expect(awards.map((a) => a.amount).reduce((x, y) => x + y)).toBe(101);
  });
});

describe('Poker : force de main des robots', () => {
  it('une paire de mains hautes vaut plus qu’une main faible', () => {
    expect(handStrength([k(14), k(14, 'h')], [])).toBeGreaterThan(handStrength([k(7), k(2, 'h')], []));
    expect(handStrength([k(14), k(14, 'h')], [])).toBeGreaterThan(0.8);
  });

  it('après le flop, une couleur vaut plus qu’une simple carte haute', () => {
    const board = [k(2, 'h'), k(7, 'h'), k(9, 'h')];
    const flush = handStrength([k(3, 'h'), k(12, 'h')], board);
    const high = handStrength([k(3, 'c'), k(12, 'd')], board);
    expect(flush).toBeGreaterThan(high);
  });
});

/** Générateur pseudo-aléatoire seedé, pour des parties reproductibles. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCtx(seed = 1, connected?: string[]) {
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
    random: seeded(seed),
    connectedPlayerIds: () => connected ?? ['p1', 'p2', 'p3'],
  };
  return { ctx, timers, advance: (ms: number) => (clock += ms) };
}

const two: PlayerRef[] = [
  { id: 'p1', name: 'Léa' },
  { id: 'p2', name: 'Tom' },
];
const three: PlayerRef[] = [...two, { id: 'p3', name: 'Ana' }];

function setup(
  players: PlayerRef[] = two,
  settings: Partial<{ startingChips: number; bigBlind: number; hands: number; turnSeconds: number }> = {},
  seed = 1,
  connected?: string[],
) {
  const env = makeCtx(seed, connected);
  const init = pokerTexas.initialize(
    { startingChips: 1000, bigBlind: 20, hands: 5, turnSeconds: 0, ...settings },
    players,
    env.ctx,
  );
  const started = pokerTexas.start(init, env.ctx);
  if (!started.ok) throw new Error(started.error);
  return { env, s0: started.state as PokerState };
}

const actor = (s: PokerState) => s.order[s.toAct]!;
/** Jetons en jeu : ceux des joueurs, plus le pot tant que la donne n'est pas jugée (ensuite il est distribué). */
const total = (s: PokerState) =>
  Object.values(s.chips).reduce((a, b) => a + b, 0) +
  (s.phase === 'betting' ? Object.values(s.committed).reduce((a, b) => a + b, 0) : 0);

function apply(
  s: PokerState,
  pid: string,
  type: string,
  env: ReturnType<typeof makeCtx>,
  payload?: unknown,
): PokerState {
  const r = pokerTexas.handleAction(s, { id: pid, name: pid }, type, payload, env.ctx);
  if (!r.ok) throw new Error(`${type} de ${pid} refusé : ${r.error}`);
  return r.state as PokerState;
}

/** Fait suivre ou passer jusqu'à la fin de la donne (tout le monde suit ou passe). */
function checkDown(s0: PokerState, env: ReturnType<typeof makeCtx>): PokerState {
  let s = s0;
  for (let guard = 0; s.phase === 'betting' && guard < 100; guard++) {
    const pid = actor(s);
    const toCall = s.currentBet - (s.streetBet[pid] ?? 0);
    s = apply(s, pid, toCall === 0 ? 'check' : 'call', env);
  }
  return s;
}

describe('Poker : déroulé d’une donne', () => {
  it('le bouton, les blindes et le premier joueur à agir avant le flop', () => {
    const { s0 } = setup();
    expect(s0.dealer).toBe(0);
    expect(s0.chips).toEqual({ p1: 990, p2: 980 });
    expect(s0.currentBet).toBe(20);
    expect(actor(s0)).toBe('p1');
    expect(total(s0)).toBe(2000);
  });

  it('refuse une action hors de son tour', () => {
    const { s0, env } = setup();
    const r = pokerTexas.handleAction(s0, { id: 'p2', name: 'Tom' }, 'check', undefined, env.ctx);
    expect(r).toEqual({ ok: false, error: 'Ce n’est pas votre tour.' });
  });

  it('une relance doit être au moins égale à la relance minimale', () => {
    const { s0, env } = setup();
    const small = pokerTexas.handleAction(s0, { id: 'p1', name: 'Léa' }, 'bet', { amount: 30 }, env.ctx);
    expect(small.ok).toBe(false);
    expect(small.ok === false && small.error).toContain('relance minimum est de 40');
    const big = apply(s0, 'p1', 'bet', env, { amount: 40 });
    expect(big.currentBet).toBe(40);
    expect(big.minRaise).toBe(20);
  });

  it('suivre puis passer mène au flop, où le joueur après le bouton (la grosse blinde) agit en premier', () => {
    const { s0, env } = setup();
    let s = apply(s0, 'p1', 'call', env);
    expect(actor(s)).toBe('p2');
    s = apply(s, 'p2', 'check', env);
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(actor(s)).toBe('p2');
  });

  it('si tout le monde se couche, le dernier joueur prend le pot sans montrer ses cartes', () => {
    const { s0, env } = setup();
    let s = apply(s0, 'p1', 'call', env);
    s = apply(s, 'p2', 'check', env);
    s = apply(s, 'p2', 'bet', env, { amount: 50 });
    s = apply(s, 'p1', 'fold', env);
    expect(s.phase).toBe('hand-over');
    expect(s.result?.byFold).toBe(true);
    expect(s.chips).toEqual({ p1: 980, p2: 1020 });
    expect(env.timers.has('next-hand')).toBe(true);
    expect(total(s)).toBe(2000);
  });

  it('la donne suivante change de bouton, et le jeu se termine après le nombre de donnes prévu', () => {
    const { s0, env } = setup(two, { hands: 1 });
    let s = apply(s0, 'p1', 'fold', env);
    expect(s.phase).toBe('hand-over');
    s = pokerTexas.onTimer(s, 'next-hand', env.ctx);
    expect(pokerTexas.isFinished(s)).toBe(true);
    expect(pokerTexas.calculateScores(s)[0]).toMatchObject({ playerId: 'p2', rank: 1 });
  });

  it('au showdown, les cartes sont révélées et les jetons sont conservés', () => {
    const { s0, env } = setup();
    const s = checkDown(s0, env);
    expect(s.phase).toBe('hand-over');
    expect(s.street).toBe('showdown');
    expect(s.board).toHaveLength(5);
    expect(s.result?.byFold).toBe(false);
    expect(Object.keys(s.result?.reveals ?? {}).sort()).toEqual(['p1', 'p2']);
    expect(total(s)).toBe(2000);
    expect(s.result?.winners.reduce((n, w) => n + w.amount, 0)).toBe(40);
  });

  it('un joueur qui a un tapis reste au pot et ne peut plus agir', () => {
    const { s0, env } = setup(three, { startingChips: 300, bigBlind: 20 });
    const first = actor(s0);
    const s = apply(s0, first, 'allin', env);
    expect(s.allIn[first]).toBe(true);
    expect(s.chips[first]).toBe(0);
    expect(s.order.filter((p) => s.allIn[p] && s.inHand[p])).toEqual([first]);
    expect(actor(s)).not.toBe(first);
    expect(total(s)).toBe(900);
  });
});

describe('Poker : temps et absences', () => {
  it('le temps écoulé fait passer le joueur qui doit suivre, en le couchant', () => {
    const { s0, env } = setup(two, { turnSeconds: 20 });
    expect(env.timers.get('turn')).toBe(20_000);
    const s = pokerTexas.onTimer(s0, 'turn', env.ctx);
    expect(s.folded.p1).toBe(true);
    expect(s.phase).toBe('hand-over');
  });

  it('un joueur absent est joué tout de suite à sa place', () => {
    const { s0, env } = setup(two, {}, 1, ['p1']);
    const s1 = apply(s0, 'p1', 'call', env);
    expect(actor(s1)).toBe('p2');
    expect(env.timers.get('absent')).toBeDefined();
    const s2 = pokerTexas.onTimer(s1, 'absent', env.ctx);
    expect(s2.street).toBe('flop');
  });
});

describe('Poker : vues et confidentialité', () => {
  it('la vue publique ne contient aucune carte privée, chaque joueur voit les siennes', () => {
    const { s0 } = setup();
    const pub = pokerTexas.getPublicState(s0) as unknown as Record<string, unknown>;
    expect(pub).not.toHaveProperty('holes');
    expect(pub).not.toHaveProperty('deck');
    expect(JSON.stringify(pub)).not.toContain(JSON.stringify(s0.holes.p1));
    expect(pokerTexas.getPlayerState(s0, 'p1')).toMatchObject({ holes: s0.holes.p1, isMyTurn: true });
    expect(pokerTexas.getPlayerState(s0, 'p2')).toMatchObject({ holes: s0.holes.p2, isMyTurn: false });
  });

  it('le téléphone indique ce qui est permis : suivre, passer, relancer et tapis', () => {
    const { s0 } = setup();
    expect(pokerTexas.getPlayerState(s0, 'p1')).toMatchObject({
      toCall: 10,
      canCheck: false,
      canCall: true,
      canRaise: true,
      minRaiseTo: 40,
      maxRaiseTo: 1000,
    });
  });
});

describe('Poker : parties jouées par les robots', () => {
  /** Joue une partie complète avec les robots et vérifie la conservation des jetons à chaque coup. */
  function playBotGame(
    seed: number,
    players: PlayerRef[],
    settings: Partial<{ startingChips: number; bigBlind: number; hands: number }>,
  ) {
    const env = makeCtx(seed);
    const init = pokerTexas.initialize(
      { startingChips: 200, bigBlind: 10, hands: 25, turnSeconds: 0, ...settings },
      players,
      env.ctx,
    );
    const started = pokerTexas.start(init, env.ctx);
    if (!started.ok) throw new Error(started.error);
    let s = started.state as PokerState;
    const expected = players.length * (settings.startingChips ?? 200);
    const rnd = seeded(seed + 99);
    let steps = 0;
    while (!pokerTexas.isFinished(s) && steps < 20_000) {
      steps += 1;
      if (s.phase === 'hand-over') {
        expect(
          Object.values(s.chips).reduce((a, b) => a + b, 0),
          `seed ${seed} donne ${s.hand}`,
        ).toBe(expected);
        s = pokerTexas.nextRound(s, env.ctx);
        continue;
      }
      if (s.phase !== 'betting') break;
      const pid = actor(s);
      const suggestion = pokerTexas.suggest?.(s, pid, rnd);
      expect(suggestion, `seed ${seed} : le robot ${pid} doit jouer`).not.toBeNull();
      const r = pokerTexas.handleAction(s, { id: pid, name: pid }, suggestion!.type, suggestion!.payload, env.ctx);
      expect(r.ok, `seed ${seed} : ${suggestion!.type} refusé : ${r.ok ? '' : r.error}`).toBe(true);
      s = (r as { ok: true; state: PokerState }).state;
      expect(total(s), `seed ${seed} : jetons perdus ou créés`).toBe(expected);
      for (const p of players) expect(s.chips[p.id]!, `seed ${seed} : jetons négatifs`).toBeGreaterThanOrEqual(0);
    }
    return s;
  }

  it('deux robots finissent la partie et les jetons sont toujours conservés', () => {
    for (const seed of [1, 2, 3]) {
      const s = playBotGame(seed, two, {});
      expect(pokerTexas.isFinished(s)).toBe(true);
    }
  });

  it('trois robots, avec des stacks courts, finissent aussi sans perdre de jetons', () => {
    for (const seed of [4, 5, 6, 7]) {
      const s = playBotGame(seed, three, { startingChips: 120, bigBlind: 10 });
      expect(pokerTexas.isFinished(s)).toBe(true);
    }
  });

  it('le classement suit les jetons', () => {
    const s = playBotGame(8, three, { startingChips: 150 });
    const ranking = pokerTexas.calculateScores(s);
    const points = ranking.map((r) => r.points);
    expect(points).toEqual([...points].sort((a, b) => b - a));
    expect(points.reduce((a, b) => a + b, 0)).toBe(450);
  });
});
