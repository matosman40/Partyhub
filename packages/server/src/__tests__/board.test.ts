import { describe, expect, it } from 'vitest';
import { boardRanking, boardRollDice, createBoardGame, type BoardState } from '@partyhub/games';
import {
  boardGameDefinitionSchema,
  type BoardCell,
  type BoardGameDefinition,
  type GameContext,
  type PlayerRef,
} from '@partyhub/shared';

/** Contexte déterministe : les valeurs de `randoms` sont consommées dans l'ordre (puis 0.5). */
function makeCtx(randoms: number[] = [], connected: string[] = []) {
  const queue = [...randoms];
  const timers = new Map<string, number>();
  const ctx: GameContext & { timers: Map<string, number> } = {
    now: () => 1_000,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random: () => (queue.length ? queue.shift()! : 0.5),
    connectedPlayerIds: () => connected,
    timers,
  };
  return ctx;
}

/** Valeur de dé (1 à 6) produite par le générateur : position au milieu de la face. */
const die = (v: number) => (v - 1) / 6 + 0.01;

const N = (label = ''): BoardCell => ({ label, kind: 'normal', value: 0 });
const A = (): BoardCell => ({ label: 'Arrivée', kind: 'arrivee', value: 0 });

/** Parcours : départ, cases du milieu, puis remplissage de cases normales jusqu'à `length`, arrivée. */
function track(middle: BoardCell[] = [], length = 8): BoardCell[] {
  const body = [...middle];
  while (body.length + 2 < length) body.push(N());
  return [N('Départ'), ...body, A()];
}

function definition(cells: BoardCell[], rules: Partial<BoardGameDefinition['rules']> = {}): BoardGameDefinition {
  return boardGameDefinitionSchema.parse({
    name: 'Test',
    description: 'Plateau de test',
    icon: '🎲',
    theme: 'arcade',
    cells,
    rules: { minPlayers: 2, maxPlayers: 4, dice: 1, turnSeconds: 0, ...rules },
    notice: { goal: 'Arriver.', steps: ['Jouez.'], tips: [] },
  });
}

const alice: PlayerRef = { id: 'a', name: 'Alice' };
const bob: PlayerRef = { id: 'b', name: 'Bob' };
const cara: PlayerRef = { id: 'c', name: 'Cara' };

