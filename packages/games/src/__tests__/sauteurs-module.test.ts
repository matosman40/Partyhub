import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import {
  BETWEEN_MS,
  COUNTDOWN_MS,
  GRACE_MS,
  maxDeaths,
  maxFinishTicks,
  minFinishTicks,
  sauteurs,
  sauteursSettingsSchema,
  scoreLevel,
  type SauteursState,
} from '../sauteurs/module.js';
import { LEVELS, LEVEL_MAX_COINS } from '../sauteurs/levels.js';
import { createWorld } from '../sauteurs/engine.js';
import { runBots } from '../sauteurs/bot.js';

function clock(connected: string[] = []) {
  let now = 5_000_000;
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => now,
    schedule: (key, ms) => void timers.set(key, now + ms),
    cancel: (key) => void timers.delete(key),
    random: () => 0.5,
    connectedPlayerIds: () => connected,
  };
  return {
    ctx,
    timers,
    advance(ms: number) {
      now += ms;
    },
    fire(state: SauteursState, key: string): SauteursState {
      now = Math.max(now, timers.get(key) ?? now);
      timers.delete(key);
      return sauteurs.onTimer(state, key, ctx);
    },
  };
}

const NAMES = ['Ana', 'Léo', 'Zoé', 'Max', 'Eva', 'Tom', 'Lou', 'Sam'];
const refs = (n: number): PlayerRef[] => NAMES.slice(0, n).map((name, i) => ({ id: `p${i}`, name }));

function started(n: number, settings: Record<string, number> = {}) {
  const players = refs(n);
  const c = clock(players.map((p) => p.id));
  const init = sauteurs.initialize(sauteursSettingsSchema.parse(settings), players, c.ctx);
  const r = sauteurs.start(init, c.ctx);
  if (!r.ok) throw new Error(r.error);
  return { c, s: r.state, players };
}

type Entry = { playerId: string; finishTick: number | null; coins: number; deaths: number };

/** Laisse la course durer `seconds` puis déclare les résultats. */
function send(c: ReturnType<typeof clock>, s: SauteursState, levelIndex: number, results: Entry[]) {
  return sauteurs.handleHostAction!(s, 'level-result', { levelIndex, results }, c.ctx);
}

function okState(r: ReturnType<typeof send>): SauteursState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const pub = (s: SauteursState) => sauteurs.getPublicState(s) as Record<string, any>;

/** Joue un niveau entier avec des résultats valides : le joueur i arrive à min + 100 * i pas. */
function playLevel(c: ReturnType<typeof clock>, s: SauteursState, results?: (id: string, i: number) => Entry) {
  const levelIndex = s.sequence[s.step]!;
  c.advance(COUNTDOWN_MS + maxFinishTicks(levelIndex) * (1000 / 60));
  const entries = Object.keys(s.players).map((id, i) =>
    results ? results(id, i) : { playerId: id, finishTick: minFinishTicks(levelIndex) + 100 * i, coins: 0, deaths: 0 },
  );
  return okState(send(c, s, levelIndex, entries));
}

describe('Course des sauteurs : manifeste et réglages', () => {
  it('déclare le jeu attendu', () => {
    expect(sauteurs.manifest).toMatchObject({
      id: 'sauteurs',
      category: 'plateau',
      name: 'Course des sauteurs',
      version: '1.0.0',
      apiVersion: 1,
      minPlayers: 1,
      maxPlayers: 8,
      durationMin: 6,
    });
    expect(sauteurs.hostActions).toHaveProperty('level-result');
  });

  it('borne les réglages', () => {
    expect(sauteursSettingsSchema.parse({})).toEqual({ levelCount: 3, singleLevel: 1 });
    expect(() => sauteursSettingsSchema.parse({ levelCount: 4 })).toThrow();
    expect(() => sauteursSettingsSchema.parse({ levelCount: 0 })).toThrow();
    expect(() => sauteursSettingsSchema.parse({ singleLevel: 4 })).toThrow();
  });

  it('borne le temps d’arrivée avec la vitesse maximale du moteur, et un robot respecte la borne', () => {
    LEVELS.forEach((level, i) => {
      const min = minFinishTicks(i);
      expect(min).toBeGreaterThan(1000);
      expect(min).toBeLessThan(maxFinishTicks(i));
      const world = createWorld(level, ['a']);
      const run = runBots(world);
      expect(run.finished, level.id).toBe(true);
      expect(world.players[0]!.finishTick!, level.id).toBeGreaterThanOrEqual(min);
    });
  });
});

