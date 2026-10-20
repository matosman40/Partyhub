import { describe, expect, it } from 'vitest';
import type { GameModule } from '@partyhub/shared';
import { buildCases, tribunalAbsurde, type TribunalState } from '../tribunal-absurde/module.js';
import { TRIBUNAL_MODES } from '../tribunal-absurde/info.js';
import { A, B, C, PLAYERS, mulberry32, must } from './aventure-helpers.js';
import { harness, type Harness } from './turn-harness.js';

const game = tribunalAbsurde as GameModule<TribunalState, unknown>;

const QUESTION = 'Quelle est ta défense ?';

function start(settings: Record<string, unknown> = {}, h: Harness = harness()) {
  const parsed = game.settingsSchema.parse(settings);
  const init = game.initialize(parsed, PLAYERS, h.ctx) as TribunalState;
  return { s: must(game.start(init, h.ctx)) as TribunalState, h };
}

function act(
  s: TribunalState,
  who: { id: string; name: string },
  type: string,
  payload: unknown,
  h: Harness,
): TribunalState {
  return must(game.handleAction(s, who, type, payload, h.ctx)) as TribunalState;
}

function writeAll(s: TribunalState, h: Harness, texts: Record<string, string>): TribunalState {
  let next = s;
  for (const p of PLAYERS) next = act(next, p, 'defense', { text: texts[p.id] ?? 'Défense' }, h);
  return next;
}

function indexOfAuthor(s: TribunalState, id: string): number {
  return s.options.indexOf(id);
}

describe('Le Tribunal de l’absurde : affaires', () => {
  it('tire une situation par manche, dans l’ambiance choisie, sans répétition', () => {
    const cases = buildCases(game.settingsSchema.parse({ rounds: 3, ambiance: 'adultes' }), mulberry32(3));
    expect(cases).toHaveLength(3);
    expect(cases.every((c) => c.mode === 'adultes')).toBe(true);
    expect(new Set(cases.map((c) => c.situation)).size).toBe(3);
    for (const c of cases) expect(c.situation.endsWith(QUESTION)).toBe(true);
  });

  it('en mélange, chaque manche change d’ambiance', () => {
    const cases = buildCases(game.settingsSchema.parse({ rounds: 4, ambiance: 'melange' }), mulberry32(9));
    expect(new Set(cases.map((c) => c.mode)).size).toBe(4);
    for (const mode of TRIBUNAL_MODES) expect(cases.map((c) => c.mode)).toContain(mode);
  });

  it('chaque situation tirée se termine par la question du tribunal', () => {
    const everyCase = buildCases(game.settingsSchema.parse({ rounds: 8, ambiance: 'melange' }), mulberry32(1));
    expect(everyCase.every((c) => c.situation.endsWith(QUESTION))).toBe(true);
  });
});

