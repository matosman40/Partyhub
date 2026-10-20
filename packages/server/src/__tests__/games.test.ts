import { describe, expect, it } from 'vitest';
import { association, plusOuMoins, plutotQui, reflexe } from '@partyhub/games';
import type { GameContext, GameModule, PlayerRef } from '@partyhub/shared';

/**
 * Tests unitaires des modules de jeu : on pilote l'horloge et les joueurs
 * connectés à la main, sans serveur ni réseau. Le générateur est fixe (0.42)
 * pour rendre les tirages reproductibles.
 */

function makeCtx(connected: string[]) {
  const clock = { t: 1_000_000 };
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random: () => 0.42,
    connectedPlayerIds: () => connected,
  };
  return { ctx, clock, timers, setConnected: (ids: string[]) => (connected = ids) };
}

const A: PlayerRef = { id: 'a', name: 'Alice' };
const B: PlayerRef = { id: 'b', name: 'Bob' };
const C: PlayerRef = { id: 'c', name: 'Carl' };

/** Crée une partie et la lance. Renvoie l'état et le contexte. */
function launch<S>(mod: GameModule<S>, players: PlayerRef[], settings: Record<string, unknown> = {}) {
  const ids = players.map((p) => p.id);
  const h = makeCtx(ids);
  const init = mod.initialize(
    mod.settingsSchema.parse({ ...(mod.defaultSettings as object), ...settings }),
    players,
    h.ctx,
  ) as S;
  const res = mod.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  return { state: res.state, ...h };
}

function act<S>(mod: GameModule<S>, state: S, player: PlayerRef, type: string, payload: unknown, ctx: GameContext): S {
  const res = mod.handleAction(state, player, type, payload, ctx);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}

describe('Association express', () => {
  it('attribue 100 points à l’auteur de chaque mot voté, sans voter pour soi', () => {
    const { state: s0, ctx } = launch(association, [A, B]);
    let s = act(association, s0, A, 'word', { word: 'Pizza' }, ctx);
    s = act(association, s, B, 'word', { word: 'Fromage' }, ctx);
    expect(association.getPublicState(s)).toMatchObject({ phase: 'vote' });

    const aliceOption = association.getPlayerState(s, A.id) as { myOption: number };
    const bobOption = 1 - aliceOption.myOption;

    expect(association.handleAction(s, A, 'vote', { option: aliceOption.myOption }, ctx).ok).toBe(false);

    s = act(association, s, A, 'vote', { option: bobOption }, ctx);
    s = act(association, s, B, 'vote', { option: aliceOption.myOption }, ctx);

    expect(association.getPublicState(s)).toMatchObject({ phase: 'reveal' });
    expect(association.calculateScores(s)).toEqual([
      { playerId: 'a', name: 'Alice', points: 100, rank: 1 },
      { playerId: 'b', name: 'Bob', points: 100, rank: 1 },
    ]);
  });

  it('ne montre jamais les auteurs pendant le vote', () => {
    const { state: s0, ctx } = launch(association, [A, B, C]);
    let s = act(association, s0, A, 'word', { word: 'Chat' }, ctx);
    s = act(association, s, B, 'word', { word: 'Chien' }, ctx);
    s = act(association, s, C, 'word', { word: 'Souris' }, ctx);
    const pub = association.getPublicState(s) as { phase: string; options: string[] };
    expect(pub.phase).toBe('vote');
    expect(pub.options.sort()).toEqual(['Chat', 'Chien', 'Souris']);
    // Le classement affiche les pseudos (voulu), mais les mots ne sont jamais liés à leur auteur.
    expect(JSON.stringify(pub.options)).not.toContain('Alice');
    expect(pub).not.toHaveProperty('results');
  });

  it('passe directement à la révélation quand moins de deux mots ont été écrits', () => {
    const { state: s0, ctx } = launch(association, [A, B]);
    const s = act(association, s0, A, 'word', { word: 'Seul' }, ctx);
    const after = association.onTimer(s, 'write-timeout', ctx);
    expect(after.phase).toBe('reveal');
    expect(after.gains).toEqual({});
  });
});