describe('Course des sauteurs : déroulement', () => {
  it('démarre avec un compte à rebours et un startedAt fixé par le serveur', () => {
    const { c, s } = started(2);
    const state = pub(s);
    expect(state.phase).toBe('playing');
    expect(state.startedAt).toBe(c.ctx.now() + COUNTDOWN_MS);
    expect(state.countdownMs).toBe(COUNTDOWN_MS);
    expect(state.levelIndex).toBe(0);
    expect(state.level).toMatchObject({ id: LEVELS[0]!.id, name: LEVELS[0]!.name, theme: LEVELS[0]!.theme });
    expect(state.endsAt).toBe(state.startedAt + LEVELS[0]!.timeLimit * 1000 + GRACE_MS);
    expect(state.pending).toEqual(['Ana', 'Léo']);
  });

  for (const n of [1, 2, 3, 5, 8]) {
    it(`mène ${n} joueur(s) au bout des trois niveaux`, () => {
      const { c, s: s0 } = started(n);
      let s = s0;
      for (let step = 0; step < 3; step++) {
        s = playLevel(c, s);
        expect(s.phase).toBe('between');
        expect(pub(s).levelResults).toHaveLength(n);
        s = c.fire(s, 'between-end');
        expect(s.phase).toBe(step < 2 ? 'playing' : 'final');
      }
      expect(sauteurs.isFinished(s)).toBe(true);
      const ranking = sauteurs.calculateScores(s);
      expect(ranking).toHaveLength(n);
      // Le joueur 0 arrive toujours premier : 100 + 100 + 100 si seul, sinon en tête.
      expect(ranking[0]).toMatchObject({ playerId: 'p0', rank: 1, points: 300 });
      if (n >= 2) expect(ranking[1]).toMatchObject({ playerId: 'p1', rank: 2, points: 210 });
      if (n >= 5) expect(ranking[4]).toMatchObject({ playerId: 'p4', points: 60 });
    });
  }

  it('calcule 100/70/50/35/20, 5 par pièce, -10 par chute, jamais sous 0', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const entries = Object.fromEntries(ids.map((id, i) => [id, { finishTick: 1500 + i * 10, coins: 0, deaths: 0 }]));
    entries.b = { finishTick: 1510, coins: 3, deaths: 1 };
    entries.f = { finishTick: 1550, coins: 0, deaths: 9 };
    entries.e = { finishTick: null, coins: 4, deaths: 2 };
    const sc = scoreLevel(ids, entries);
    expect(sc.a!.points).toBe(100);
    expect(sc.b!.points).toBe(70 + 15 - 10);
    expect(sc.c!.points).toBe(50);
    expect(sc.d!.points).toBe(35);
    expect(sc.f!.points).toBe(0); // 20 - 90, plancher à 0
    expect(sc.e).toMatchObject({ rank: null, points: 0 }); // 0 + 20 - 20
  });

  it('gère les égalités : même rang, mêmes points, rang suivant décalé', () => {
    const sc = scoreLevel(['a', 'b', 'c', 'd'], {
      a: { finishTick: 1500, coins: 0, deaths: 0 },
      b: { finishTick: 1500, coins: 0, deaths: 0 },
      c: { finishTick: 1600, coins: 0, deaths: 0 },
      d: { finishTick: null, coins: 0, deaths: 0 },
    });
    expect(sc.a).toMatchObject({ rank: 1, points: 100 });
    expect(sc.b).toMatchObject({ rank: 1, points: 100 });
    expect(sc.c).toMatchObject({ rank: 3, points: 50 });
    expect(sc.d).toMatchObject({ rank: null, points: 0 });
  });

  it('partage le rang final des joueurs à égalité de total', () => {
    const { c, s: s0 } = started(2, { levelCount: 1 });
    const min = minFinishTicks(0);
    const s = playLevel(c, s0, (id) => ({ playerId: id, finishTick: min + 5, coins: 0, deaths: 0 }));
    const ranking = sauteurs.calculateScores(s);
    expect(ranking.map((r) => r.rank)).toEqual([1, 1]);
    expect(ranking.map((r) => r.points)).toEqual([100, 100]);
  });

  it('joue un seul niveau, au choix', () => {
    const { c, s: s0 } = started(2, { levelCount: 1, singleLevel: 2 });
    expect(pub(s0)).toMatchObject({ levelIndex: 1, levelCount: 1, step: 1 });
    let s = playLevel(c, s0);
    s = c.fire(s, 'between-end');
    expect(s.phase).toBe('final');
  });

  it('accepte des résultats en plusieurs envois et ne clôt qu’avec le dernier', () => {
    const { c, s: s0 } = started(3, { levelCount: 1 });
    const min = minFinishTicks(0);
    c.advance(COUNTDOWN_MS + 40_000);
    let s = okState(send(c, s0, 0, [{ playerId: 'p0', finishTick: min, coins: 1, deaths: 0 }]));
    expect(s.phase).toBe('playing');
    expect(pub(s).arrivalOrder).toEqual(['p0']);
    expect(pub(s).pending).toEqual(['Léo', 'Zoé']);
    s = okState(send(c, s, 0, [{ playerId: 'p1', finishTick: min + 30, coins: 0, deaths: 0 }]));
    s = okState(send(c, s, 0, [{ playerId: 'p2', finishTick: null, coins: 2, deaths: 3 }]));
    expect(s.phase).toBe('between');
    expect(s.points).toEqual({ p0: 105, p1: 70, p2: 0 });
  });
});

