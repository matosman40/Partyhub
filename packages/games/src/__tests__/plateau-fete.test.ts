import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { plateauFete, type PlateauState } from '../plateau-fete/module.js';
import {
  DEFIS,
  DEPART_BONUS,
  EVENTS,
  KINDS,
  MINIGAME_EVERY,
  PAYOUTS,
  RING,
  STAR_COST,
  STAR_COUNT,
  STAR_SPOTS,
  TIMING,
  TURNS,
  competitionRanks,
  drawEvent,
  estimatedMinutes,
  kindAt,
  miniGameCount,
  payoutFor,
  standings,
  walk,
  wrap,
} from '../plateau-fete/rules.js';

/** Horloge de test : les minuteurs se déclenchent quand on le demande. */
function clock(players: string[], seed = 7) {
  let now = 1_000_000;
  const timers = new Map<string, number>();
  let rng = seed;
  const random = () => {
    rng = (rng * 16807) % 2147483647;
    return rng / 2147483647;
  };
  const ctx: GameContext = {
    now: () => now,
    schedule: (key, ms) => void timers.set(key, now + ms),
    cancel: (key) => void timers.delete(key),
    random,
    connectedPlayerIds: () => players,
  };
  return {
    ctx,
    timers,
    now: () => now,
    /** Avance l’horloge jusqu’à l’échéance du minuteur, puis le déclenche, comme la salle le ferait. */
    fire(state: PlateauState): PlateauState {
      const due = timers.get('next');
      if (due === undefined) throw new Error('aucun minuteur armé');
      now = Math.max(now, due);
      timers.delete('next');
      return plateauFete.onTimer(state, 'next', ctx);
    },
  };
}

const ANA: PlayerRef = { id: 'ana', name: 'Ana' };
const LEO: PlayerRef = { id: 'leo', name: 'Léo' };
const NOA: PlayerRef = { id: 'noa', name: 'Noa' };

function started(players: PlayerRef[] = [ANA, LEO]) {
  const c = clock(players.map((p) => p.id));
  const init = plateauFete.initialize({}, players, c.ctx);
  const r = plateauFete.start(init, c.ctx);
  if (!r.ok) throw new Error(r.error);
  return { c, s: r.state };
}

/** Joue un tour complet pour le premier tour : banderole, puis tout le monde lance. */
function toRoll(c: ReturnType<typeof clock>, s: PlateauState): PlateauState {
  let state = c.fire(s); // intro → banderole du tour 1
  state = c.fire(state); // banderole → lancer
  return state;
}

function act(
  c: ReturnType<typeof clock>,
  s: PlateauState,
  player: PlayerRef,
  type: string,
  payload?: unknown,
): PlateauState {
  const r = plateauFete.handleAction(s, player, type, payload, c.ctx);
  if (!r.ok) throw new Error(`${type} refusé : ${r.error}`);
  return r.state;
}

describe('plateau fête : le plateau', () => {
  it('est un anneau de 60 cases, avec un départ tous les 12 pas', () => {
    expect(KINDS).toHaveLength(RING);
    const departs = KINDS.flatMap((k, i) => (k === 'depart' ? [i] : []));
    expect(departs).toEqual([0, 12, 24, 36, 48]);
  });

  it('place l’étoile seulement sur une case ordinaire ou à pièces', () => {
    expect(STAR_SPOTS.length).toBeGreaterThan(10);
    for (const cell of STAR_SPOTS) {
      expect(['normal', 'pieces']).toContain(kindAt(cell));
    }
  });

  it('ramène toute distance dans l’anneau, même négative', () => {
    expect(wrap(0)).toBe(0);
    expect(wrap(RING)).toBe(0);
    expect(wrap(-1)).toBe(RING - 1);
    expect(wrap(-RING - 3)).toBe(RING - 3);
  });

  it('compte la prime de chaque départ franchi en avançant, mais pas en reculant', () => {
    // De la case 10 à la case 15 : on franchit la case 12 (départ).
    const forward = walk(10, 5);
    expect(forward.to).toBe(15);
    expect(forward.path).toEqual([11, 12, 13, 14, 15]);
    expect(forward.bonus).toBe(DEPART_BONUS);
    // Reculer de 3 depuis 13 : aucune prime, et le chemin descend.
    const back = walk(13, -3);
    expect(back.path).toEqual([12, 11, 10]);
    expect(back.bonus).toBe(0);
  });

  it('tire une carte d’événement selon son poids', () => {
    expect(drawEvent(() => 0).id).toBe(EVENTS[0]!.id);
    expect(drawEvent(() => 0.999).id).toBe(EVENTS[EVENTS.length - 1]!.id);
    const seen = new Set<string>();
    let rng = 3;
    for (let i = 0; i < 400; i++) {
      rng = (rng * 16807) % 2147483647;
      seen.add(drawEvent(() => rng / 2147483647).id);
    }
    expect(seen.size).toBe(EVENTS.length);
  });
});

