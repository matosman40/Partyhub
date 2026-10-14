import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { poker, evaluateBest, compareHands, buildPots, resolvePots, type PokerState } from '@partyhub/games';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCtx(connected: string[], random = seeded(5)) {
  const timers = new Map<string, number>();
  const clock = { t: 1_000_000 };
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random,
    connectedPlayerIds: () => connected,
  };
  return { ctx, timers, clock };
}

const P = (id: string): PlayerRef => ({ id, name: id.toUpperCase() });

function setup(ids: string[], settings: Record<string, unknown> = {}, seed = 5) {
  const h = makeCtx(ids, seeded(seed));
  const init = poker.initialize(poker.settingsSchema.parse({ turnSeconds: 0, ...settings }), ids.map(P), h.ctx);
  const res = poker.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  return { state: res.state, ...h };
}

function act(h: { ctx: GameContext }, state: PokerState, id: string, type: string, payload?: unknown): PokerState {
  const res = poker.handleAction(state, P(id), type, payload, h.ctx);
  if (!res.ok) throw new Error(`${id} ${type} : ${res.error}`);
  return res.state;
}

/** Jetons en pile + jetons engagés dans la main : doit rester constant. */
function chips(state: PokerState): number {
  const stacks = Object.values(state.stacks).reduce((a, b) => a + b, 0);
  const pot = Object.values(state.totals).reduce((a, b) => a + b, 0);
  return stacks + pot;
}

describe('évaluation des mains de poker', () => {
  const rank = (cards: string) => evaluateBest(cards.split(' '));

  it('classe les catégories dans le bon ordre', () => {
    const order = [
      'As Ks Qs Js Ts', // quinte flush royale
      '9h 8h 7h 6h 5h', // quinte flush
      'Ac Ad Ah As 2c', // carré
      'Kc Kd Kh 2s 2c', // full
      'Ah 9h 7h 4h 2h', // couleur
      'Tc 9d 8h 7s 6c', // quinte
      'Qc Qd Qh 9s 2c', // brelan
      'Jc Jd 4h 4s 2c', // double paire
      'Ac Ad 9h 5s 2c', // paire
      'Ac Kd 9h 5s 2c', // carte haute
    ].map(rank);
    expect(order[0]!.name).toBe('Quinte flush royale');
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareHands(order[i]!, order[i + 1]!)).toBeGreaterThan(0);
    }
  });

  it("l'as peut être bas dans une quinte, qui reste la plus faible", () => {
    const wheel = rank('As 2d 3h 4s 5c');
    const sixHigh = rank('2d 3h 4s 5c 6d');
    expect(wheel.name).toBe('Quinte');
    expect(compareHands(sixHigh, wheel)).toBeGreaterThan(0);
  });

  it('départage par les cartes d’accompagnement', () => {
    expect(compareHands(rank('Ac Ad Kh 5s 2c'), rank('Ah As Qh 5d 2d'))).toBeGreaterThan(0);
    expect(compareHands(rank('Kc Kd 9h 9s 3c'), rank('Kh Ks 9c 9d 2c'))).toBeGreaterThan(0);
    expect(compareHands(rank('Ac Kd 9h 5s 2c'), rank('Ad Kc 9s 5h 2d'))).toBe(0);
  });

  it('choisit la meilleure combinaison de cinq cartes parmi sept', () => {
    // Quinte possible (5-9) mais la couleur à cœur est meilleure.
    const best = evaluateBest(['5h', '6d', '7h', '8h', '9c', 'Kh', '2h']);
    expect(best.name).toBe('Couleur');
  });
});

describe('pots principal et secondaires', () => {
  it('limite le joueur tapis aux pots auxquels il a contribué', () => {
    const pots = buildPots({ a: 100, b: 300, c: 300 }, []);
    expect(pots).toEqual([
      { amount: 300, eligible: ['a', 'b', 'c'] },
      { amount: 400, eligible: ['b', 'c'] },
    ]);
  });

  it('garde les jetons d’un joueur couché sans lui donner droit au pot', () => {
    const pots = buildPots({ a: 50, b: 200, c: 200 }, ['a']);
    const total = pots.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(450);
    expect(pots.every((p) => !p.eligible.includes('a'))).toBe(true);
  });

  it('partage un pot entre ex æquo, le reste au premier après le croupier', () => {
    const value = evaluateBest(['As', 'Kd', 'Qh', 'Js', '9c']);
    const result = resolvePots([{ amount: 101, eligible: ['a', 'b'] }], { a: value, b: value }, ['b', 'a']);
    expect(result.awards).toEqual({ b: 51, a: 50 });
  });
});