describe('Course des sauteurs : refus', () => {
  const setup = () => {
    const { c, s } = started(2, { levelCount: 2 });
    c.advance(COUNTDOWN_MS + 125_000);
    return { c, s, min: minFinishTicks(0), max: maxFinishTicks(0) };
  };
  const refused = (r: ReturnType<typeof send>, text: RegExp) => {
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(text);
  };

  it('joueur inconnu', () => {
    const { c, s, min } = setup();
    refused(send(c, s, 0, [{ playerId: 'fantome', finishTick: min, coins: 0, deaths: 0 }]), /inconnu/);
  });

  it('mauvais niveau', () => {
    const { c, s, min } = setup();
    refused(send(c, s, 1, [{ playerId: 'p0', finishTick: min, coins: 0, deaths: 0 }]), /niveau/);
    refused(send(c, s, 9, [{ playerId: 'p0', finishTick: min, coins: 0, deaths: 0 }]), /niveau/);
  });

  it('temps trop court', () => {
    const { c, s, min } = setup();
    refused(send(c, s, 0, [{ playerId: 'p0', finishTick: min - 1, coins: 0, deaths: 0 }]), /trop rapide/);
    refused(send(c, s, 0, [{ playerId: 'p0', finishTick: 0, coins: 0, deaths: 0 }]), /trop rapide/);
  });

  it('temps hors limite', () => {
    const { c, s, max } = setup();
    refused(send(c, s, 0, [{ playerId: 'p0', finishTick: max + 1, coins: 0, deaths: 0 }]), /limite/);
  });

  it('arrivée plus rapide que le temps réellement écoulé', () => {
    const { c, s } = started(1);
    const min = minFinishTicks(0);
    c.advance(COUNTDOWN_MS + 5000);
    refused(send(c, s, 0, [{ playerId: 'p0', finishTick: min, coins: 0, deaths: 0 }]), /écoulé/);
  });

  it('pièces au-dessus du maximum, négatives ou fractionnaires', () => {
    const { c, s, min } = setup();
    const over = LEVEL_MAX_COINS[0]! + 1;
    refused(send(c, s, 0, [{ playerId: 'p0', finishTick: min, coins: over, deaths: 0 }]), /pièces/);
    refused(send(c, s, 0, [{ playerId: 'p0', finishTick: min, coins: -1, deaths: 0 }]), /pièces/);
    expect(send(c, s, 0, [{ playerId: 'p0', finishTick: min, coins: 1.5, deaths: 0 }]).ok).toBe(false);
    expect(send(c, s, 0, [{ playerId: 'p0', finishTick: min, coins: LEVEL_MAX_COINS[0]!, deaths: 0 }]).ok).toBe(true);
  });

  it('morts absurdes', () => {
    const { c, s, min } = setup();
    refused(send(c, s, 0, [{ playerId: 'p0', finishTick: min, coins: 0, deaths: maxDeaths(0) + 1 }]), /chutes/);
    refused(send(c, s, 0, [{ playerId: 'p0', finishTick: min, coins: 0, deaths: -2 }]), /chutes/);
  });

  it('double envoi, dans un lot comme entre deux lots', () => {
    const { c, s, min } = setup();
    const e: Entry = { playerId: 'p0', finishTick: min, coins: 0, deaths: 0 };
    refused(send(c, s, 0, [e, e]), /déjà/);
    const once = okState(send(c, s, 0, [e]));
    refused(send(c, once, 0, [{ ...e, finishTick: min + 10 }]), /déjà/);
    expect(once.submissions.p0!.finishTick).toBe(min);
  });

  it('refuse tout le lot si un seul résultat est invalide', () => {
    const { c, s, min } = setup();
    const r = send(c, s, 0, [
      { playerId: 'p0', finishTick: min, coins: 0, deaths: 0 },
      { playerId: 'p1', finishTick: 5, coins: 0, deaths: 0 },
    ]);
    expect(r.ok).toBe(false);
    expect(s.submissions).toEqual({});
  });

  it('hors course, mauvaise action, charge invalide : erreur sans exception', () => {
    const { c, s } = setup();
    const between = c.fire(s, 'level-end');
    refused(send(c, between, 0, [{ playerId: 'p0', finishTick: null, coins: 0, deaths: 0 }]), /course/);
    expect(sauteurs.handleHostAction!(s, 'autre', {}, c.ctx).ok).toBe(false);
    for (const bad of [null, undefined, 3, 'x', {}, { levelIndex: 'a', results: 1 }, { levelIndex: 0, results: [] }]) {
      expect(sauteurs.handleHostAction!(s, 'level-result', bad, c.ctx).ok).toBe(false);
    }
    expect(sauteurs.handleAction(s, { id: 'p0', name: 'Ana' }, 'x', {}, c.ctx).ok).toBe(false);
    expect(sauteurs.start(s, c.ctx).ok).toBe(false);
  });
});

