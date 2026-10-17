import { describe, expect, it } from 'vitest';
import type { CardGameDefinition, GameContext, GameResult, PlayerRef } from '@partyhub/shared';
import { TRICK_PAUSE_MS, createTrickGame, trickRank, trickWinnerIndex, type TrickState } from '../cards/trick.js';

/**
 * Mécanique « pli » : suivre la couleur demandée, atout, gagnant du pli, manches, joueurs absents, temps
 * écoulé et robots. Les situations sont posées directement : le test ne dépend pas du mélange.
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

/** Huit cartes en deux exemplaires : rouge 1 (1 pt), rouge 3 (2 pts), bleu 1 (1 pt), bleu 3 (3 pts). */
const cards = [
  card('r1', 'rouge', '1', 1),
  card('r3', 'rouge', '3', 2),
  card('b1', 'bleu', '1', 1),
  card('b3', 'bleu', '3', 3),
];

const baseRules = {
  minPlayers: 2,
  maxPlayers: 2,
  handSize: 3,
  matchOn: 'family',
  targetScore: 100,
  turnSeconds: 0,
  mechanic: 'trick',
};

const definition = {
  name: 'Pli test',
  description: 'Test.',
  icon: '🃏',
  theme: 'classique',
  families,
  cards,
  rules: baseRules,
  notice: { goal: 'Faire les plis.', steps: ['Jouez.'], tips: [] },
} as unknown as CardGameDefinition;

