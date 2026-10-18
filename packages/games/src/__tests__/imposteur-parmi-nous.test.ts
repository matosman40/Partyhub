import { describe, expect, it } from 'vitest';
import type { GameModule } from '@partyhub/shared';
import rawWords from '../imposteur/content.fr.json' with { type: 'json' };
import {
  buildRounds,
  containsWord,
  imposteurParmiNous,
  imposteurPartageSettingsSchema,
  type ImposteurPartageState,
} from '../imposteur-parmi-nous/module.js';
import { IMPOSTEUR_MODES } from '../imposteur-parmi-nous/info.js';
import { A, B, C, PLAYERS, mulberry32, must } from './aventure-helpers.js';
import { harness, type Harness } from './turn-harness.js';

const game = imposteurParmiNous as GameModule<ImposteurPartageState, unknown>;

interface Words {
  category: string;
  words: string[];
}
const CATEGORIES = rawWords as Words[];

function categoryOf(word: string): string | undefined {
  return CATEGORIES.find((c) => c.words.includes(word))?.category;
}

function start(settings: Record<string, unknown> = {}, h: Harness = harness()) {
  const init = game.initialize(imposteurPartageSettingsSchema.parse(settings), PLAYERS, h.ctx) as ImposteurPartageState;
  return { s: must(game.start(init, h.ctx)) as ImposteurPartageState, h };
}

function act(
  s: ImposteurPartageState,
  who: { id: string; name: string },
  type: string,
  payload: unknown,
  h: Harness,
): ImposteurPartageState {
  return must(game.handleAction(s, who, type, payload, h.ctx)) as ImposteurPartageState;
}

const impostorOf = (s: ImposteurPartageState) => s.rounds[s.round]!.impostor;
const crewOf = (s: ImposteurPartageState) => PLAYERS.filter((p) => p.id !== impostorOf(s));

function ackAll(s: ImposteurPartageState, h: Harness): ImposteurPartageState {
  let next = s;
  for (const p of PLAYERS) next = act(next, p, 'ack', {}, h);
  return next;
}

function clueAll(s: ImposteurPartageState, h: Harness, text = 'Une phrase tranquille'): ImposteurPartageState {
  let next = s;
  for (const p of PLAYERS) next = act(next, p, 'clue', { text }, h);
  return next;
}

describe('L’imposteur parmi nous : tirage des manches', () => {
  it('fait tourner l’imposteur entre les joueurs', () => {
    const rounds = buildRounds(
      imposteurPartageSettingsSchema.parse({ rounds: 3, mode: 'role-secret' }),
      PLAYERS.map((p) => p.id),
      mulberry32(5),
    );
    expect(new Set(rounds.map((r) => r.impostor)).size).toBe(3);
  });

  it('en mélange, chaque manche a un mode différent', () => {
    const rounds = buildRounds(
      imposteurPartageSettingsSchema.parse({ rounds: 4, mode: 'melange' }),
      PLAYERS.map((p) => p.id),
      mulberry32(8),
    );
    expect(new Set(rounds.map((r) => r.mode))).toEqual(new Set(IMPOSTEUR_MODES));
  });

  it('espion : l’imposteur reçoit un mot de la même catégorie, différent du mot secret', () => {
    const rounds = buildRounds(
      imposteurPartageSettingsSchema.parse({ rounds: 3, mode: 'espion' }),
      ['a', 'b', 'c'],
      mulberry32(2),
    );
    for (const r of rounds) {
      expect(r.impostorView.kind).toBe('word');
      expect(r.impostorView.value).not.toBe(r.word);
      expect(categoryOf(r.impostorView.value!)).toBe(r.category);
    }
  });

  it('intrus : l’imposteur reçoit un mot d’une autre catégorie', () => {
    const rounds = buildRounds(
      imposteurPartageSettingsSchema.parse({ rounds: 3, mode: 'intrus' }),
      ['a', 'b', 'c'],
      mulberry32(4),
    );
    for (const r of rounds) {
      expect(r.impostorView.kind).toBe('word');
      expect(categoryOf(r.impostorView.value!)).not.toBe(r.category);
    }
  });

  it('mot interdit : l’imposteur ne connaît que la catégorie ; rôle secret : il ne sait rien', () => {
    const interdit = buildRounds(
      imposteurPartageSettingsSchema.parse({ rounds: 1, mode: 'mot-interdit' }),
      ['a', 'b', 'c'],
      mulberry32(1),
    );
    expect(interdit[0]!.impostorView).toEqual({ kind: 'category', value: interdit[0]!.category });
    const secret = buildRounds(
      imposteurPartageSettingsSchema.parse({ rounds: 1, mode: 'role-secret' }),
      ['a', 'b', 'c'],
      mulberry32(1),
    );
    expect(secret[0]!.impostorView).toEqual({ kind: 'none', value: null });
  });
});

