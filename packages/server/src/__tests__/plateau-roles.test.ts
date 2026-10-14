import { describe, expect, it } from 'vitest';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';
import { promoteur, loupsVillage, type PromoteurState, type LoupsState } from '@partyhub/games';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCtx(connected: string[], random: () => number) {
  const timers = new Map<string, number>();
  const clock = { t: 1_000_000 };
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random,
    connectedPlayerIds: () => connected,
  };
  return { ctx, timers };
}

const P = (id: string): PlayerRef => ({ id, name: id.toUpperCase() });

function boot<S>(game: GameModule<S>, players: PlayerRef[], settings: Record<string, unknown>, seed = 7) {
  const random = seeded(seed);
  const h = makeCtx(
    players.map((p) => p.id),
    random,
  );
  const init = game.initialize(game.settingsSchema.parse(settings), players, h.ctx);
  return { ...h, state: init as S, ctx: h.ctx };
}

/** Fait jouer des robots (suggest) jusqu'à la fin, en forçant les phases chronométrées. */
function drive<S>(game: GameModule<S>, start: S, players: PlayerRef[], ctx: GameContext, max = 20000): S {
  let s = start;
  for (let i = 0; i < max && !game.isFinished(s); i++) {
    let acted = false;
    for (const p of players) {
      const sug = game.suggest?.(s, p.id, ctx.random);
      if (!sug) continue;
      const res = game.handleAction(s, p, sug.type, sug.payload, ctx);
      if (res.ok) {
        s = res.state;
        acted = true;
        break;
      }
    }
    if (!acted) s = game.nextRound(s, ctx);
  }
  return s;
}

describe('Le Promoteur', () => {
  const players = [P('a'), P('b'), P('c')];

  it('démarre au premier joueur, phase lancer les dés', () => {
    const h = boot(promoteur, players, {});
    const res = promoteur.start(h.state, h.ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.phase).toBe('roll');
    expect(res.state.current).toBe('a');
    expect(h.timers.has('turn')).toBe(true); // turnSeconds = 45 par défaut : minuteur armé
  });

  it('n’autorise que le joueur courant à lancer les dés', () => {
    const h = boot(promoteur, players, { turnSeconds: 0 });
    const started = promoteur.start(h.state, h.ctx);
    if (!started.ok) throw new Error(started.error);
    const refused = promoteur.handleAction(started.state, P('b'), 'roll', undefined, h.ctx);
    expect(refused.ok).toBe(false);
  });

  it('propose l’achat d’une case libre quand le joueur a de quoi payer', () => {
    const h = boot(promoteur, [P('a'), P('b')], { turnSeconds: 0 });
    const s: PromoteurState = {
      ...(h.state as PromoteurState),
      phase: 'roll',
      current: 'a',
      cash: { a: 1000, b: 1000 },
      pos: { a: 0, b: 0 },
      owners: {},
      houses: {},
    };
    // Dés 1 et 2 (somme 3) : la case 3 (Allée des Pins) est libre.
    const seq = [0, 0.2];
    let i = 0;
    const res = promoteur.handleAction(s, P('a'), 'roll', undefined, { ...h.ctx, random: () => seq[i++ % seq.length]! });
    if (!res.ok) throw new Error(res.error);
    expect(res.state.phase).toBe('decide');
    expect(res.state.pending).toBe(3);
  });

  it('fait payer le loyer au propriétaire d’une case déjà achetée', () => {
    const h = boot(promoteur, [P('a'), P('b')], { turnSeconds: 0 });
    const s: PromoteurState = {
      ...(h.state as PromoteurState),
      phase: 'roll',
      current: 'a',
      cash: { a: 1000, b: 1000 },
      pos: { a: 0, b: 0 },
      owners: { '3': 'b' },
      houses: {},
    };
    // Dés 1 et 2 : arrivée sur la case 3, propriété de b. Loyer de base : 4 €.
    const seq = [0, 0.2];
    let i = 0;
    const res = promoteur.handleAction(s, P('a'), 'roll', undefined, { ...h.ctx, random: () => seq[i++ % seq.length]! });
    if (!res.ok) throw new Error(res.error);
    expect(res.state.cash.a).toBe(996);
    expect(res.state.cash.b).toBe(1004);
    expect(res.state.current).toBe('b');
  });

  it('une partie complète avec des robots se termine et garde des soldes positifs', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = boot(promoteur, players, { turnSeconds: 0, rounds: 6 }, seed);
      const started = promoteur.start(h.state, h.ctx);
      if (!started.ok) throw new Error(started.error);
      const end = drive(promoteur, started.state, players, h.ctx);
      expect(promoteur.isFinished(end)).toBe(true);
      for (const id of end.order) expect(end.cash[id] ?? 0).toBeGreaterThanOrEqual(0);
      const ranking = promoteur.calculateScores(end);
      expect(ranking).toHaveLength(3);
    }
  });

  it('la vue joueur ne révèle que ses propres informations privées', () => {
    const h = boot(promoteur, players, {});
    const started = promoteur.start(h.state, h.ctx);
    if (!started.ok) throw new Error(started.error);
    const view = promoteur.getPlayerState(started.state, 'b') as { canRoll: boolean; isMyTurn: boolean };
    expect(view.canRoll).toBe(false);
    expect(view.isMyTurn).toBe(false);
  });
});

