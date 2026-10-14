import { describe, expect, it } from 'vitest';
import { cardGameDefinitionSchema, type CardGameDefinition, type GameContext, type PlayerRef } from '@partyhub/shared';
import { createCardGame, canPlayCard, cardGamePresets } from '@partyhub/games';

/** Générateur pseudo-aléatoire reproductible (graine fixe). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCtx(connected: string[], random = seeded(7)) {
  const clock = { t: 1_000_000 };
  const timers = new Map<string, number>();
  let live = connected;
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random,
    connectedPlayerIds: () => live,
  };
  return { ctx, clock, timers, setConnected: (ids: string[]) => (live = ids) };
}

const P = (id: string): PlayerRef => ({ id, name: id.toUpperCase() });

function setup(def: CardGameDefinition, players: PlayerRef[], settings: Record<string, unknown> = {}) {
  const mod = createCardGame(def, { id: 'test-cards' });
  const h = makeCtx(players.map((p) => p.id));
  const init = mod.initialize(mod.settingsSchema.parse({ ...mod.defaultSettings, ...settings }), players, h.ctx);
  const res = mod.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  return { mod, state: res.state, ...h };
}

/** Petit jeu de test : deux familles, un joker, quelques effets. */
const SMALL: CardGameDefinition = {
  name: 'Test',
  description: 'Jeu de test',
  icon: '🧪',
  theme: 'arcade',
  families: [
    { id: 'r', label: 'Rouge', color: '#ff0000' },
    { id: 'b', label: 'Bleu', color: '#0000ff' },
  ],
  cards: [
    { id: 'r1', label: 'Rouge 1', symbol: '1', family: 'r', effect: 'none', count: 6, points: 1 },
    { id: 'b1', label: 'Bleu 1', symbol: '1', family: 'b', effect: 'none', count: 6, points: 1 },
    { id: 'rs', label: 'Passe', symbol: '⊘', family: 'r', effect: 'skip', count: 4, points: 20 },
    { id: 'wk', label: 'Joker', symbol: '★', family: 'wild', effect: 'wild', count: 4, points: 50 },
  ],
  rules: { minPlayers: 2, maxPlayers: 3, handSize: 4, matchOn: 'family', targetScore: 50, turnSeconds: 0 },
  notice: { goal: 'Test', steps: ['Jouer'], tips: [] },
};

describe('schéma des jeux de cartes', () => {
  it('valide les deux jeux intégrés', () => {
    expect(cardGameDefinitionSchema.safeParse(cardGamePresets['cartes-couleurs']).success).toBe(true);
    expect(cardGameDefinitionSchema.safeParse(cardGamePresets['cartes-coco']).success).toBe(true);
  });

  it('refuse une famille inconnue, un joker mal configuré et un paquet trop petit', () => {
    const unknownFamily = { ...SMALL, cards: [{ ...SMALL.cards[0]!, family: 'z' }, SMALL.cards[3]!] };
    expect(cardGameDefinitionSchema.safeParse(unknownFamily).success).toBe(false);

    const badWild = { ...SMALL, cards: [{ ...SMALL.cards[3]!, family: 'r' }, SMALL.cards[0]!] };
    expect(cardGameDefinitionSchema.safeParse(badWild).success).toBe(false);

    const tooSmall = { ...SMALL, cards: [{ ...SMALL.cards[0]!, count: 2 }] };
    const res = cardGameDefinitionSchema.safeParse(tooSmall);
    expect(res.success).toBe(false);
  });
});