describe('Course des sauteurs : garde-fou et départs', () => {
  it('onTimer clôt le niveau quand l’hôte se tait : les absents n’arrivent pas', () => {
    const { c, s } = started(3, { levelCount: 2 });
    const limitMs = LEVELS[0]!.timeLimit * 1000;
    expect(c.timers.get('level-end')).toBe(c.ctx.now() + COUNTDOWN_MS + limitMs + GRACE_MS);
    // Un ttiers des résultats seulement.
    c.advance(COUNTDOWN_MS + 60_000);
    const partial = okState(send(c, s, 0, [{ playerId: 'p0', finishTick: minFinishTicks(0), coins: 2, deaths: 0 }]));
    const between = c.fire(partial, 'level-end');
    expect(between.phase).toBe('between');
    expect(between.points).toEqual({ p0: 110, p1: 0, p2: 0 });
    expect(c.timers.has('between-end')).toBe(true);
    // Une fois clos, un envoi tardif est refusé et un second minuteur est sans effet.
    expect(send(c, between, 0, [{ playerId: 'p1', finishTick: 3000, coins: 0, deaths: 0 }]).ok).toBe(false);
    expect(sauteurs.onTimer(between, 'level-end', c.ctx)).toBe(between);
    const next = c.fire(between, 'between-end');
    expect(next).toMatchObject({ phase: 'playing', step: 1 });
    expect(c.timers.has('level-end')).toBe(true);
  });

  it('nextRound saute les attentes', () => {
    const { c, s } = started(2, { levelCount: 2 });
    const between = sauteurs.nextRound(s, c.ctx);
    expect(between.phase).toBe('between');
    expect(sauteurs.nextRound(between, c.ctx).phase).toBe('playing');
  });

  it('un départ en cours de course ne bloque rien et garde les points', () => {
    const { c, s } = started(3, { levelCount: 1 });
    c.advance(COUNTDOWN_MS + 60_000);
    const min = minFinishTicks(0);
    let state = okState(send(c, s, 0, [{ playerId: 'p0', finishTick: min, coins: 0, deaths: 0 }]));
    state = sauteurs.onPlayerLeave(state, { id: 'p2', name: 'Zoé' }, c.ctx);
    expect(pub(state).pending).toEqual(['Léo']);
    state = okState(send(c, state, 0, [{ playerId: 'p1', finishTick: min + 50, coins: 0, deaths: 0 }]));
    expect(state.phase).toBe('between');
    expect(sauteurs.calculateScores(state)).toHaveLength(3);
    expect(pub(state).players.find((p: any) => p.id === 'p2').left).toBe(true);
  });

  it('un départ au moment de l’attente du dernier joueur laisse le niveau se clore par le minuteur', () => {
    const { c, s } = started(2, { levelCount: 1 });
    const left = sauteurs.onPlayerLeave(s, { id: 'p1', name: 'Léo' }, c.ctx);
    c.advance(COUNTDOWN_MS + 60_000);
    const min = minFinishTicks(0);
    expect(okState(send(c, left, 0, [{ playerId: 'p0', finishTick: min, coins: 0, deaths: 0 }])).phase).toBe('between');
  });

  it('un arrivant en cours de niveau court à partir du suivant', () => {
    const { c, s } = started(1, { levelCount: 2 });
    const joined = sauteurs.onPlayerJoin(s, { id: 'nouveau', name: 'Nina' }, c.ctx);
    c.advance(COUNTDOWN_MS + 60_000);
    const r = send(c, joined, 0, [{ playerId: 'nouveau', finishTick: minFinishTicks(0), coins: 0, deaths: 0 }]);
    expect(r.ok).toBe(false);
    const done = okState(send(c, joined, 0, [{ playerId: 'p0', finishTick: minFinishTicks(0), coins: 0, deaths: 0 }]));
    const next = c.fire(done, 'between-end');
    expect(next.expected).toEqual(['p0', 'nouveau']);
  });

  it('avant le départ, un joueur qui part disparaît de la liste', () => {
    const players = refs(2);
    const c = clock();
    const init = sauteurs.initialize(sauteursSettingsSchema.parse({}), players, c.ctx);
    expect(Object.keys(sauteurs.onPlayerLeave(init, players[1]!, c.ctx).players)).toEqual(['p0']);
  });

  it('end() termine la partie et annule les minuteurs', () => {
    const { c, s } = started(2);
    const over = sauteurs.end(s, c.ctx);
    expect(over.phase).toBe('final');
    expect(c.timers.size).toBe(0);
    expect(BETWEEN_MS).toBeGreaterThan(0);
  });
});