describe('Les Loups du village', () => {
  const players = [P('a'), P('b'), P('c'), P('d'), P('e')];

  it('répartit les rôles selon le nombre de joueurs', () => {
    const h = boot(loupsVillage, players, {});
    const started = loupsVillage.start(h.state, h.ctx);
    if (!started.ok) throw new Error(started.error);
    const roles = Object.values(started.state.roles);
    expect(roles.filter((r) => r === 'loup')).toHaveLength(1);
    expect(roles.filter((r) => r === 'voyante')).toHaveLength(1);
    expect(roles.filter((r) => r === 'villageois')).toHaveLength(3);
  });

  it('refuse de démarrer à moins de quatre joueurs', () => {
    const h = boot(loupsVillage, [P('a'), P('b'), P('c')], {});
    const res = loupsVillage.start(h.state, h.ctx);
    expect(res.ok).toBe(false);
  });

  it('une cible protégée par la gardienne survit à l’attaque des loups', () => {
    const h = boot(loupsVillage, [P('a'), P('b'), P('c'), P('d'), P('e'), P('f'), P('g')], {});
    const base = h.state as LoupsState;
    const roles = { a: 'loup', b: 'villageois', c: 'villageois', d: 'villageois', e: 'voyante', f: 'gardienne', g: 'villageois' } as const;
    const s: LoupsState = {
      ...base,
      phase: 'night',
      roles: { ...roles },
      alive: Object.keys(roles),
      round: 1,
      acts: {},
    };
    let next = loupsVillage.handleAction(s, P('a'), 'night', { target: 'b' }, h.ctx);
    if (!next.ok) throw new Error(next.error);
    next = loupsVillage.handleAction(next.state, P('e'), 'night', { target: 'c' }, h.ctx);
    if (!next.ok) throw new Error(next.error);
    const res = loupsVillage.handleAction(next.state, P('f'), 'night', { target: 'b' }, h.ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.state.phase).toBe('reveal');
    expect(res.state.reveal?.saved).toBe(true);
    expect(res.state.alive).toContain('b');
  });

  it('la voyante reçoit le résultat de son inspection', () => {
    const h = boot(loupsVillage, [P('a'), P('b'), P('c'), P('d')], {});
    const s: LoupsState = {
      ...(h.state as LoupsState),
      phase: 'night',
      roles: { a: 'loup', b: 'voyante', c: 'villageois', d: 'villageois' },
      alive: ['a', 'b', 'c', 'd'],
      round: 1,
      acts: {},
    };
    const res = loupsVillage.handleAction(s, P('b'), 'night', { target: 'a' }, h.ctx);
    if (!res.ok) throw new Error(res.error);
    const view = loupsVillage.getPlayerState(res.state, 'b') as { checks: { wolf: boolean }[] };
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0]?.wolf).toBe(true);
  });

  it('un vote à égalité n’élimine personne', () => {
    const h = boot(loupsVillage, [P('a'), P('b'), P('c'), P('d')], {});
    const s: LoupsState = {
      ...(h.state as LoupsState),
      phase: 'vote',
      roles: { a: 'loup', b: 'villageois', c: 'villageois', d: 'villageois' },
      alive: ['a', 'b', 'c', 'd'],
      round: 1,
      votes: {},
    };
    // a et b reçoivent chacun deux voix : égalité, personne ne sort.
    let r = loupsVillage.handleAction(s, P('a'), 'vote', { target: 'b' }, h.ctx);
    if (!r.ok) throw new Error(r.error);
    r = loupsVillage.handleAction(r.state, P('b'), 'vote', { target: 'a' }, h.ctx);
    if (!r.ok) throw new Error(r.error);
    r = loupsVillage.handleAction(r.state, P('c'), 'vote', { target: 'a' }, h.ctx);
    if (!r.ok) throw new Error(r.error);
    r = loupsVillage.handleAction(r.state, P('d'), 'vote', { target: 'b' }, h.ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.state.alive).toHaveLength(4);
    expect(r.state.reveal?.victimName).toBeNull();
    expect(r.state.phase).toBe('reveal');
  });

  it('une partie complète avec des robots se termine avec un vainqueur', () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const h = boot(loupsVillage, players.concat([P('f')]), { debateSeconds: 30 }, seed);
      const started = loupsVillage.start(h.state, h.ctx);
      if (!started.ok) throw new Error(started.error);
      const end = drive(loupsVillage, started.state, players.concat([P('f')]), h.ctx);
      expect(loupsVillage.isFinished(end)).toBe(true);
      expect(end.winner === 'village' || end.winner === 'loups').toBe(true);
    }
  });

  it('la vue joueur ne montre pas le rôle des autres', () => {
    const h = boot(loupsVillage, players, {});
    const started = loupsVillage.start(h.state, h.ctx);
    if (!started.ok) throw new Error(started.error);
    const others = players.filter((p) => started.state.roles[p.id] !== 'loup');
    const view = loupsVillage.getPlayerState(started.state, others[0]!.id) as { allies: string[]; role: string };
    expect(view.allies).toEqual([]);
    expect(view.role).toBe(started.state.roles[others[0]!.id]);
    // La vue d'un villageois ne contient ni le rôle des autres ni l'équipe des loups.
    expect(JSON.stringify(view)).not.toContain('"team":"loups"');
    expect(JSON.stringify(view)).not.toContain('"loup"');
  });
});
