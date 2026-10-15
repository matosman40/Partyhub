import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { createBoum, type BoumState } from '../boum/module.js';
import type { BankSnapshot, BankSnapshotEntry } from '../boum/bank/registry.js';
import { BANK_TYPES, BANK_TYPE_INFO } from '../boum/bank/types.js';

/** Générateur déterministe (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Banque complète : 12 entrées par type, niveau doux, réponses générées selon le type. */
function bank(): BankSnapshot {
  const entries: BankSnapshotEntry[] = [];
  for (const type of BANK_TYPES) {
    const kind = BANK_TYPE_INFO[type].answer;
    for (let i = 0; i < 12; i++) {
      const answer =
        kind === 'int' ? String(100 + i) : kind === 'text' ? `rep${type}${i}` : kind === 'country' ? 'FR' : null;
      entries.push({ id: `${type}-${i}`, type, level: 'doux', text: `${type} ${i}`, answer });
    }
  }
  return { entries };
}

const A: PlayerRef = { id: 'a', name: 'Ana' };
const B: PlayerRef = { id: 'b', name: 'Léo' };
const C: PlayerRef = { id: 'c', name: 'Max' };

function harness(players: PlayerRef[] = [A, B, C], seed = 7, snapshot: BankSnapshot = bank()) {
  let now = 1_000_000;
  const timers = new Map<string, number>();
  const ctx: GameContext = {
    now: () => now,
    schedule: (key, ms) => void timers.set(key, now + ms),
    cancel: (key) => void timers.delete(key),
    random: mulberry32(seed),
    connectedPlayerIds: () => players.map((p) => p.id),
  };
  const game = createBoum(() => snapshot);
  const initial = game.initialize(game.defaultSettings, players, ctx);
  return {
    game,
    ctx,
    timers,
    initial,
    advance(ms: number) {
      now += ms;
    },
  };
}

function ok(result: { ok: true; state: BoumState } | { ok: false; error: string }): BoumState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** Démarre la partie et force la liste des modes, pour tester un mode précis. */
function started(modes: BoumState['modes'], players: PlayerRef[] = [A, B, C]) {
  const h = harness(players);
  let s = ok(h.game.start(h.initial, h.ctx));
  s = { ...s, modes, index: 0 };
  s = h.game.onTimer(s, 'boum-announce', h.ctx);
  return { ...h, state: s };
}

describe('BOUM ! : démarrage', () => {
  it('refuse de démarrer à moins de deux joueurs', () => {
    const h = harness([A]);
    const result = h.game.start(h.initial, h.ctx);
    expect(result.ok).toBe(false);
  });

  it('refuse de démarrer quand aucun mode n’est jouable', () => {
    const h = harness([A, B, C], 7, { entries: [] });
    const result = h.game.start(h.initial, h.ctx);
    expect(result.ok).toBe(false);
  });

  it('démarre en annonce, puis ouvre la première manche à l’échéance', () => {
    const h = harness();
    let s = ok(h.game.start(h.initial, h.ctx));
    expect(s.phase).toBe('announce');
    s = h.game.onTimer(s, 'boum-announce', h.ctx);
    expect(['write', 'vote', 'rate', 'reveal']).toContain(s.phase);
    expect(s.phase).toBe('write');
  });
});

describe('BOUM ! : Réponse rapide', () => {
  it('attribue 100, 70 selon l’ordre d’arrivée, et ne révèle la réponse qu’à la fin', () => {
    const h = started(['reponse_rapide']);
    let s = h.state;
    const answer = s.round!.prompt!.answer!;

    const publicWrite = JSON.stringify(h.game.getPublicState(s));
    expect(publicWrite).not.toContain(answer);

    s = ok(h.game.handleAction(s, A, 'answer', { text: answer }, h.ctx));
    expect(s.round!.correct).toEqual(['a']);
    s = ok(h.game.handleAction(s, B, 'answer', { text: 'n’importe quoi' }, h.ctx));
    expect(s.phase).toBe('write');
    s = ok(h.game.handleAction(s, C, 'answer', { text: answer }, h.ctx));

    expect(s.phase).toBe('reveal');
    expect(s.points).toEqual({ a: 100, b: 0, c: 70 });
  });

  it('refuse une seconde bonne réponse du même joueur', () => {
    const h = started(['reponse_rapide']);
    const answer = h.state.round!.prompt!.answer!;
    const once = ok(h.game.handleAction(h.state, A, 'answer', { text: answer }, h.ctx));
    const again = h.game.handleAction(once, A, 'answer', { text: answer }, h.ctx);
    expect(again.ok).toBe(false);
  });

  it('passe à la manche suivante après la révélation, puis finit', () => {
    const h = started(['reponse_rapide']);
    let s = h.state;
    s = { ...s, modes: ['reponse_rapide'], index: 0 };
    const answer = s.round!.prompt!.answer!;
    for (const p of [A, B, C]) {
      s = ok(h.game.handleAction(s, p, 'answer', { text: answer }, h.ctx));
    }
    expect(s.phase).toBe('reveal');
    s = h.game.onTimer(s, 'boum-reveal', h.ctx);
    expect(s.phase).toBe('final');
    expect(h.game.isFinished(s)).toBe(true);
  });
});

