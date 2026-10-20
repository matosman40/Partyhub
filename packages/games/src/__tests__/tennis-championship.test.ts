import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import {
  MATCH_MS,
  PAUSE_MS,
  TENNIS_MATCH_MS,
  tennisParty,
  tennisSettingsSchema,
  type TennisSettings,
  type TennisState,
} from '../tennis/module.js';

/** Contexte de jeu factice : horloge à la main, minuteurs notés dans une table, tirages fixes. */
function makeCtx(random = 0.1) {
  let clock = 0;
  const timers = new Map<string, number>();
  const ctx = {
    now: () => clock,
    schedule: (key: string, ms: number) => {
      timers.set(key, clock + ms);
    },
    cancel: (key: string) => {
      timers.delete(key);
    },
    random: () => random,
    connectedPlayerIds: () => [],
  } as unknown as GameContext;
  return {
    ctx,
    timers,
    /** Avance l’horloge, et renvoie les minuteurs arrivés à échéance. */
    tick(ms: number): string[] {
      clock += ms;
      const due = [...timers.entries()].filter(([, at]) => at <= clock).map(([key]) => key);
      for (const key of due) timers.delete(key);
      return due;
    },
    get now() {
      return clock;
    },
  };
}

function players(...names: string[]): PlayerRef[] {
  return names.map((name) => ({ id: name, name }) as PlayerRef);
}

function settings(overrides: Partial<TennisSettings>): TennisSettings {
  return tennisSettingsSchema.parse(overrides);
}

/** Lance une partie, et renvoie son état de départ. */
function startGame(s: TennisSettings, ids: string[], ctx: ReturnType<typeof makeCtx>): TennisState {
  const init = tennisParty.initialize(s, players(...ids), ctx.ctx);
  const res = tennisParty.start(init, ctx.ctx);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

/** Une balle perdue par le côté donné, `n` fois (0 = bas, 1 = haut). */
function lose(state: TennisState, side: number, ctx: ReturnType<typeof makeCtx>, n = 1): TennisState {
  let s = state;
  for (let i = 0; i < n && s.phase === 'play'; i++) {
    const res = tennisParty.handleHostAction!(s, 'lost', { side }, ctx.ctx);
    if (!res.ok) throw new Error(res.error);
    s = res.state;
  }
  return s;
}

/** Fait tourner la pause entre deux matchs, pour lancer le suivant. */
function nextMatch(state: TennisState, ctx: ReturnType<typeof makeCtx>): TennisState {
  ctx.tick(PAUSE_MS);
  return tennisParty.onTimer(state, 'next-match', ctx.ctx);
}

/** Identifiants des deux joueurs du match en cours. */
function pair(state: TennisState): [string, string] {
  return [state.seats[0] ?? '', state.seats[1] ?? ''];
}

describe('championnat aux règles simples', () => {
  it('fait jouer chaque paire, puis couronne le meilleur classement', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ format: 'poule', rules: 'vies', lives: 1 }), ['a', 'b', 'c'], ctx);
    expect(s.phase).toBe('play');
    expect(pair(s)).toEqual(['c', 'b']); // première manche de la poule

    // Le joueur du bas perd toujours sa balle : b gagne deux matchs, a un seul, c aucun.
    s = lose(s, 0, ctx);
    expect(s.phase).toBe('pause');
    s = nextMatch(s, ctx);
    expect(pair(s)).toEqual(['c', 'a']);
    s = lose(s, 0, ctx);
    s = nextMatch(s, ctx);
    expect(pair(s)).toEqual(['a', 'b']);
    s = lose(s, 0, ctx);

    expect(s.phase).toBe('final');
    expect(s.points).toEqual({ a: 6, b: 10, c: 4 });
    // Chaque joueur connaît son rang final, et le classement affiché rejoint celui du podium.
    expect(tennisParty.getPlayerState(s, 'b')).toMatchObject({ rank: 1 });
    expect(tennisParty.getPlayerState(s, 'a')).toMatchObject({ rank: 2 });
    expect(tennisParty.getPlayerState(s, 'c')).toMatchObject({ rank: 3 });
  });

  it('ne donne aucun rang pendant la partie', () => {
    const ctx = makeCtx();
    const s = startGame(settings({ format: 'poule', rules: 'vies', lives: 1 }), ['a', 'b', 'c'], ctx);
    expect(tennisParty.getPlayerState(s, 'a')).toMatchObject({ rank: null });
  });

  it('ne retient pas les coups d’un match qui n’est pas en cours', () => {
    const ctx = makeCtx();
    const s = startGame(settings({ format: 'poule', rules: 'vies', lives: 2 }), ['a', 'b'], ctx);
    const paused = lose(s, 0, ctx, 2); // le match est fini : pause
    expect(paused.phase).toBe('final');
    // Hors match : les balles perdues et les coups sont sans effet.
    const after = tennisParty.handleHostAction!(paused, 'lost', { side: 0 }, ctx.ctx);
    expect(after.ok && after.state).toBe(paused);
  });

  it('gère le temps limite : le joueur qui a le plus de vies gagne', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ format: 'poule', rules: 'vies', lives: 3 }), ['a', 'b'], ctx);
    // a (bas) perd deux balles : il lui reste une vie, b en a trois. Le temps finit le match : b gagne.
    s = lose(s, 0, ctx, 2);
    ctx.tick(MATCH_MS);
    s = tennisParty.onTimer(s, 'match-end', ctx.ctx);
    expect(s.phase).toBe('final');
    expect(s.points).toEqual({ a: 6, b: 10 });
  });
});