const withAtout = {
  ...definition,
  rules: { ...baseRules, trump: 'bleu' },
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

function build(
  def: CardGameDefinition = definition,
  settings = { targetScore: 100, turnSeconds: 0 },
  connected?: string[],
) {
  const mod = createTrickGame(def, { id: 'test-trick' });
  const env = makeCtx(connected);
  const started = mod.start(mod.initialize(settings, players, env.ctx), env.ctx);
  if (!started.ok) throw new Error(started.error);
  return { mod, env, base: started.state as TrickState, def };
}

function situation(base: TrickState, patch: Partial<TrickState>): TrickState {
  return { ...base, ...patch };
}

const c = (uid: string, entry: string) => ({ uid, entry });

function okState(r: GameResult<TrickState>): TrickState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function play(
  mod: ReturnType<typeof createTrickGame>,
  state: TrickState,
  pid: string,
  cardId: string,
  ctx: GameContext,
) {
  return mod.handleAction(state, { id: pid, name: pid }, 'play', { cardId }, ctx);
}

/** Entrée de carte minimale pour tester le choix du gagnant. */
const e = (family: string, symbol: string, points = 1, rank?: number) =>
  ({ id: `${family}${symbol}`, label: symbol, symbol, family, effect: 'none', count: 1, points, rank }) as never;

describe('Pli : force des cartes et gagnant', () => {
  it('la force est le rang explicite, sinon la valeur numérique du symbole, sinon zéro', () => {
    expect(trickRank(e('rouge', '3', 1, 42))).toBe(42);
    expect(trickRank(e('rouge', '7'))).toBe(7);
    expect(trickRank(e('rouge', 'R'))).toBe(0);
  });

  it('la plus forte carte de la couleur demandée gagne', () => {
    const plays = [{ entry: e('rouge', '1') }, { entry: e('rouge', '3') }, { entry: e('rouge', '1') }];
    expect(trickWinnerIndex(plays, 'rouge', undefined)).toBe(1);
  });

  it('une carte hors couleur ne gagne pas sans atout', () => {
    const plays = [{ entry: e('rouge', '1') }, { entry: e('bleu', '3') }];
    expect(trickWinnerIndex(plays, 'rouge', undefined)).toBe(0);
  });

  it('un atout l’emporte sur la couleur demandée, et le plus fort atout gagne', () => {
    expect(trickWinnerIndex([{ entry: e('rouge', '3') }, { entry: e('bleu', '1') }], 'rouge', 'bleu')).toBe(1);
    expect(trickWinnerIndex([{ entry: e('bleu', '1') }, { entry: e('bleu', '3') }], 'rouge', 'bleu')).toBe(1);
    expect(trickWinnerIndex([{ entry: e('bleu', '3') }, { entry: e('bleu', '1') }], 'rouge', 'bleu')).toBe(0);
  });

  it('à force égale, la carte jouée la première gagne', () => {
    expect(trickWinnerIndex([{ entry: e('rouge', '3') }, { entry: e('rouge', '3') }], 'rouge', undefined)).toBe(0);
  });
});

describe('Pli : mise en place', () => {
  it('distribue la main de chacun, sans pli en cours, et ouvre le premier joueur', () => {
    const { mod, base } = build();
    expect(base.order.map((id) => base.hands[id]!.length)).toEqual([3, 3]);
    expect(base.table).toEqual([]);
    expect(base.phase).toBe('play');
    expect(mod.getPublicState(base).current).toBe('p1');
  });

  it('la vue publique ne montre aucune main, seulement les nombres de cartes et la table', () => {
    const { mod, base } = build();
    const pub = mod.getPublicState(base) as unknown as Record<string, unknown>;
    expect(pub).not.toHaveProperty('hands');
    expect(pub.counts).toEqual({ p1: 3, p2: 3 });
    expect(pub.table).toEqual([]);
  });

  it('chaque joueur ne reçoit que sa main, et seules ses cartes légales sont jouables à son tour', () => {
    const { mod, base } = build();
    expect(mod.getPlayerState(base, 'p1').hand).toEqual(base.hands.p1);
    expect(mod.getPlayerState(base, 'p2').playable).toEqual([]);
    expect(mod.getPlayerState(base, 'p1').playable).toHaveLength(3);
  });
});

describe('Pli : déroulement', () => {
  it('il faut fournir la couleur demandée si on la possède', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'b3'), c('a2', 'r1')], p2: [c('x1', 'r3'), c('x2', 'b1')] },
      table: [],
      ledFamily: null,
      turn: 0,
      phase: 'play',
    });
    const led = okState(play(mod, s, 'p1', 'a1', env.ctx));
    expect(led.ledFamily).toBe('bleu');
    expect(led.turn).toBe(1);

    const refused = play(mod, led, 'p2', 'x1', env.ctx);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toContain('couleur demandée');
    expect(mod.getPlayerState(led, 'p2').playable).toEqual(['x2']);
  });

  it('le pli va à la plus forte carte de la couleur demandée, avec ses points, et son gagnant ouvre le suivant', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'b3'), c('a2', 'r1')], p2: [c('x1', 'r3'), c('x2', 'b1')] },
      table: [],
      ledFamily: null,
      turn: 0,
      phase: 'play',
      scores: { p1: 0, p2: 0 },
      tricksWon: { p1: 0, p2: 0 },
    });
    let next = okState(play(mod, s, 'p1', 'a1', env.ctx));
    next = okState(play(mod, next, 'p2', 'x2', env.ctx));
    expect(next.phase).toBe('trick-over');
    expect(next.scores.p1).toBe(4);
    expect(next.tricksWon.p1).toBe(1);
    expect(next.lastTrick?.winner).toBe('p1');
    expect(next.turn).toBe(0);
    expect(env.timers.get('next-trick')).toBe(TRICK_PAUSE_MS);

    const after = mod.onTimer(next, 'next-trick', env.ctx);
    expect(after.phase).toBe('play');
    expect(after.table).toEqual([]);
    expect(after.ledFamily).toBeNull();
    expect(mod.getPublicState(after).current).toBe('p1');
  });

  it('avec un atout, une carte d’atout gagne même si elle n’est pas de la couleur demandée', () => {
    const { mod, env, base } = build(withAtout);
    // p1 n'a pas de rouge : il peut donc couper avec son atout bleu.
    const s = situation(base, {
      hands: { p1: [c('a1', 'b1'), c('a2', 'b3')], p2: [c('x1', 'r3'), c('x2', 'r1')] },
      table: [],
      ledFamily: null,
      turn: 1,
      phase: 'play',
      scores: { p1: 0, p2: 0 },
      tricksWon: { p1: 0, p2: 0 },
    });
    let next = okState(play(mod, s, 'p2', 'x1', env.ctx));
    next = okState(play(mod, next, 'p1', 'a1', env.ctx));
    expect(next.lastTrick?.winner).toBe('p1');
    expect(next.scores.p1).toBe(3);
  });

  it('refuse un coup hors de son tour, une carte absente de sa main ou un joueur étranger', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1')], p2: [c('x1', 'r3')] },
      table: [],
      ledFamily: null,
      turn: 0,
    });
    expect(play(mod, s, 'p2', 'x1', env.ctx)).toEqual({ ok: false, error: 'Ce n’est pas votre tour.' });
    expect(play(mod, s, 'p1', 'x1', env.ctx).ok).toBe(false);
    expect(mod.handleAction(s, { id: 'p9', name: 'Ana' }, 'play', { cardId: 'a1' }, env.ctx).ok).toBe(false);
  });

  it('une fois le pli terminé, le jeu attend la pause avant de le ramasser', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'b3'), c('a2', 'r1')], p2: [c('x1', 'r3'), c('x2', 'b1')] },
      table: [],
      ledFamily: null,
      turn: 0,
      phase: 'play',
    });
    let next = okState(play(mod, s, 'p1', 'a1', env.ctx));
    next = okState(play(mod, next, 'p2', 'x2', env.ctx));
    const early = play(mod, next, 'p1', 'a2', env.ctx);
    expect(early.ok).toBe(false);
  });
});

