import { describe, expect, it } from 'vitest';
import type { GameModule } from '@partyhub/shared';
import {
  chainIndex,
  kindOf,
  telephoneArabe,
  telephoneSettingsSchema,
  type TelephoneKind,
  type TelephoneState,
} from '../telephone-arabe/module.js';
import { A, B, PLAYERS, must } from './aventure-helpers.js';
import { harness, type Harness } from './turn-harness.js';

const game = telephoneArabe as GameModule<TelephoneState, unknown>;

function start(settings: Record<string, unknown> = {}, h: Harness = harness()) {
  const init = game.initialize(telephoneSettingsSchema.parse(settings), PLAYERS, h.ctx) as TelephoneState;
  return { s: must(game.start(init, h.ctx)) as TelephoneState, h };
}

/** Action attendue pour l’étape en cours : une phrase, un dessin ou une description. */
function payloadFor(kind: TelephoneKind, tag: string): { type: string; payload: unknown } {
  if (kind === 'sentence') return { type: 'sentence', payload: { text: `Phrase ${tag}` } };
  if (kind === 'draw') {
    return {
      type: 'draw',
      payload: {
        strokes: [
          [
            [10, 10],
            [200, 220],
            [400, 90],
          ],
        ],
      },
    };
  }
  return { type: 'describe', payload: { text: `Description ${tag}` } };
}

/** Chacun répond à l’étape en cours. */
function answerAll(s: TelephoneState, h: Harness): TelephoneState {
  let next = s;
  for (const p of PLAYERS) {
    const kind = kindOf(next.round, next.settings.source);
    const { type, payload } = payloadFor(kind, `${p.name}-${next.round}`);
    next = must(game.handleAction(next, p, type, payload, h.ctx)) as TelephoneState;
  }
  return next;
}

describe('Le téléphone arabe illustré : étapes', () => {
  it('les phrases de départ alternent dessin et description, après la phrase de départ', () => {
    expect(kindOf(0, 'aleatoire')).toBe('draw');
    expect(kindOf(1, 'aleatoire')).toBe('describe');
    expect(kindOf(2, 'aleatoire')).toBe('draw');
    expect(kindOf(0, 'personnalisees')).toBe('sentence');
    expect(kindOf(1, 'personnalisees')).toBe('draw');
    expect(kindOf(2, 'personnalisees')).toBe('describe');
  });

  it('chaque chaîne est travaillée par un joueur différent à chaque étape', () => {
    const count = 4;
    for (let round = 0; round < 6; round++) {
      const chains = Array.from({ length: count }, (_, pos) => chainIndex(pos, round, count));
      // Une permutation : chaque chaîne est prise exactement une fois.
      expect(new Set(chains).size).toBe(count);
      if (round > 0) {
        for (let pos = 0; pos < count; pos++) {
          const before = chainIndex(pos, round - 1, count);
          const now = chainIndex(pos, round, count);
          expect(now).not.toBe(before);
        }
      }
    }
  });

  it('démarre avec une phrase tirée au hasard pour chaque chaîne, puis un dessin', () => {
    const { s, h } = start({ steps: 3, source: 'aleatoire' });
    expect(s.phase).toBe('step');
    expect(s.round).toBe(0);
    expect(s.chains).toHaveLength(PLAYERS.length);
    expect(s.chains.every((c) => c.length === 1 && c[0]!.kind === 'sentence')).toBe(true);
    const task = (game.getPlayerState(s, A.id) as { task: { kind: string; previousText: string } }).task;
    expect(task.kind).toBe('draw');
    expect(task.previousText).toBe(s.chains[0]![0]!.text);
    expect(h.timers.has('step-timeout')).toBe(true);
  });

  it('personnalisées : le premier tour demande une phrase à chacun', () => {
    const { s } = start({ steps: 3, source: 'personnalisees' });
    expect(s.chains.every((c) => c.length === 0)).toBe(true);
    const task = (game.getPlayerState(s, A.id) as { task: { kind: string } }).task;
    expect(task.kind).toBe('sentence');
    expect(game.handleAction(s, A, 'draw', { strokes: [[[1, 1]]] }, harness().ctx).ok).toBe(false);
  });

  it('chaque chaîne reçoit une étape par tour, et la chaîne complète est dans l’ordre', () => {
    const { s: started, h } = start({ steps: 4, source: 'aleatoire' });
    let s = started;
    for (let round = 0; round < 4; round++) {
      expect(s.phase).toBe('step');
      s = answerAll(s, h);
    }
    expect(s.phase).toBe('final');
    expect(game.isFinished(s)).toBe(true);
    const kinds = s.chains[0]!.map((i) => i.kind);
    expect(kinds).toEqual(['sentence', 'draw', 'describe', 'draw', 'describe']);
    for (const chain of s.chains) expect(chain).toHaveLength(5);
  });

  it('personnalisées : la chaîne compte une étape de moins, la phrase de départ étant écrite', () => {
    const { s: started, h } = start({ steps: 3, source: 'personnalisees' });
    let s = started;
    for (let round = 0; round < 3; round++) s = answerAll(s, h);
    expect(s.phase).toBe('final');
    expect(s.chains[0]!.map((i) => i.kind)).toEqual(['sentence', 'draw', 'describe']);
  });
});