describe('championnat aux règles du tennis', () => {
  it('compte les points du jeu en cours, et termine le match sur un set de 6-0', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ format: 'poule', rules: 'tennis', sets: '1' }), ['a', 'b'], ctx);
    s = lose(s, 0, ctx); // b marque : 0-15
    const view = tennisParty.getPublicState(s) as { match: { points: string[]; games: string } | null };
    expect(view.match?.points).toEqual(['0', '15']);
    expect(view.match?.games).toBe('0-0');
    s = lose(s, 0, ctx, 23); // 6 jeux à 0 : le set et le match vont à b
    expect(s.phase).toBe('final');
    expect(s.points).toEqual({ a: 6, b: 10 });
  });

  it('exige deux joueurs en partie libre aux règles du tennis', () => {
    const ctx = makeCtx();
    const init = tennisParty.initialize(settings({ rules: 'tennis' }), players('a', 'b', 'c'), ctx.ctx);
    const res = tennisParty.start(init, ctx.ctx);
    expect(res.ok).toBe(false);
  });

  it('en partie libre aux règles du tennis, un seul match se joue entre deux joueurs', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ rules: 'tennis', sets: '1' }), ['a', 'b'], ctx);
    expect(s.tournament?.matches).toHaveLength(1);
    s = lose(s, 1, ctx, 24);
    expect(s.phase).toBe('final');
    expect(s.points).toEqual({ a: 10, b: 6 });
  });

  it('au temps limite, le joueur en tête par le score gagne le match', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ format: 'poule', rules: 'tennis' }), ['a', 'b'], ctx);
    s = lose(s, 0, ctx, 4); // b a un jeu d’avance
    ctx.tick(TENNIS_MATCH_MS);
    s = tennisParty.onTimer(s, 'match-end', ctx.ctx);
    expect(s.phase).toBe('final');
    expect(s.points).toEqual({ a: 6, b: 10 });
  });
});

describe('tableau à élimination directe', () => {
  it('fait avancer les vainqueurs jusqu’au champion, avec exemption pour trois joueurs', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ format: 'eliminatoire', rules: 'vies', lives: 1 }), ['a', 'b', 'c'], ctx);
    // Trois joueurs : a est exempté, b contre c.
    expect(pair(s)).toEqual(['b', 'c']);
    s = lose(s, 0, ctx); // b perd, c passe en finale
    s = nextMatch(s, ctx);
    expect(pair(s)).toEqual(['a', 'c']);
    s = lose(s, 1, ctx); // c perd la finale
    expect(s.phase).toBe('final');
    // b, éliminé au premier tour, est classé troisième.
    expect(s.points).toEqual({ a: 10, c: 6, b: 4 });
  });

  it('rejoue un match nul, et garde le même duel', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ format: 'eliminatoire', rules: 'vies', lives: 3 }), ['a', 'b'], ctx);
    ctx.tick(MATCH_MS);
    s = tennisParty.onTimer(s, 'match-end', ctx.ctx); // égalité parfaite : nul
    expect(s.phase).toBe('pause');
    s = nextMatch(s, ctx);
    expect(s.phase).toBe('play');
    expect(s.match?.id).toBe('r0m0');
  });
});

describe('vues des joueurs et de l’écran', () => {
  it('signale aux joueurs hors du match qu’ils attendent leur tour', () => {
    const ctx = makeCtx();
    const s = startGame(settings({ format: 'poule', rules: 'vies', lives: 2 }), ['a', 'b', 'c'], ctx);
    expect(tennisParty.getPlayerState(s, 'a')).toMatchObject({ side: null, alive: false, waiting: true });
    expect(tennisParty.getPlayerState(s, 'c')).toMatchObject({ side: 0, alive: true, waiting: false });
  });

  it('donne le tableau de la poule, avec les matchs joués et en cours', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ format: 'poule', rules: 'vies', lives: 1 }), ['a', 'b', 'c'], ctx);
    s = lose(s, 0, ctx);
    const view = tennisParty.getPublicState(s) as {
      tournament: { matches: { status: string }[]; standings: { id: string; points: number }[] } | null;
    };
    expect(view.tournament?.matches.map((m) => m.status)).toEqual(['played', 'waiting', 'waiting']);
    expect(view.tournament?.standings.find((r) => r.id === 'b')?.points).toBe(3);
  });

  it('donne le champion au tableau terminé', () => {
    const ctx = makeCtx();
    let s = startGame(settings({ format: 'eliminatoire', rules: 'vies', lives: 1 }), ['a', 'b'], ctx);
    s = lose(s, 1, ctx);
    const view = tennisParty.getPublicState(s) as { tournament: { champion: string | null; done: boolean } | null };
    expect(view.tournament).toMatchObject({ champion: 'a', done: true });
  });
});