describe('Plutôt qui ?', () => {
  it('récompense les votants qui suivent la majorité', () => {
    const { state: s0, ctx } = launch(plutotQui, [A, B, C]);
    let s = act(plutotQui, s0, A, 'vote', { target: 'c' }, ctx);
    s = act(plutotQui, s, B, 'vote', { target: 'c' }, ctx);
    s = act(plutotQui, s, C, 'vote', { target: 'a' }, ctx);
    expect(s.phase).toBe('reveal');
    expect(s.gains).toEqual({ a: 100, b: 100 });
    expect(s.points).toEqual({ a: 100, b: 100, c: 0 });
  });

  it('refuse un second vote de la même personne', () => {
    const { state: s0, ctx } = launch(plutotQui, [A, B, C]);
    const s = act(plutotQui, s0, A, 'vote', { target: 'b' }, ctx);
    expect(plutotQui.handleAction(s, A, 'vote', { target: 'c' }, ctx).ok).toBe(false);
  });
});

describe('Plus ou moins', () => {
  it('ne révèle jamais la carte suivante pendant le pari', () => {
    const { state: s0 } = launch(plusOuMoins, [A]);
    const pub = plusOuMoins.getPublicState(s0) as Record<string, unknown>;
    expect(pub).not.toHaveProperty('deck');
    expect(pub.revealed).toBeNull();
    expect(pub.current).not.toBeNull();
  });

  it('accorde 100 points seulement si le pari est juste', () => {
    const { state: s0, ctx } = launch(plusOuMoins, [A]);
    const before = (s0 as unknown as { current: { rank: number } }).current;
    const s = act(plusOuMoins, s0, A, 'bet', { direction: 'higher' }, ctx);
    const after = plusOuMoins.getPublicState(s) as { revealed: { rank: number } | null };
    const higher = after.revealed !== null && after.revealed.rank > before.rank;
    const equal = after.revealed !== null && after.revealed.rank === before.rank;
    const gained = (s as unknown as { points: Record<string, number> }).points.a;
    if (equal) expect(gained).toBe(0);
    else expect(gained).toBe(higher ? 100 : 0);
  });
});

describe('Réflexe', () => {
  it('ignore les touches pendant le rouge et pénalise le faux départ', () => {
    const h = launch(reflexe, [A, B]);
    let s = h.state;
    expect(reflexe.getPublicState(s)).toMatchObject({ phase: 'wait' });
    s = act(reflexe, s, A, 'tap', undefined, h.ctx);
    expect(reflexe.getPlayerState(s, 'a')).toMatchObject({ falseStart: true, acted: true });

    // Le signal vert arrive : Bob touche en 300 ms, Alice ne peut plus jouer cette manche.
    s = reflexe.onTimer(s, 'signal', h.ctx);
    expect(reflexe.getPublicState(s)).toMatchObject({ phase: 'go' });
    h.clock.t += 300;
    expect(reflexe.handleAction(s, A, 'tap', undefined, h.ctx).ok).toBe(false);
    s = act(reflexe, s, B, 'tap', undefined, h.ctx);

    expect(reflexe.getPublicState(s)).toMatchObject({ phase: 'reveal' });
    expect(s.points).toEqual({ a: 0, b: 100 });
  });

  it('classe les réactions valides par rapidité', () => {
    const h = launch(reflexe, [A, B]);
    let s = reflexe.onTimer(h.state, 'signal', h.ctx);
    h.clock.t += 350;
    s = act(reflexe, s, A, 'tap', undefined, h.ctx);
    h.clock.t += 150; // Bob touche 150 ms plus tard
    s = act(reflexe, s, B, 'tap', undefined, h.ctx);
    // Alice a touché la première : 100 points, Bob 70 points.
    expect(s.gains).toEqual({ a: 100, b: 70 });
    expect(s.points).toEqual({ a: 100, b: 70 });
  });
});