describe('Le téléphone arabe illustré : réponses', () => {
  it('refuse une réponse d’un autre type que celui demandé', () => {
    const { s, h } = start({ steps: 3, source: 'aleatoire' });
    expect(game.handleAction(s, A, 'describe', { text: 'Trop tôt' }, h.ctx).ok).toBe(false);
    expect(game.handleAction(s, A, 'sentence', { text: 'Trop tôt' }, h.ctx).ok).toBe(false);
  });

  it('refuse un dessin vide, ou des coordonnées hors de la grille', () => {
    const { s, h } = start({ steps: 3, source: 'aleatoire' });
    expect(game.handleAction(s, A, 'draw', { strokes: [] }, h.ctx).ok).toBe(false);
    expect(
      game.handleAction(
        s,
        A,
        'draw',
        {
          strokes: [
            [
              [0, 0],
              [1001, 5],
            ],
          ],
        },
        h.ctx,
      ).ok,
    ).toBe(false);
    expect(game.handleAction(s, A, 'draw', { strokes: [[[-1, 0]]] }, h.ctx).ok).toBe(false);
  });

  it('refuse un dessin trop long, en points comme en traits', () => {
    const { s, h } = start({ steps: 3, source: 'aleatoire' });
    const longStroke = Array.from({ length: 301 }, (_, i) => [i % 1000, 5]);
    expect(game.handleAction(s, A, 'draw', { strokes: [longStroke] }, h.ctx).ok).toBe(false);
    const manyStrokes = Array.from({ length: 41 }, () => [[5, 5]]);
    expect(game.handleAction(s, A, 'draw', { strokes: manyStrokes }, h.ctx).ok).toBe(false);
    const heavy = Array.from({ length: 11 }, () => Array.from({ length: 300 }, (_, i) => [i, 3]));
    expect(game.handleAction(s, A, 'draw', { strokes: heavy }, h.ctx).ok).toBe(false);
  });

  it('refuse une seconde réponse du même joueur, et une phrase trop longue en tour de texte', () => {
    const { s, h } = start({ steps: 3, source: 'personnalisees' });
    const once = must(game.handleAction(s, A, 'sentence', { text: 'Une phrase' }, h.ctx)) as TelephoneState;
    expect(game.handleAction(once, A, 'sentence', { text: 'Encore' }, h.ctx).ok).toBe(false);
    expect(game.handleAction(s, B, 'sentence', { text: 'x'.repeat(91) }, h.ctx).ok).toBe(false);
  });

  it('la vue de l’étape ne montre que le travail du joueur, jamais la chaîne des autres', () => {
    const { s: started, h } = start({ steps: 4, source: 'aleatoire' });
    const s = must(
      game.handleAction(
        started,
        A,
        'draw',
        {
          strokes: [
            [
              [1, 1],
              [2, 2],
            ],
          ],
        },
        h.ctx,
      ),
    ) as TelephoneState;
    const mine = game.getPlayerState(s, A.id) as { answered: boolean };
    const other = game.getPlayerState(s, B.id) as { answered: boolean };
    expect(mine.answered).toBe(true);
    expect(other.answered).toBe(false);
    expect(JSON.stringify(game.getPublicState(s))).not.toContain('Phrase');
  });
});