describe('L’imposteur parmi nous : mot interdit', () => {
  it('reconnaît le mot secret comme un mot entier, sans casse ni accents', () => {
    expect(containsWord('Je vois une Girafe', 'girafe')).toBe(true);
    expect(containsWord('Les girafes dorment', 'girafe')).toBe(false);
    expect(containsWord('Brosse à dents le matin', 'brosse à dents')).toBe(true);
  });

  it('refuse une phrase qui contient le mot secret, et accepte les autres', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'mot-interdit' });
    const s = ackAll(started, h);
    const word = s.rounds[0]!.word;
    const bad = game.handleAction(s, A, 'clue', { text: `C’est ${word} !` }, h.ctx);
    expect(bad.ok).toBe(false);
    const good = game.handleAction(s, A, 'clue', { text: 'Ça se trouve souvent en ville' }, h.ctx);
    expect(good.ok).toBe(true);
  });

  it('la vue des joueurs précise le mot interdit, sauf à l’imposteur', () => {
    const { s: started } = start({ rounds: 1, mode: 'mot-interdit' });
    const impostor = impostorOf(started);
    const crew = crewOf(started)[0]!;
    const crewView = game.getPlayerState(started, crew.id) as { role: { forbidden: string | null } };
    const impostorView = game.getPlayerState(started, impostor) as {
      role: { forbidden: string | null; isImpostor: boolean };
    };
    expect(crewView.role.forbidden).toBe(started.rounds[0]!.word);
    expect(impostorView.role.isImpostor).toBe(true);
    expect(impostorView.role.forbidden).toBeNull();
  });
});