describe('Pli : manches et fin de partie', () => {
  it('quand toutes les mains sont vides, la manche se termine avec le gagnant des plis', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'b3')], p2: [c('x1', 'b1')] },
      table: [],
      ledFamily: null,
      turn: 0,
      phase: 'play',
      scores: { p1: 0, p2: 0 },
      tricksWon: { p1: 0, p2: 0 },
    });
    let next = okState(play(mod, s, 'p1', 'a1', env.ctx));
    next = okState(play(mod, next, 'p2', 'x1', env.ctx));
    expect(next.phase).toBe('round-over');
    expect(next.roundWinner).toBe('p1');
    expect(env.timers.get('next-round')).toBe(6000);

    const dealt = mod.onTimer(next, 'next-round', env.ctx);
    expect(dealt.phase).toBe('play');
    expect(dealt.round).toBe(next.round + 1);
    expect(dealt.tricksWon).toEqual({ p1: 0, p2: 0 });
  });

  it('une manche qui fait atteindre l’objectif termine la partie', () => {
    const { mod, env, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'b3')], p2: [c('x1', 'b1')] },
      table: [],
      ledFamily: null,
      turn: 0,
      phase: 'play',
      scores: { p1: 98, p2: 0 },
      tricksWon: { p1: 0, p2: 0 },
    });
    let next = okState(play(mod, s, 'p1', 'a1', env.ctx));
    next = okState(play(mod, next, 'p2', 'x1', env.ctx));
    expect(mod.isFinished(next)).toBe(true);
    expect(mod.calculateScores(next)[0]).toMatchObject({ playerId: 'p1', points: 102, rank: 1 });
    expect(env.timers.has('next-round')).toBe(false);
  });

  it('une partie interrompue est terminée et n’accepte plus de coup', () => {
    const { mod, env, base } = build();
    const ended = mod.end(base, env.ctx);
    expect(mod.isFinished(ended)).toBe(true);
    expect(mod.handleAction(ended, { id: 'p1', name: 'Léa' }, 'play', { cardId: 'a1' }, env.ctx)).toEqual({
      ok: false,
      error: 'La partie est terminée.',
    });
  });
});

describe('Pli : joueurs absents et temps écoulé', () => {
  it('un joueur absent joue sa carte la plus faible légale à sa place', () => {
    const { mod, env, base } = build(definition, undefined, ['p1']);
    const s = situation(base, {
      hands: { p1: [c('a1', 'b3')], p2: [c('x1', 'r3'), c('x2', 'b1')] },
      table: [],
      ledFamily: null,
      turn: 0,
      phase: 'play',
      scores: { p1: 0, p2: 0 },
      tricksWon: { p1: 0, p2: 0 },
    });
    const next = okState(play(mod, s, 'p1', 'a1', env.ctx));
    expect(next.phase).toBe('trick-over');
    expect(next.lastTrick?.cards.map((t) => t.pid)).toEqual(['p1', 'p2']);
    expect(next.lastEvent).toContain('absent');
    expect(next.scores.p1).toBe(4);
  });

  it('le temps écoulé fait jouer la carte la plus faible légale, puis passe au joueur suivant', () => {
    const { mod, env, base } = build(definition, { targetScore: 100, turnSeconds: 20 });
    const s = situation(base, {
      hands: { p1: [c('a1', 'r3'), c('a2', 'b1')], p2: [c('x1', 'r1')] },
      table: [],
      ledFamily: null,
      turn: 0,
      phase: 'play',
    });
    const next = mod.onTimer(s, 'turn', env.ctx);
    expect(next.table).toEqual([{ pid: 'p1', card: c('a2', 'b1') }]);
    expect(next.turn).toBe(1);
    expect(env.timers.get('turn')).toBe(20_000);
    expect(next.turnEndsAt).toBe(20_000);
  });
});

describe('Pli : robots', () => {
  it('le robot ouvre avec sa carte la plus forte', () => {
    const { mod, base } = build();
    const s = situation(base, {
      hands: { p1: [c('a1', 'r1'), c('a2', 'b3')], p2: [] },
      table: [],
      ledFamily: null,
      turn: 0,
    });
    expect(mod.suggest?.(s, 'p1', () => 0.5)).toMatchObject({ type: 'play', payload: { cardId: 'a2' } });
    expect(mod.suggest?.(s, 'p2', () => 0.5)).toBeNull();
  });

  it('le robot prend le pli avec la plus faible carte qui gagne, sinon joue sa plus faible', () => {
    const { mod, base } = build(withAtout);
    const winning = situation(base, {
      hands: { p1: [c('a1', 'b1'), c('a2', 'b3')], p2: [] },
      table: [{ pid: 'p2', card: c('x1', 'r3') }],
      ledFamily: 'rouge',
      turn: 0,
    });
    expect(mod.suggest?.(winning, 'p1', () => 0.5)).toMatchObject({ payload: { cardId: 'a1' } });

    const losing = situation(base, {
      hands: { p1: [c('a1', 'r1')], p2: [] },
      table: [{ pid: 'p2', card: c('x1', 'r3') }],
      ledFamily: 'rouge',
      turn: 0,
    });
    expect(mod.suggest?.(losing, 'p1', () => 0.5)).toMatchObject({ payload: { cardId: 'a1' } });
  });
});