describe('BOUM ! : Combien ?', () => {
  it('donne 100, 50, 25 au plus proche, au second et au troisième', () => {
    const h = started(['combien']);
    let s = h.state;
    const target = Number(s.round!.prompt!.answer);
    s = ok(h.game.handleAction(s, A, 'guess', { value: target }, h.ctx));
    s = ok(h.game.handleAction(s, B, 'guess', { value: target + 10 }, h.ctx));
    s = ok(h.game.handleAction(s, C, 'guess', { value: target + 3 }, h.ctx));
    expect(s.phase).toBe('reveal');
    expect(s.points).toEqual({ a: 100, b: 25, c: 50 });
  });
});

describe('BOUM ! : écriture et vote', () => {
  it('ne montre aucun auteur pendant le vote et refuse de voter pour soi', () => {
    const h = started(['trous_noirs']);
    let s = h.state;
    s = ok(h.game.handleAction(s, A, 'answer', { text: 'Premier texte' }, h.ctx));
    s = ok(h.game.handleAction(s, B, 'answer', { text: 'Deuxième texte' }, h.ctx));
    s = ok(h.game.handleAction(s, C, 'answer', { text: 'Troisième texte' }, h.ctx));
    expect(s.phase).toBe('vote');

    const pub = h.game.getPublicState(s) as { options: { label: string }[] };
    const labels = pub.options.map((o) => o.label).join(' | ');
    for (const name of ['Ana', 'Léo', 'Max']) expect(labels).not.toContain(name);

    const own = s.round!.options.indexOf('a');
    expect(h.game.handleAction(s, A, 'vote', { option: own }, h.ctx).ok).toBe(false);
  });

  it('attribue 100 par vote reçu à l’auteur, après la révélation', () => {
    const h = started(['trous_noirs']);
    let s = h.state;
    s = ok(h.game.handleAction(s, A, 'answer', { text: 'A' }, h.ctx));
    s = ok(h.game.handleAction(s, B, 'answer', { text: 'B' }, h.ctx));
    s = ok(h.game.handleAction(s, C, 'answer', { text: 'C' }, h.ctx));
    const forB = s.round!.options.indexOf('b');
    const forC = s.round!.options.indexOf('c');
    s = ok(h.game.handleAction(s, A, 'vote', { option: forB }, h.ctx));
    s = ok(h.game.handleAction(s, B, 'vote', { option: forC }, h.ctx));
    s = ok(h.game.handleAction(s, C, 'vote', { option: forB }, h.ctx));
    expect(s.phase).toBe('reveal');
    // A et C votent pour B (2 × 100) ; B vote pour C (1 × 100).
    expect(s.points).toEqual({ a: 0, b: 200, c: 100 });
  });
});

describe('BOUM ! : Le plus probable', () => {
  it('donne 50 par vote reçu, et refuse de voter pour soi', () => {
    const h = started(['le_plus_probable']);
    let s = h.state;
    expect(h.game.handleAction(s, A, 'vote', { player: 'a' }, h.ctx).ok).toBe(false);
    s = ok(h.game.handleAction(s, A, 'vote', { player: 'b' }, h.ctx));
    s = ok(h.game.handleAction(s, B, 'vote', { player: 'c' }, h.ctx));
    s = ok(h.game.handleAction(s, C, 'vote', { player: 'b' }, h.ctx));
    expect(s.phase).toBe('reveal');
    // A et C votent pour B (2 × 50) ; B vote pour C (1 × 50).
    expect(s.points).toEqual({ a: 0, b: 100, c: 50 });
  });
});

describe('BOUM ! : Détecteur de mauvaise foi', () => {
  it('note le plaideur sans qu’il puisse se noter, et attribue la moyenne × 20', () => {
    const h = started(['detecteur']);
    let s = h.state;
    const pleader = s.round!.pleader!;
    const judges = [A, B, C].filter((p) => p.id !== pleader);
    const pleaderRef = [A, B, C].find((p) => p.id === pleader)!;

    expect(h.game.handleAction(s, judges[0]!, 'answer', { text: 'excuse' }, h.ctx).ok).toBe(false);
    s = ok(h.game.handleAction(s, pleaderRef, 'answer', { text: 'Ma défense' }, h.ctx));
    expect(s.phase).toBe('rate');

    expect(h.game.handleAction(s, pleaderRef, 'rate', { stars: 5 }, h.ctx).ok).toBe(false);
    s = ok(h.game.handleAction(s, judges[0]!, 'rate', { stars: 5 }, h.ctx));
    s = ok(h.game.handleAction(s, judges[1]!, 'rate', { stars: 3 }, h.ctx));

    expect(s.phase).toBe('reveal');
    expect(s.points[pleader]).toBe(80);
    expect(s.fiveStars[pleader]).toBe(1);
  });
});

describe('BOUM ! : confidentialité des vues', () => {
  it('ne contient jamais la réponse dans la vue publique pendant la saisie', () => {
    const h = started(['reponse_rapide']);
    const answer = h.state.round!.prompt!.answer!;
    expect(JSON.stringify(h.game.getPublicState(h.state))).not.toContain(answer);
    expect(JSON.stringify(h.game.getHostState(h.state))).not.toContain(answer);
  });

  it('ne donne la main de cartes qu’à son propriétaire', () => {
    const h = started(['main_sale']);
    const own = h.game.getPlayerState(h.state, 'a') as { hand: string[] };
    const other = h.game.getPlayerState(h.state, 'b') as { hand: string[] };
    expect(own.hand.length).toBeGreaterThan(0);
    expect(own.hand.some((card) => other.hand.includes(card))).toBe(false);
  });
});