describe('L’imposteur parmi nous : manche', () => {
  it('les joueurs voient leur rôle : le mot pour l’équipe, un indice ou rien pour l’imposteur', () => {
    const { s, h } = start({ rounds: 1, mode: 'espion' });
    const impostor = impostorOf(s);
    const crew = crewOf(s)[0]!;
    const crewRole = (game.getPlayerState(s, crew.id) as { role: { word: string | null } }).role;
    const impostorRole = (game.getPlayerState(s, impostor) as { role: { word: string | null; view: unknown } }).role;
    expect(crewRole.word).toBe(s.rounds[0]!.word);
    expect(impostorRole.word).toBeNull();
    expect(impostorRole.view).toEqual(s.rounds[0]!.impostorView);
    expect(h.timers.has('role-timeout')).toBe(true);
  });

  it('tous lisent leur rôle, puis chacun dit sa phrase, puis on vote', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'role-secret' });
    let s = act(started, A, 'ack', {}, h);
    expect(s.phase).toBe('role');
    s = act(s, B, 'ack', {}, h);
    s = act(s, C, 'ack', {}, h);
    expect(s.phase).toBe('clue');
    s = act(s, A, 'clue', { text: 'Une phrase' }, h);
    s = act(s, B, 'clue', { text: 'Une autre' }, h);
    s = act(s, C, 'clue', { text: 'Encore une' }, h);
    expect(s.phase).toBe('vote');
  });

  it('les phrases ne sont montrées qu’à partir du vote', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'role-secret' });
    let s = ackAll(started, h);
    s = act(s, A, 'clue', { text: 'Phrase secrète de Ana' }, h);
    expect(JSON.stringify(game.getPublicState(s))).not.toContain('Phrase secrète de Ana');
    s = act(s, B, 'clue', { text: 'Phrase de Léo' }, h);
    s = act(s, C, 'clue', { text: 'Phrase de Max' }, h);
    expect(s.phase).toBe('vote');
    expect(JSON.stringify(game.getPublicState(s))).toContain('Phrase secrète de Ana');
  });

  it('démasqué à la majorité, l’imposteur tente de deviner ; une mauvaise réponse fait gagner l’équipe', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'role-secret' });
    const impostor = impostorOf(started);
    let s = clueAll(ackAll(started, h), h);
    const innocent = crewOf(started)[0]!;
    for (const p of PLAYERS) {
      const target = p.id === impostor ? innocent.id : impostor;
      s = act(s, p, 'vote', { target }, h);
    }
    expect(s.phase).toBe('guess');
    expect(s.ejected).toBe(impostor);
    s = act(
      s,
      PLAYERS.find((p) => p.id === impostor)!,
      'guess',
      { text: 'Mauvaise réponse' },
      h,
    );
    expect(s.phase).toBe('result');
    expect(s.outcome).toBe('equipe');
    for (const p of crewOf(started)) expect(s.points[p.id]).toBe(100);
    expect(s.points[impostor]).toBe(0);
  });

  it('démasqué, l’imposteur qui devine le mot gagne 150 points', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'role-secret' });
    const impostor = impostorOf(started);
    let s = clueAll(ackAll(started, h), h);
    for (const p of PLAYERS) {
      const target = p.id === impostor ? crewOf(started)[0]!.id : impostor;
      s = act(s, p, 'vote', { target }, h);
    }
    s = act(
      s,
      PLAYERS.find((p) => p.id === impostor)!,
      'guess',
      { text: started.rounds[0]!.word.toUpperCase() },
      h,
    );
    expect(s.outcome).toBe('imposteur');
    expect(s.points[impostor]).toBe(150);
    expect(s.points[crewOf(started)[0]!.id]).toBe(0);
  });

  it('sans majorité, personne n’est démasqué : l’imposteur survit et gagne 300 points', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'role-secret' });
    const impostor = impostorOf(started);
    let s = clueAll(ackAll(started, h), h);
    // Chacun vote pour un autre : une voix chacun, pas de majorité.
    const order = [...PLAYERS.map((p) => p.id)];
    PLAYERS.forEach((p, i) => {
      s = act(s, p, 'vote', { target: order[(i + 1) % order.length] }, h);
    });
    expect(s.phase).toBe('result');
    expect(s.ejected).toBeNull();
    expect(s.outcome).toBe('imposteur');
    expect(s.points[impostor]).toBe(300);
  });

  it('refuse de se désigner soi-même, et refuse une tentative venue d’un autre que l’imposteur', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'role-secret' });
    const s = clueAll(ackAll(started, h), h);
    expect(game.handleAction(s, A, 'vote', { target: A.id }, h.ctx).ok).toBe(false);
    expect(game.handleAction(s, A, 'guess', { text: 'Essai' }, h.ctx).ok).toBe(false);
  });

  it('le temps écoulé fait passer à la phase suivante', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'role-secret', clueSeconds: 30 });
    let s = h.fire(game, started, 'role-timeout');
    expect(s.phase).toBe('clue');
    s = act(s, A, 'clue', { text: 'Une phrase' }, h);
    s = h.fire(game, s, 'clue-timeout');
    expect(s.phase).toBe('vote');
    s = h.fire(game, s, 'vote-timeout');
    expect(s.phase).toBe('result');
    expect(s.outcome).toBe('imposteur');
  });

  it('si l’imposteur démasqué ne répond pas, l’équipe gagne', () => {
    const { s: started, h } = start({ rounds: 1, mode: 'role-secret' });
    const impostor = impostorOf(started);
    let s = clueAll(ackAll(started, h), h);
    for (const p of PLAYERS) {
      const target = p.id === impostor ? crewOf(started)[0]!.id : impostor;
      s = act(s, p, 'vote', { target }, h);
    }
    expect(s.phase).toBe('guess');
    s = h.fire(game, s, 'guess-timeout');
    expect(s.phase).toBe('result');
    expect(s.outcome).toBe('equipe');
  });

  it('enchaîne les manches, puis termine la partie', () => {
    const { s: started, h } = start({ rounds: 2, mode: 'role-secret' });
    let s = started;
    for (let i = 0; i < 2; i++) {
      s = ackAll(s, h);
      s = clueAll(s, h);
      s = h.fire(game, s, 'vote-timeout');
      expect(s.phase).toBe('result');
      s = h.fire(game, s, 'reveal-next');
    }
    expect(game.isFinished(s)).toBe(true);
  });

  it('les robots jouent une partie complète jusqu’au bilan', () => {
    const { s: started, h } = start({ rounds: 2, mode: 'melange', clueSeconds: 20 });
    let s = started;
    for (let i = 0; i < 400 && !game.isFinished(s); i++) {
      let acted = false;
      for (const p of PLAYERS) {
        const sug = game.suggest?.(s, p.id, h.ctx.random, h.ctx.now());
        if (!sug) continue;
        const r = game.handleAction(s, p, sug.type, sug.payload, h.ctx);
        if (r.ok) {
          s = r.state as ImposteurPartageState;
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
  });
});

describe('L’imposteur parmi nous : partie', () => {
  it('refuse de commencer à deux joueurs', () => {
    const h = harness({ connected: ['a', 'b'] });
    const init = game.initialize(imposteurPartageSettingsSchema.parse({}), [A, B], h.ctx) as ImposteurPartageState;
    expect(game.start(init, h.ctx).ok).toBe(false);
  });

  it('l’écran principal indique qui n’a pas encore lu son rôle', () => {
    const { s, h } = start({ rounds: 1, mode: 'role-secret' });
    const after = act(s, A, 'ack', {}, h);
    const host = game.getHostState(after) as { pending: string[] };
    expect(host.pending.sort()).toEqual(['Léo', 'Max']);
  });
});