describe('plateau fête : classements et pièces', () => {
  it('donne 10, 6, 4 et 2 pièces aux quatre premiers, la participation ensuite', () => {
    expect(PAYOUTS).toEqual([10, 6, 4, 2]);
    expect(payoutFor(1)).toBe(10);
    expect(payoutFor(4)).toBe(2);
    expect(payoutFor(5)).toBe(1);
  });

  it('partage le même rang entre ex æquo, et saute le rang suivant', () => {
    const ranks = competitionRanks(['a', 'b', 'c'], { a: 5, b: 9, c: 5 });
    expect(ranks).toEqual({ b: 1, a: 2, c: 2 });
  });

  it('classe les étoiles d’abord, puis les pièces', () => {
    // b et c ont deux étoiles : les pièces départagent (9 contre 3), puis a, avec une seule étoile.
    const rows = standings(['a', 'b', 'c'], { a: 1, b: 2, c: 2 }, { a: 50, b: 3, c: 9 });
    expect(rows.map((r) => [r.id, r.rank])).toEqual([
      ['c', 1],
      ['b', 2],
      ['a', 3],
    ]);
    // Deux ex æquo réels (mêmes étoiles et mêmes pièces) partagent le rang.
    const tied = standings(['x', 'y'], { x: 1, y: 1 }, { x: 4, y: 4 });
    expect(tied.map((r) => r.rank)).toEqual([1, 1]);
  });
});

describe('plateau fête : durée', () => {
  it('annonce environ 25 minutes, avec 40 tours et 13 mini-jeux', () => {
    expect(TURNS).toBe(40);
    expect(miniGameCount()).toBe(13);
    expect(Math.floor((TURNS - 1) / MINIGAME_EVERY)).toBe(miniGameCount());
    const minutes = estimatedMinutes();
    expect(minutes).toBeGreaterThanOrEqual(24);
    expect(minutes).toBeLessThanOrEqual(26);
    expect(plateauFete.manifest.durationMin).toBe(minutes);
  });

  it('a un maximum de temps par phase, compatible avec la durée annoncée', () => {
    const worstTurn = TIMING.banner + TIMING.rollMax + TIMING.move + TIMING.choiceMax + TIMING.resolve;
    expect(worstTurn).toBeLessThan(40_000);
    expect(DEFIS).toBe(5);
  });
});