/** Lance la partie, en exigeant que le départ réussisse. */
function started(game: ReturnType<typeof createBoardGame>, state: BoardState, ctx: GameContext): BoardState {
  const res = game.start(state, ctx);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

function setup(cells: BoardCell[], rules: Partial<BoardGameDefinition['rules']> = {}, players = [alice, bob]) {
  const def = definition(cells, rules);
  const game = createBoardGame(def, { id: 'board-test' });
  const ctx = makeCtx();
  return { game, ctx, state: started(game, game.initialize(game.defaultSettings, players, ctx), ctx) };
}

function roll(game: ReturnType<typeof createBoardGame>, state: BoardState, player: PlayerRef, ctx: GameContext) {
  const res = game.handleAction(state, player, 'roll', undefined, ctx);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe('définition d’un plateau', () => {
  it('accepte un parcours valide', () => {
    expect(() => definition(track([{ label: 'Bonus', kind: 'gain', value: 2 }]))).not.toThrow();
  });

  it('refuse un parcours trop court', () => {
    expect(() => definition([N('Départ'), N(), N(), N(), N(), N(), A()])).toThrow('Il faut au moins 8 cases.');
  });

  it('exige un départ normal et une arrivée en dernière case', () => {
    const noStart = [{ label: 'x', kind: 'avance', value: 1 } as BoardCell, ...track().slice(1)];
    expect(() => definition(noStart)).toThrow('départ');
    const noGoal = [...track().slice(0, -1), N()];
    expect(() => definition(noGoal)).toThrow('arrivée');
  });

  it('refuse une arrivée au milieu et une valeur manquante', () => {
    const cells = track([A()]);
    expect(() => definition(cells)).toThrow('dernière');
    expect(() => definition(track([{ label: 'Bonus', kind: 'gain', value: 0 }]))).toThrow('Valeur requise');
  });

  it('refuse un minimum de joueurs supérieur au maximum', () => {
    expect(() => definition(track(), { minPlayers: 4, maxPlayers: 2 })).toThrow('Le minimum dépasse le maximum.');
  });
});

describe('dés', () => {
  it('somme le nombre de dés demandé', () => {
    expect(boardRollDice(2, () => 0.9)).toEqual([6, 6]);
    expect(boardRollDice(1, () => 0)).toEqual([1]);
  });
});

describe('déroulement d’une partie', () => {
  it('démarre seulement avec le nombre minimum de joueurs', () => {
    const def = definition(track(), { minPlayers: 3, maxPlayers: 4 });
    const game = createBoardGame(def, { id: 'board-test' });
    const ctx = makeCtx();
    const state = game.initialize(game.defaultSettings, [alice, bob], ctx);
    expect(game.start(state, ctx).ok).toBe(false);
  });

  it('avance le pion du total des dés, et seul le joueur courant peut lancer', () => {
    const cells = track();
    const def = definition(cells, { dice: 2 });
    const game = createBoardGame(def, { id: 'board-test' });
    const ctx = makeCtx([die(2), die(3)]);
    let state = started(game, game.initialize(game.defaultSettings, [alice, bob], ctx), ctx);

    const refused = game.handleAction(state, bob, 'roll', undefined, ctx);
    expect(refused).toEqual({ ok: false, error: "Ce n'est pas votre tour." });

    state = roll(game, state, alice, ctx);
    expect(state.positions.a).toBe(5);
    expect(state.positions.b).toBe(0);
    expect(state.order[state.turn]).toBe('b');
  });

  it('applique l’effet d’une case d’avance', () => {
    const { game, ctx, state } = setup(track([N(), { label: 'Tremplin', kind: 'avance', value: 2 }]));
    const rolled = game.handleAction(state, alice, 'roll', undefined, makeCtx([die(2)]));
    if (!rolled.ok) throw new Error(rolled.error);
    expect(rolled.state.positions.a).toBe(4);
    expect(rolled.state.lastRoll?.event).toContain('Avance');
    expect(ctx).toBeDefined();
  });

  it('ne recule jamais avant le départ', () => {
    const { game, state } = setup(track([{ label: 'Glissade', kind: 'recule', value: 5 }]));
    const next = game.handleAction(state, alice, 'roll', undefined, makeCtx([die(1)]));
    if (!next.ok) throw new Error(next.error);
    expect(next.state.positions.a).toBe(0);
  });

  it('gagne et perd des points', () => {
    const cells = track([
      { label: 'Trésor', kind: 'gain', value: 3 },
      { label: 'Amende', kind: 'perte', value: 1 },
    ]);
    const { game, state } = setup(cells);
    const gained = game.handleAction(state, alice, 'roll', undefined, makeCtx([die(1)]));
    if (!gained.ok) throw new Error(gained.error);
    expect(gained.state.scores.a).toBe(3);

    // Alice a tenu la case du trésor (position 1) ; Bob tombe sur la case d’amende (position 2).
    const lost = game.handleAction(gained.state, bob, 'roll', undefined, makeCtx([die(2)]));
    if (!lost.ok) throw new Error(lost.error);
    expect(lost.state.scores.b).toBe(-1);
  });

  it('fait passer le prochain tour après une case de pause', () => {
    const cells = track([{ label: 'Pause', kind: 'passe', value: 0 }]);
    const { game, state } = setup(cells);
    // Alice tombe sur la pause (case 1) : elle passera son prochain tour.
    let s = game.handleAction(state, alice, 'roll', undefined, makeCtx([die(1)]));
    if (!s.ok) throw new Error(s.error);
    expect(s.state.skip.a).toBe(true);
    expect(s.state.order[s.state.turn]).toBe('b');

    // Bob joue (case 2, sans effet) : Alice est sautée, c'est de nouveau à Bob.
    s = game.handleAction(s.state, bob, 'roll', undefined, makeCtx([die(2)]));
    if (!s.ok) throw new Error(s.error);
    expect(s.state.skip.a).toBe(false);
    expect(s.state.order[s.state.turn]).toBe('b');
    expect(s.state.log.join(' ')).toContain('Alice passe son tour');
  });

  it('termine la partie dès la première arrivée', () => {
    const cells = track([], 8);
    const { game, state } = setup(cells);
    // L’arrivée est la case 7. Alice fait 6 puis 6 : le premier tour ne suffit pas.
    let s = game.handleAction(state, alice, 'roll', undefined, makeCtx([die(6)]));
    if (!s.ok) throw new Error(s.error);
    expect(s.state.phase).toBe('play');
    s = game.handleAction(s.state, bob, 'roll', undefined, makeCtx([die(1)]));
    if (!s.ok) throw new Error(s.error);
    s = game.handleAction(s.state, alice, 'roll', undefined, makeCtx([die(6)]));
    if (!s.ok) throw new Error(s.error);
    expect(s.state.phase).toBe('final');
    expect(s.state.finished).toEqual(['a']);
    expect(game.isFinished(s.state)).toBe(true);
    const ranking = game.calculateScores(s.state);
    expect(ranking[0]).toMatchObject({ playerId: 'a', rank: 1 });
  });

  it('classe les arrivés avant les autres, puis par case atteinte', () => {
    const cells = track([]);
    const { game } = setup(cells, {}, [alice, bob, cara]);
    const state: BoardState = {
      ...(game.initialize(game.defaultSettings, [alice, bob, cara], makeCtx()) as BoardState),
      phase: 'play',
      positions: { a: 8, b: 5, c: 3 },
      finished: ['a'],
    };
    const rows = boardRanking(state);
    expect(rows.map((r) => r.playerId)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('partage le rang des joueurs à égalité', () => {
    const cells = track([]);
    const { game } = setup(cells, {}, [alice, bob]);
    const state: BoardState = {
      ...(game.initialize(game.defaultSettings, [alice, bob], makeCtx()) as BoardState),
      phase: 'play',
      positions: { a: 4, b: 4 },
    };
    expect(boardRanking(state).map((r) => r.rank)).toEqual([1, 1]);
  });

  it('lance les dés à la place du joueur quand le temps est écoulé', () => {
    const cells = track([]);
    const def = definition(cells, { turnSeconds: 20 });
    const game = createBoardGame(def, { id: 'board-test' });
    const ctx = makeCtx([die(3)]);
    const state = started(game, game.initialize({ turnSeconds: 20 }, [alice, bob], ctx), ctx);
    expect(ctx.timers.get('turn')).toBe(20_000);
    expect(state.turnEndsAt).toBe(21_000);

    const timedOut = game.onTimer(state, 'turn', makeCtx([die(3)]));
    expect(timedOut.positions.a).toBe(3);
    expect(timedOut.order[timedOut.turn]).toBe('b');
    expect(timedOut.log.join(' ')).toContain('Temps écoulé');
  });

  it('ne planifie aucun minuteur sans limite de temps', () => {
    const { ctx, state } = setup(track());
    expect(ctx.timers.has('turn')).toBe(false);
    expect(state.turnEndsAt).toBeNull();
  });

  it('donne les vues publique et privée sans ressource cachée', () => {
    const { game, state } = setup(track());
    const pub = game.getPublicState(state) as { ranking: unknown; current: string };
    expect(pub.ranking).toBeNull();
    expect(pub.current).toBe('a');
    const mine = game.getPlayerState(state, 'a') as { canRoll: boolean; isMyTurn: boolean };
    expect(mine).toMatchObject({ canRoll: true, isMyTurn: true });
    expect(game.getPlayerState(state, 'b')).toMatchObject({ canRoll: false, isMyTurn: false });
  });

  it('propose le lancer au joueur courant seulement', () => {
    const { game, state } = setup(track());
    expect(game.suggest?.(state, 'a', () => 0.5)).toEqual({ type: 'roll', key: 'roll:1' });
    expect(game.suggest?.(state, 'b', () => 0.5)).toBeNull();
  });

  it('se termine proprement quand on l’interrompt', () => {
    const { game, ctx, state } = setup(track());
    const ended = game.end(state, ctx);
    expect(ended.phase).toBe('final');
    expect(ctx.timers.has('turn')).toBe(false);
  });

  it('se joue entièrement avec des robots, sans blocage', () => {
    // Générateur pseudo-aléatoire reproductible (mulberry32).
    let seed = 42;
    const random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const cells = track(
      [
        { label: 'Bonus', kind: 'gain', value: 2 },
        { label: 'Glissade', kind: 'recule', value: 3 },
        { label: 'Pause', kind: 'passe', value: 0 },
        { label: 'Fusée', kind: 'avance', value: 4 },
        { label: 'Péage', kind: 'perte', value: 1 },
      ],
      30,
    );
    const def = definition(cells, { dice: 2 });
    const game = createBoardGame(def, { id: 'board-test' });
    const ctx: GameContext = {
      now: () => 0,
      schedule: () => {},
      cancel: () => {},
      random,
      connectedPlayerIds: () => [],
    };
    const players = [alice, bob, cara];
    let state = started(game, game.initialize(game.defaultSettings, players, ctx), ctx);

    let steps = 0;
    while (!game.isFinished(state) && steps < 5000) {
      const player = players.find((p) => p.id === state.order[state.turn])!;
      const suggestion = game.suggest?.(state, player.id, random);
      expect(suggestion).not.toBeNull();
      const res = game.handleAction(state, player, suggestion!.type, suggestion!.payload, ctx);
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
      steps++;
    }
    expect(game.isFinished(state)).toBe(true);
    expect(state.finished.length).toBeGreaterThanOrEqual(1);
    expect(game.calculateScores(state)[0]?.rank).toBe(1);
  });
});