describe('déroulement d’une main de poker', () => {
  it('à trois : petite et grosse blinde après le croupier, premier à parler après la grosse blinde', () => {
    const { state } = setup(['a', 'b', 'c']);
    expect(state.dealer).toBe('a');
    expect(state.bets).toEqual({ a: 0, b: 10, c: 20 });
    expect(state.turn).toBe('a');
    expect(state.holes.a).toHaveLength(2);
    expect(chips(state)).toBe(3000);
  });

  it('en tête-à-tête : le croupier paie la petite blinde et parle en premier avant le flop', () => {
    const h = setup(['a', 'b']);
    let s = h.state;
    expect(s.bets).toEqual({ a: 10, b: 20 });
    expect(s.turn).toBe('a');
    s = act(h, s, 'a', 'call');
    s = act(h, s, 'b', 'check');
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    // Après le flop, la grosse blinde (hors croupier) parle en premier.
    expect(s.turn).toBe('b');
  });

  it('refuse un check face à une mise et une relance trop petite', () => {
    const h = setup(['a', 'b', 'c']);
    const res = poker.handleAction(h.state, P('a'), 'check', undefined, h.ctx);
    expect(res.ok).toBe(false);
    const small = poker.handleAction(h.state, P('a'), 'raise', { to: 30 }, h.ctx);
    expect(small.ok).toBe(false);
    if (!small.ok) expect(small.error).toContain('40');
    const wrongTurn = poker.handleAction(h.state, P('b'), 'call', undefined, h.ctx);
    expect(wrongTurn.ok).toBe(false);
  });

  it('une relance oblige les autres à répondre à nouveau', () => {
    const h = setup(['a', 'b', 'c']);
    let s = act(h, h.state, 'a', 'call');
    s = act(h, s, 'b', 'call');
    s = act(h, s, 'c', 'raise', { to: 60 });
    expect(s.street).toBe('preflop');
    expect(s.turn).toBe('a');
    s = act(h, s, 'a', 'call');
    s = act(h, s, 'b', 'fold');
    expect(s.street).toBe('flop');
    expect(chips(s)).toBe(3000);
  });

  it('tout le monde se couche : la grosse blinde ramasse sans abattre, la main suivante est programmée', () => {
    const h = setup(['a', 'b', 'c']);
    let s = act(h, h.state, 'a', 'fold');
    s = act(h, s, 'b', 'fold');
    expect(s.phase).toBe('hand-over');
    expect(s.winners).toEqual([{ id: 'c', name: 'C', amount: 30, hand: null }]);
    expect(s.stacks.c).toBe(1010);
    expect(s.revealed).toEqual([]);
    expect(h.timers.has('next-hand')).toBe(true);
    const next = poker.onTimer(s, 'next-hand', h.ctx);
    expect(next.handNumber).toBe(2);
    expect(next.dealer).toBe('b');
    expect(chips(next)).toBe(3000);
  });

  it('tapis à trois avec pot secondaire : chacun ne gagne que ce qu’il a pu couvrir', () => {
    const h = setup(['a', 'b', 'c']);
    let s = structuredClone(h.state);
    // Piles inégales et cartes connues : a a la meilleure main mais le plus petit tapis.
    s.stacks = { a: 100 - s.bets.a!, b: 300 - s.bets.b!, c: 300 - s.bets.c! };
    s.holes = { a: ['As', 'Ad'], b: ['Ks', 'Kd'], c: ['7c', '2d'] };
    // La pioche se lit par la fin : le tableau sortira dans l'ordre 3h, 9s, 4c, Jh, Ah.
    s.deck = ['Ah', 'Jh', '4c', '9s', '3h'];
    s = act(h, s, 'a', 'allin');
    s = act(h, s, 'b', 'allin');
    s = act(h, s, 'c', 'call');
    expect(s.phase).toBe('hand-over');
    expect(s.board).toHaveLength(5);
    // a gagne le pot principal (3 × 100), b le pot secondaire (2 × 200).
    expect(s.stacks.a).toBe(300);
    expect(s.stacks.b).toBe(400);
    expect(s.stacks.c).toBe(0);
    expect(s.revealed.sort()).toEqual(['a', 'b', 'c']);
  });

  it('le temps écoulé fait checker si c’est gratuit, sinon coucher', () => {
    const h = setup(['a', 'b', 'c'], { turnSeconds: 20 });
    expect(h.timers.get('turn')).toBe(20_000);
    let s = poker.onTimer(h.state, 'turn', h.ctx);
    expect(s.folded).toContain('a');
    s = act(h, s, 'b', 'call');
    s = poker.onTimer(s, 'turn', h.ctx);
    // La grosse blinde n'a rien à payer : elle checke, et le flop arrive.
    expect(s.folded).not.toContain('c');
    expect(s.street).toBe('flop');
  });

  it('ne révèle jamais les cartes privées des autres avant l’abattage', () => {
    const h = setup(['a', 'b', 'c']);
    const pub = poker.getPublicState(h.state) as Record<string, unknown>;
    expect(pub).not.toHaveProperty('holes');
    expect(pub).not.toHaveProperty('deck');
    expect(pub.revealed).toEqual({});
    const me = poker.getPlayerState(h.state, 'a') as { hole: { uid: string }[] };
    expect(me.hole.map((c) => c.uid)).toEqual(h.state.holes.a);
    const other = poker.getPlayerState(h.state, 'b') as { hole: { uid: string }[] };
    expect(other.hole.map((c) => c.uid)).not.toEqual(h.state.holes.a);
  });

  it('une partie complète jouée par des robots se termine en conservant les jetons', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const h = setup(ids, { startingChips: 200, smallBlind: 10, bigBlind: 20 }, 42);
    let s = h.state;
    const random = seeded(9);
    for (let step = 0; step < 5000 && s.phase !== 'final'; step++) {
      if (s.phase === 'hand-over') {
        s = poker.nextRound(s, h.ctx);
        continue;
      }
      const actor = s.turn!;
      const move = poker.suggest!(s, actor, random);
      expect(move).not.toBeNull();
      s = act(h, s, actor, move!.type, move!.payload);
      expect(chips(s)).toBe(800);
    }
    expect(s.phase).toBe('final');
    const ranking = poker.calculateScores(s);
    expect(ranking[0]!.points).toBe(800);
  });
});