describe('plateau fête : la partie', () => {
  it('démarre à deux joueurs au moins', () => {
    const c = clock(['ana']);
    const init = plateauFete.initialize({}, [ANA], c.ctx);
    expect(plateauFete.start(init, c.ctx).ok).toBe(false);
  });

  it('chaque joueur lance une fois par tour, et le second lancer est refusé', () => {
    const { c, s } = started();
    let state = toRoll(c, s);
    expect(state.phase).toBe('roll');
    state = act(c, state, ANA, 'roll');
    expect(state.phase).toBe('roll');
    expect(plateauFete.handleAction(state, ANA, 'roll', undefined, c.ctx).ok).toBe(false);
  });

  it('passe au déplacement dès que tous les joueurs connectés ont lancé', () => {
    const { c, s } = started();
    let state = toRoll(c, s);
    state = act(c, state, ANA, 'roll');
    state = act(c, state, LEO, 'roll');
    state = c.fire(state); // le lancer dure au moins quatre secondes
    expect(state.phase).toBe('move');
    expect(state.moves.map((m) => m.id).sort()).toEqual(['ana', 'leo']);
    for (const m of state.moves) {
      expect(m.roll).toBeGreaterThanOrEqual(1);
      expect(m.roll).toBeLessThanOrEqual(6);
      expect(m.path.at(-1)).toBe(m.to);
    }
  });

  it('garde le lancer ouvert au moins quatre secondes, même si tout le monde a lancé', () => {
    const { c, s } = started();
    let state = toRoll(c, s);
    state = act(c, state, ANA, 'roll');
    state = act(c, state, LEO, 'roll');
    expect(state.phase).toBe('roll');
    state = c.fire(state);
    expect(state.phase).toBe('move');
  });

  it('ne révèle les dés des autres qu’après le lancer, pas pendant le lancer', () => {
    const { c, s } = started();
    let state = toRoll(c, s);
    state = act(c, state, ANA, 'roll');
    const view = plateauFete.getPublicState(state) as {
      players: { id: string; rolled: boolean; roll: number | null }[];
      waiting: string[];
    };
    expect(view.players.find((p) => p.id === 'ana')?.rolled).toBe(true);
    expect(view.players.every((p) => p.roll === null)).toBe(true);
    expect(view.waiting).toEqual(['Léo']);
    const mine = plateauFete.getPlayerState(state, 'ana') as { roll: number | null };
    expect(mine.roll).not.toBeNull();
    const theirs = plateauFete.getPlayerState(state, 'leo') as { roll: number | null };
    expect(theirs.roll).toBeNull();
  });

  it('lance le dé à la place des joueurs qui ne répondent pas à temps', () => {
    const { c, s } = started([ANA, LEO, NOA]);
    let state = toRoll(c, s);
    state = act(c, state, ANA, 'roll');
    state = c.fire(state);
    expect(state.phase).toBe('move');
    expect(Object.keys(state.rolls).sort()).toEqual(['ana', 'leo', 'noa']);
  });

  it('annonce la distance parcourue, et la case modulo l’anneau', () => {
    const { c, s } = started();
    let state = toRoll(c, s);
    state = act(c, state, ANA, 'roll');
    state = act(c, state, LEO, 'roll');
    state = c.fire(state);
    for (const id of ['ana', 'leo']) {
      const dist = state.dist[id] ?? -1;
      const view = plateauFete.getPlayerState(state, id) as { cell: number };
      expect(view.cell).toBe(wrap(dist));
      expect(dist).toBeGreaterThan(0);
    }
  });

  it('refuse un choix qui n’est pas proposé, et accepte le bon', () => {
    const { c, s } = started();
    let state = toRoll(c, s);
    state = act(c, state, ANA, 'roll');
    state = act(c, state, LEO, 'roll');
    // Forcer une situation de choix : le test ne dépend pas du tirage.
    state = {
      ...state,
      phase: 'choice',
      pending: { ana: { kind: 'etoile', title: 'Étoile', cell: state.starCells[0] } },
      coins: { ...state.coins, ana: STAR_COST + 5 },
    };
    expect(plateauFete.handleAction(state, ANA, 'choose', { choice: 'risque' }, c.ctx).ok).toBe(false);
    expect(plateauFete.handleAction(state, LEO, 'choose', { choice: 'acheter' }, c.ctx).ok).toBe(false);
    state = act(c, state, ANA, 'choose', { choice: 'acheter' });
    expect(state.stars.ana).toBe(1);
    expect(state.coins.ana).toBe(5);
    expect(state.pending).toEqual({});
  });

  it('déplace seulement l’étoile achetée, sur une autre case libre', () => {
    const { c, s } = started();
    expect(s.starCells).toHaveLength(STAR_COUNT);
    const [bought, ...others] = s.starCells;
    let state: PlateauState = {
      ...s,
      phase: 'choice',
      pending: { ana: { kind: 'etoile', title: 'Étoile', cell: bought } },
      coins: { ...s.coins, ana: STAR_COST },
    };
    state = act(c, state, ANA, 'choose', { choice: 'acheter' });
    expect(state.stars.ana).toBe(1);
    expect(state.starCells).not.toContain(bought);
    expect(state.starCells.slice(1)).toEqual(others);
    expect(new Set(state.starCells).size).toBe(STAR_COUNT);
    for (const cell of state.starCells) expect(STAR_SPOTS).toContain(cell);
  });

  it('place trois étoiles différentes sur des cases d’étoile', () => {
    const { s } = started();
    expect(new Set(s.starCells).size).toBe(STAR_COUNT);
    for (const cell of s.starCells) expect(STAR_SPOTS).toContain(cell);
  });

  it('garde les pièces si le joueur refuse l’étoile, ou s’il ne répond pas', () => {
    const { c, s } = started();
    let state: PlateauState = {
      ...s,
      phase: 'choice',
      pending: { ana: { kind: 'etoile', title: 'Étoile' } },
      coins: { ...s.coins, ana: STAR_COST },
    };
    state = c.fire({ ...state, nextAt: 0 });
    expect(state.stars.ana ?? 0).toBe(0);
    expect(state.coins.ana).toBe(STAR_COST);
  });

  it('distribue les pièces du classement d’un mini-jeu, puis reprend le plateau', () => {
    const { c, s } = started();
    let state: PlateauState = {
      ...s,
      turn: 3,
      phase: 'mg-reveal',
      mg: {
        number: 1,
        sequence: ['secousse', 'equilibre', 'tour', 'souffle', 'tapote'],
        round: DEFIS - 1,
        startedAt: 0,
        submissions: {},
        points: { ana: 300, leo: 120 },
        reveal: null,
        payouts: null,
      },
    };
    state = c.fire(state);
    expect(state.phase).toBe('mg-results');
    expect(state.mg?.payouts).toEqual({ ana: 10, leo: 6 });
    expect(state.coins.ana).toBe(s.coins.ana! + 10);
    state = c.fire(state);
    expect(state.phase).toBe('banner');
    expect(state.turn).toBe(4);
  });

  it('ne donne pas de pièces à un joueur qui n’a rien réussi', () => {
    const { c, s } = started();
    let state: PlateauState = {
      ...s,
      turn: 3,
      phase: 'mg-reveal',
      mg: {
        number: 1,
        sequence: ['secousse', 'equilibre', 'tour', 'souffle', 'tapote'],
        round: DEFIS - 1,
        startedAt: 0,
        submissions: {},
        points: { ana: 0, leo: 0 },
        reveal: null,
        payouts: null,
      },
    };
    state = c.fire(state);
    expect(state.mg?.payouts).toEqual({ ana: 1, leo: 1 });
  });

  it('cache les réponses des autres pendant un défi, puis les montre au bilan', () => {
    const { c, s } = started();
    let state: PlateauState = {
      ...s,
      turn: 3,
      phase: 'mg-play',
      mg: {
        number: 1,
        sequence: ['secousse', 'equilibre', 'tour', 'souffle', 'tapote'],
        round: 0,
        startedAt: c.now(),
        submissions: {},
        points: { ana: 0, leo: 0 },
        reveal: null,
        payouts: null,
      },
    };
    state = act(c, state, ANA, 'done', { value: 2 });
    const hidden = plateauFete.getPublicState(state) as { mini: { submitted: string[]; reveal: unknown } };
    expect(hidden.mini.submitted).toEqual(['ana']);
    expect(hidden.mini.reveal).toBeNull();
    const mine = plateauFete.getPlayerState(state, 'leo') as { mini: { reveal: unknown } };
    expect(mine.mini.reveal).toBeNull();
  });

  it('termine après le dernier tour, et classe les joueurs', () => {
    const { c, s } = started();
    const state: PlateauState = {
      ...s,
      turn: TURNS,
      phase: 'resolve',
      stars: { ana: 2, leo: 3 },
      coins: { ana: 40, leo: 1 },
    };
    const next = c.fire(state);
    expect(next.phase).toBe('final');
    expect(plateauFete.isFinished(next)).toBe(true);
    const scores = plateauFete.calculateScores(next);
    expect(scores.map((e) => [e.name, e.rank])).toEqual([
      ['Léo', 1],
      ['Ana', 2],
    ]);
  });

  it('ne laisse jamais un joueur sans réponse bloquer une manche', () => {
    const { c, s } = started([ANA, LEO]);
    let state = toRoll(c, s);
    state = c.fire(state);
    expect(state.phase).toBe('move');
  });

  it('a un bot par décision, qui agit une seule fois', () => {
    const { c, s } = started();
    const state = toRoll(c, s);
    const first = plateauFete.suggest?.(state, 'ana', () => 0.5, c.now());
    expect(first?.type).toBe('roll');
    const after = act(c, state, ANA, 'roll');
    expect(plateauFete.suggest?.(after, 'ana', () => 0.5, c.now())).toBeNull();
  });
});