describe('Le Tribunal de l’absurde : défenses et vote', () => {
  it('passe au vote dès que tous les joueurs connectés ont écrit leur défense', () => {
    const { s: started, h } = start({ rounds: 2 });
    expect(started.phase).toBe('write');
    let s = act(started, A, 'defense', { text: 'Le chat l’a fait' }, h);
    s = act(s, B, 'defense', { text: 'Mon ex a parlé' }, h);
    expect(s.phase).toBe('write');
    s = act(s, C, 'defense', { text: 'Le facteur' }, h);
    expect(s.phase).toBe('vote');
    expect(s.options).toHaveLength(3);
  });

  it('le vote est anonyme : les défenses sont montrées, jamais leurs auteurs', () => {
    const { s: started, h } = start({ rounds: 1 });
    const s = writeAll(started, h, { a: 'Défense de Ana', b: 'Défense de Léo', c: 'Défense de Max' });
    const pub = game.getPublicState(s) as { options: string[] };
    expect(pub.options).toHaveLength(3);
    expect(pub.options.sort()).toEqual(['Défense de Ana', 'Défense de Léo', 'Défense de Max']);
    expect(pub.options.some((o) => ['Ana', 'Léo', 'Max'].includes(o))).toBe(false);
  });

  it('refuse de voter pour sa propre défense', () => {
    const { s: started, h } = start({ rounds: 1 });
    const s = writeAll(started, h, {});
    const own = indexOfAuthor(s, A.id);
    const r = game.handleAction(s, A, 'vote', { option: own }, h.ctx);
    expect(r.ok).toBe(false);
  });

  it('refuse une défense vide, trop longue, ou une seconde défense', () => {
    const { s: started, h } = start({ rounds: 1 });
    expect(game.handleAction(started, A, 'defense', { text: '   ' }, h.ctx).ok).toBe(false);
    expect(game.handleAction(started, A, 'defense', { text: 'x'.repeat(141) }, h.ctx).ok).toBe(false);
    const once = act(started, A, 'defense', { text: 'Une fois' }, h);
    expect(game.handleAction(once, A, 'defense', { text: 'Deux fois' }, h.ctx).ok).toBe(false);
  });

  it('chaque vote rapporte 100 points à l’auteur, et la défense la plus votée est acquittée', () => {
    const { s: started, h } = start({ rounds: 1 });
    let s = writeAll(started, h, { a: 'Défense A', b: 'Défense B', c: 'Défense C' });
    // Ana et Max votent pour la défense de Léo ; Léo vote pour celle de Max.
    s = act(s, A, 'vote', { option: indexOfAuthor(s, B.id) }, h);
    s = act(s, C, 'vote', { option: indexOfAuthor(s, B.id) }, h);
    s = act(s, B, 'vote', { option: indexOfAuthor(s, C.id) }, h);
    expect(s.phase).toBe('reveal');
    expect(s.points[B.id]).toBe(200);
    expect(s.points[C.id]).toBe(100);
    expect(s.points[A.id]).toBe(0);

    const pub = game.getPublicState(s) as {
      results: Array<{ author: string; votes: number; verdict: string | null }>;
    };
    const byAuthor = Object.fromEntries(pub.results.map((r) => [r.author, r]));
    expect(byAuthor['Léo']).toMatchObject({ votes: 2, verdict: 'acquittee' });
    expect(byAuthor['Max']).toMatchObject({ votes: 1, verdict: 'condamnee' });
    expect(byAuthor['Ana']).toMatchObject({ votes: 0, verdict: 'condamnee' });
  });

  it('avec une seule défense, il n’y a pas de vote ni de verdict', () => {
    const { s: started, h } = start({ rounds: 1 });
    let s = act(started, A, 'defense', { text: 'Seule défense' }, h);
    s = h.fire(game, s, 'write-timeout');
    expect(s.phase).toBe('reveal');
    const pub = game.getPublicState(s) as { results: Array<{ verdict: string | null }> };
    expect(pub.results[0]!.verdict).toBeNull();
  });

  it('le temps d’écriture puis le temps de vote ferment les étapes', () => {
    const { s: started, h } = start({ rounds: 1, writeSeconds: 30 });
    let s = act(started, A, 'defense', { text: 'Une défense' }, h);
    s = act(s, B, 'defense', { text: 'Une autre' }, h);
    expect(h.timers.has('write-timeout')).toBe(true);
    s = h.fire(game, s, 'write-timeout');
    expect(s.phase).toBe('vote');
    s = h.fire(game, s, 'vote-timeout');
    expect(s.phase).toBe('reveal');
    expect(h.timers.has('reveal-next')).toBe(true);
  });

  it('enchaîne les manches, puis termine la partie', () => {
    const { s: started, h } = start({ rounds: 2 });
    let s = writeAll(started, h, {});
    s = h.fire(game, s, 'vote-timeout');
    expect(s.phase).toBe('reveal');
    s = h.fire(game, s, 'reveal-next');
    expect(s.phase).toBe('write');
    expect(s.round).toBe(1);
    s = writeAll(s, h, {});
    s = h.fire(game, s, 'vote-timeout');
    s = h.fire(game, s, 'reveal-next');
    expect(s.phase).toBe('final');
    expect(game.isFinished(s)).toBe(true);
  });

  it('les robots jouent une partie complète jusqu’au bilan', () => {
    const { s: started, h } = start({ rounds: 3, writeSeconds: 20 });
    let s = started;
    for (let i = 0; i < 400 && !game.isFinished(s); i++) {
      let acted = false;
      for (const p of PLAYERS) {
        const sug = game.suggest?.(s, p.id, h.ctx.random, h.ctx.now());
        if (!sug) continue;
        const r = game.handleAction(s, p, sug.type, sug.payload, h.ctx);
        if (r.ok) {
          s = r.state as TribunalState;
          acted = true;
        }
      }
      if (!acted) {
        const next = [...h.timers.entries()].sort((x, y) => x[1] - y[1])[0];
        if (!next) break;
        s = h.fire(game, s, next[0]);
      }
    }
    expect(game.isFinished(s)).toBe(true);
    expect(Object.values(s.points).reduce((n, v) => n + v, 0)).toBeGreaterThan(0);
  });
});

describe('Le Tribunal de l’absurde : vues', () => {
  it('la vue privée ne contient que la défense du joueur, jamais celles des autres', () => {
    const { s: started, h } = start({ rounds: 1 });
    const s = act(started, A, 'defense', { text: 'Ma défense secrète' }, h);
    const mine = game.getPlayerState(s, A.id) as { myDefense: string | null; answered: boolean };
    const other = game.getPlayerState(s, B.id) as { myDefense: string | null; answered: boolean };
    expect(mine).toMatchObject({ myDefense: 'Ma défense secrète', answered: true });
    expect(other).toMatchObject({ myDefense: null, answered: false });
    expect(JSON.stringify(game.getPublicState(s))).not.toContain('Ma défense secrète');
  });

  it('l’écran principal indique qui doit encore écrire', () => {
    const { s: started, h } = start({ rounds: 1 });
    const s = act(started, A, 'defense', { text: 'Une' }, h);
    const host = game.getHostState(s) as { pending: string[] };
    expect(host.pending.sort()).toEqual(['Léo', 'Max']);
  });
});