describe('Course des sauteurs : vues', () => {
  it('ne fuit aucune donnée privée dans la vue publique', () => {
    const { c, s: s0 } = started(2, { levelCount: 1 });
    c.advance(COUNTDOWN_MS + 60_000);
    const s = okState(send(c, s0, 0, [{ playerId: 'p0', finishTick: minFinishTicks(0), coins: 1, deaths: 0 }]));
    const text = JSON.stringify(sauteurs.getPublicState(s));
    // Pas de détail brut des envois en attente, pas de réglages internes ni de séquence.
    expect(text).not.toContain('submissions');
    expect(text).not.toContain('expected');
    expect(text).not.toContain('sequence');
    expect(text).not.toContain('history');
    expect(Object.keys(pub(s)).sort()).toEqual(
      [
        'arrivalOrder',
        'betweenEndsAt',
        'countdownMs',
        'endsAt',
        'levelCount',
        'levelIndex',
        'levelPoints',
        'levelResults',
        'level',
        'phase',
        'pending',
        'players',
        'points',
        'ranking',
        'startedAt',
        'step',
        'submitted',
      ].sort(),
    );
  });

  it('vue joueur : son propre résultat, jamais celui des autres', () => {
    const { c, s: s0 } = started(2, { levelCount: 1 });
    expect(sauteurs.getPlayerState(s0, 'p0')).toMatchObject({ submitted: false, mine: null, racing: true });
    const between = playLevel(c, s0, (id, i) => ({
      playerId: id,
      finishTick: minFinishTicks(0) + 10 * i,
      coins: i + 1,
      deaths: 0,
    }));
    expect(sauteurs.getPlayerState(between, 'p1')).toMatchObject({
      submitted: true,
      mine: { rank: 2, coins: 2, points: 80 },
      points: 80,
    });
    expect(JSON.stringify(sauteurs.getPlayerState(between, 'p1'))).not.toContain('"coins":1,');
  });

  it('vue hôte : qui n’a pas encore répondu', () => {
    const { c, s } = started(2);
    c.advance(COUNTDOWN_MS + 100_000);
    const one = okState(send(c, s, 0, [{ playerId: 'p0', finishTick: null, coins: 0, deaths: 0 }]));
    expect(sauteurs.getHostState(one)).toMatchObject({ pending: ['Léo'], pendingIds: ['p1'] });
  });
});