describe('moteur des jeux de cartes', () => {
  it('distribue la main et retourne une carte de départ simple', () => {
    const { state } = setup(SMALL, [P('a'), P('b')]);
    expect(state.hands['a']).toHaveLength(4);
    expect(state.hands['b']).toHaveLength(4);
    expect(state.discard).toHaveLength(1);
    expect(state.discard[0]!.entry).toMatch(/^r1|^b1/);
    // 20 cartes au total : 4 + 4 en mains, 1 en défausse, le reste dans la pioche.
    expect(state.draw.length).toBe(11);
  });

  it('refuse un jeu à moins de joueurs que le minimum', () => {
    const mod = createCardGame(SMALL, { id: 'test-cards' });
    const h = makeCtx(['a']);
    const init = mod.initialize(mod.defaultSettings, [P('a')], h.ctx);
    expect(mod.start(init, h.ctx).ok).toBe(false);
  });

  it('pose une carte jouable, puis passe le tour au joueur suivant', () => {
    const { mod, state, ctx } = setup(SMALL, [P('a'), P('b')]);
    const top = state.discard[0]!;
    const topEntry = SMALL.cards.find((c) => c.id === top.entry)!;
    const mine = state.hands['a']!.find((c) => canPlayCard(state, SMALL.cards.find((e) => e.id === c.entry)!));
    if (!mine) {
      // Pas de carte jouable : la pioche puis le passage suffisent.
      const drew = mod.handleAction(state, P('a'), 'draw', undefined, ctx);
      expect(drew.ok).toBe(true);
      const passed = mod.handleAction(drew.ok ? drew.state : state, P('a'), 'pass', undefined, ctx);
      expect(passed.ok).toBe(true);
      return;
    }
    const played = mod.handleAction(state, P('a'), 'play', { cardId: mine.uid }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.discard.at(-1)!.uid).toBe(mine.uid);
    expect(played.state.hands['a']!.some((c) => c.uid === mine.uid)).toBe(false);
    expect(played.state.order[played.state.turn]).toBe('b');
    expect(topEntry).toBeDefined();
  });

  it('refuse de jouer hors de son tour et de passer sans avoir pioché', () => {
    const { mod, state, ctx } = setup(SMALL, [P('a'), P('b')]);
    expect(mod.handleAction(state, P('b'), 'draw', undefined, ctx).ok).toBe(false);
    expect(mod.handleAction(state, P('a'), 'pass', undefined, ctx).ok).toBe(false);
  });

  it('une carte joker impose le choix de la famille', () => {
    const { mod, state, ctx } = setup(SMALL, [P('a'), P('b')]);
    const wild = {
      ...state,
      hands: { ...state.hands, a: [{ uid: 'test-wild', entry: 'wk' }, ...state.hands['a']!.slice(1)] },
    };
    const played = mod.handleAction(wild, P('a'), 'play', { cardId: 'test-wild' }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.phase).toBe('pick-family');
    expect(played.state.picker).toBe('a');
    // Le joueur suivant ne peut rien faire tant que la famille n'est pas choisie.
    expect(mod.handleAction(played.state, P('b'), 'draw', undefined, ctx).ok).toBe(false);
    const chosen = mod.handleAction(played.state, P('a'), 'choose-family', { family: 'b' }, ctx);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(chosen.state.family).toBe('b');
    expect(chosen.state.phase).toBe('play');
    expect(chosen.state.order[chosen.state.turn]).toBe('b');
  });

  it('un passe fait sauter le joueur suivant', () => {
    const { mod, state, ctx } = setup(SMALL, [P('a'), P('b'), P('c')]);
    const withSkip = {
      ...state,
      turn: 0,
      family: 'r',
      discard: [{ uid: 'top', entry: 'r1' }],
      hands: { ...state.hands, a: [{ uid: 'skip-1', entry: 'rs' }, ...state.hands['a']!.slice(1)] },
    };
    const played = mod.handleAction(withSkip, P('a'), 'play', { cardId: 'skip-1' }, ctx);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.order[played.state.turn]).toBe('c');
    expect(played.state.lastEvent).toContain('B');
  });

  it('la première main vidée termine la manche, marque les points et propose la suite', () => {
    const { mod, state, ctx, timers } = setup(SMALL, [P('a'), P('b')], { targetScore: 500 });
    const alone = {
      ...state,
      turn: 0,
      family: 'r',
      discard: [{ uid: 'top', entry: 'r1' }],
      hands: {
        a: [{ uid: 'last', entry: 'r1' }],
        b: [
          { uid: 'x', entry: 'rs' },
          { uid: 'y', entry: 'wk' },
        ],
      },
    };
    const res = mod.handleAction(alone, P('a'), 'play', { cardId: 'last' }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toBe('round-over');
    expect(res.state.scores['a']).toBe(70);
    expect(timers.has('next-round')).toBe(true);
    const next = mod.nextRound(res.state, ctx);
    expect(next.phase).toBe('play');
    expect(next.round).toBe(2);
    expect(next.order[next.turn]).toBe('a');
  });

  it('termine la partie dès qu’un score atteint l’objectif', () => {
    const { mod, state, ctx } = setup(SMALL, [P('a'), P('b')], { targetScore: 50 });
    const big = {
      ...state,
      turn: 0,
      family: 'r',
      discard: [{ uid: 'top', entry: 'r1' }],
      hands: {
        a: [{ uid: 'last', entry: 'r1' }],
        b: [
          { uid: 'x', entry: 'wk' },
          { uid: 'y', entry: 'wk' },
          { uid: 'z', entry: 'wk' },
        ],
      },
    };
    const res = mod.handleAction(big, P('a'), 'play', { cardId: 'last' }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toBe('final');
    expect(mod.isFinished(res.state)).toBe(true);
    expect(mod.calculateScores(res.state)[0]!.playerId).toBe('a');
  });

  it('le temps écoulé pioche puis passe automatiquement', () => {
    const { mod, state, ctx } = setup({ ...SMALL, rules: { ...SMALL.rules, turnSeconds: 15 } }, [P('a'), P('b')]);
    const before = state.hands['a']!.length;
    const after = mod.onTimer(state, 'turn', ctx);
    expect(after.hands['a']!.length).toBe(before + (state.draw.length > 0 ? 1 : 0));
    expect(after.order[after.turn]).toBe('b');
  });

  it('un robot peut mener une partie jusqu’au bout sans bloquer', () => {
    const def: CardGameDefinition = { ...SMALL, rules: { ...SMALL.rules, targetScore: 80 } };
    const players = [P('a'), P('b'), P('c')];
    const random = seeded(2024);
    const { mod, state: start0, ctx } = setup(def, players, { targetScore: 80 });
    let state = start0;
    let steps = 0;
    while (!mod.isFinished(state) && steps < 4000) {
      steps++;
      if (state.phase === 'round-over') {
        state = mod.nextRound(state, ctx);
        continue;
      }
      const actor = state.phase === 'pick-family' && state.picker ? state.picker : state.order[state.turn]!;
      const suggestion = mod.suggest?.(state, actor, random);
      expect(suggestion, `le robot ${actor} doit proposer une action`).toBeTruthy();
      const res = mod.handleAction(state, P(actor), suggestion!.type, suggestion!.payload, ctx);
      expect(res.ok, res.ok ? '' : res.error).toBe(true);
      if (res.ok) state = res.state;
    }
    expect(mod.isFinished(state)).toBe(true);
    const total = Object.values(state.scores).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(80);
  });
});

describe('jeux intégrés joués par des robots', () => {
  for (const key of ['cartes-couleurs', 'cartes-coco'] as const) {
    it(`${key} : une partie à 4 joueurs se termine sans blocage`, () => {
      const def = cardGamePresets[key];
      const players = [P('a'), P('b'), P('c'), P('d')];
      const random = seeded(99);
      const { mod, state: start0, ctx } = setup(def, players, { targetScore: 120 });
      let state = start0;
      let steps = 0;
      while (!mod.isFinished(state) && steps < 20000) {
        steps++;
        if (state.phase === 'round-over') {
          state = mod.nextRound(state, ctx);
          continue;
        }
        const actor = state.phase === 'pick-family' && state.picker ? state.picker : state.order[state.turn]!;
        const suggestion = mod.suggest?.(state, actor, random);
        expect(suggestion, `le robot ${actor} doit proposer une action`).toBeTruthy();
        const res = mod.handleAction(state, P(actor), suggestion!.type, suggestion!.payload, ctx);
        expect(res.ok, res.ok ? '' : res.error).toBe(true);
        if (res.ok) state = res.state;
      }
      expect(mod.isFinished(state), `partie non terminée après ${steps} actions`).toBe(true);
      expect(state.round).toBeGreaterThan(1);
    });
  }
});