describe('places et spectateurs', () => {
  it('seuls les premiers joueurs prennent une place, les autres observent', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const h = makeCtx(ids, seeded(5));
    const init = poker.initialize(poker.settingsSchema.parse({ turnSeconds: 0, seats: 2 }), ids.map(P), h.ctx);
    expect(init.order).toEqual(['a', 'b']);
    expect(poker.getPublicState(init).spectators).toEqual(['c', 'd']);
    expect(poker.getPlayerState(init, 'c').seated).toBe(false);
    expect(poker.getPlayerState(init, 'c').spectator).toBe(true);
    expect(poker.getPlayerState(init, 'a').seated).toBe(true);
    expect(poker.getPlayerState(init, 'a').spectator).toBe(false);
  });

  it('un joueur qui arrive hors places reste spectateur, et un départ le retire de la liste', () => {
    const ids = ['a', 'b', 'c'];
    const h = makeCtx(ids, seeded(5));
    const init = poker.initialize(poker.settingsSchema.parse({ turnSeconds: 0, seats: 2 }), ids.slice(0, 2).map(P), h.ctx);
    const joined = poker.onPlayerJoin!(init, P('c'));
    expect(joined.order).toEqual(['a', 'b']);
    expect(poker.getPublicState(joined).spectators).toEqual(['c']);
    const left = poker.onPlayerLeave!(joined, P('c'));
    expect(poker.getPublicState(left).spectators).toEqual([]);
  });

  it('une fois la partie lancée, un nouvel arrivant observe sans recevoir de place', () => {
    const ids = ['a', 'b'];
    const h = makeCtx(ids, seeded(5));
    const init = poker.initialize(poker.settingsSchema.parse({ turnSeconds: 0 }), ids.map(P), h.ctx);
    const res = poker.start(init, h.ctx);
    if (!res.ok) throw new Error(res.error);
    const late = poker.onPlayerJoin!(res.state, P('z'));
    expect(late.order).toEqual(['a', 'b']);
    expect(poker.getPlayerState(late, 'z').spectator).toBe(true);
  });
});