describe('Le téléphone arabe illustré : temps', () => {
  it('avec un temps limité, une étape sans réponse reçoit une réponse vide et la chaîne continue', () => {
    const { s: started, h } = start({ steps: 3, source: 'aleatoire', time: '30' });
    let s = must(
      game.handleAction(
        started,
        A,
        'draw',
        {
          strokes: [
            [
              [5, 5],
              [6, 6],
            ],
          ],
        },
        h.ctx,
      ),
    ) as TelephoneState;
    s = h.fire(game, s, 'step-timeout');
    expect(s.round).toBe(1);
    expect(s.phase).toBe('step');
    // Le joueur B n’a rien envoyé : sa chaîne a reçu un dessin vide.
    const chainOfB = chainIndex(
      PLAYERS.findIndex((p) => p.id === B.id),
      0,
      PLAYERS.length,
    );
    const filled = s.chains[chainOfB]![1]!;
    expect(filled.kind).toBe('draw');
    expect(filled.strokes).toEqual([]);
    expect(filled.by).toBe(B.id);
  });

  it('sans limite, l’étape attend tout le monde, avec un délai de sécurité', () => {
    const { s, h } = start({ steps: 3, source: 'aleatoire', time: 'libre' });
    expect(h.timers.get('step-timeout')! - h.ctx.now()).toBeGreaterThan(60_000);
    expect(game.getPublicState(s)).toMatchObject({ durationMs: null });
  });

  it('avec un temps limité, la vue publique annonce la durée de l’étape', () => {
    const { s } = start({ steps: 3, source: 'aleatoire', time: '45' });
    expect(game.getPublicState(s)).toMatchObject({ durationMs: 45_000, kind: 'draw' });
  });
});

describe('Le téléphone arabe illustré : bilan et robots', () => {
  it('le bilan donne le nom de l’auteur de chaque étape, pas son identifiant', () => {
    const { s: started, h } = start({ steps: 3, source: 'personnalisees' });
    let s = started;
    for (let round = 0; round < 3; round++) s = answerAll(s, h);
    const pub = game.getPublicState(s) as { chains: Array<{ items: Array<{ by: string | null }> }> };
    const authors = pub.chains.flatMap((c) => c.items.map((i) => i.by));
    expect(authors).toContain('Ana');
    expect(authors).not.toContain('a');
  });

  it('ne donne aucun point : c’est un récit à lire ensemble', () => {
    const { s: started, h } = start({ steps: 3, source: 'aleatoire' });
    let s = started;
    for (let round = 0; round < 3; round++) s = answerAll(s, h);
    expect(game.calculateScores(s)).toEqual([]);
  });

  it('les robots jouent une partie complète jusqu’au bilan', () => {
    const { s: started, h } = start({ steps: 5, source: 'personnalisees', time: '30' });
    let s = started;
    for (let i = 0; i < 400 && !game.isFinished(s); i++) {
      let acted = false;
      for (const p of PLAYERS) {
        const sug = game.suggest?.(s, p.id, h.ctx.random, h.ctx.now());
        if (!sug) continue;
        const r = game.handleAction(s, p, sug.type, sug.payload, h.ctx);
        if (r.ok) {
          s = r.state as TelephoneState;
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
    expect(s.chains.every((c) => c.length === 5)).toBe(true);
  });

  it('les réglages refusent un nombre d’étapes hors limites', () => {
    expect(telephoneSettingsSchema.safeParse({ steps: 2 }).success).toBe(false);
    expect(telephoneSettingsSchema.safeParse({ steps: 9 }).success).toBe(false);
    expect(telephoneSettingsSchema.safeParse({ time: '60' }).success).toBe(false);
    expect(telephoneSettingsSchema.parse({})).toMatchObject({ steps: 6, time: 'libre', source: 'aleatoire' });
  });
});