describe('plateau fête : une partie complète', () => {
  /** Joue la partie en laissant les robots répondre à chaque phase, et renvoie la durée simulée. */
  function playBots(players: PlayerRef[], seed: number) {
    const { c, s: start } = started(players);
    let state = start;
    const t0 = c.now();
    let guard = 0;
    while (state.phase !== 'final') {
      if (guard++ > 20_000) throw new Error('la partie ne se termine pas');
      for (const p of players) {
        const suggestion = plateauFete.suggest?.(
          state,
          p.id,
          () => ((seed * 9301 + guard * 49297) % 233280) / 233280,
          c.now(),
        );
        if (!suggestion) continue;
        const r = plateauFete.handleAction(state, p, suggestion.type, suggestion.payload, c.ctx);
        if (r.ok) state = r.state;
      }
      if (state.phase === 'final') break;
      state = c.fire(state);
    }
    return { state, minutes: (c.now() - t0) / 60000 };
  }

  it('se termine avec des robots, à deux, à quatre et à huit', () => {
    for (const count of [2, 4, 8]) {
      const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
      const { state, minutes } = playBots(players, count);
      expect(state.phase).toBe('final');
      expect(state.turn).toBe(TURNS);
      expect(minutes).toBeLessThan(40);
      // Chacun a avancé : aucun pion n’est resté sur le départ.
      for (const p of players) expect(state.dist[p.id]).toBeGreaterThan(0);
    }
  });

  it('ne dépasse jamais le nombre de mini-jeux prévu', () => {
    const players = [ANA, LEO];
    const { state } = playBots(players, 11);
    expect(state.mg === null || state.mg.number <= miniGameCount()).toBe(true);
  });
});
