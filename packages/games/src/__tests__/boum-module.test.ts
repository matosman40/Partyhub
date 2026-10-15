import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import { createBoum, type BoumState } from '../boum/module.js';
import type { BankSnapshot, BankSnapshotEntry } from '../boum/bank/registry.js';
import { BANK_TYPES, BANK_TYPE_INFO } from '../boum/bank/types.js';
import { detectorPoints } from '../boum/scoring.js';

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

describe('BOUM ! : Mime le métier', () => {
  it('ne montre le métier qu’au mimeur, jamais à l’écran ni aux autres téléphones', () => {
    const h = started(['mime_metier']);
    const s = h.state;
    const word = s.round!.prompt!.text;
    const pleader = s.round!.pleader!;
    expect(JSON.stringify(h.game.getPublicState(s))).not.toContain(word);
    expect(JSON.stringify(h.game.getHostState(s))).not.toContain(word);
    const others = ['a', 'b', 'c'].filter((id) => id !== pleader);
    for (const id of others) {
      expect((h.game.getPlayerState(s, id) as { secretWord: string | null }).secretWord).toBeNull();
    }
    expect((h.game.getPlayerState(s, pleader) as { secretWord: string | null }).secretWord).toBe(word);
  });

  it('refuse que le mimeur tape le métier, et ne lui demande aucune saisie', () => {
    const h = started(['mime_metier']);
    const pleader = h.state.round!.pleader!;
    const refused = h.game.handleAction(
      h.state,
      { id: pleader, name: 'x' },
      'answer',
      { text: 'quelque chose' },
      h.ctx,
    );
    expect(refused.ok).toBe(false);
    expect((h.game.getPlayerState(h.state, pleader) as { mustAct: boolean }).mustAct).toBe(false);
  });

  it('donne 100 au premier et 70 au second devineur, et 50 par trouveur au mimeur', () => {
    const h = started(['mime_metier']);
    let s = h.state;
    const word = s.round!.prompt!.text;
    const pleader = s.round!.pleader!;
    const [first, second] = ['a', 'b', 'c'].filter((id) => id !== pleader);
    const at = (id: string) => ({ id, name: id });
    s = ok(h.game.handleAction(s, at(first!), 'answer', { text: word }, h.ctx));
    expect(s.phase).toBe('write');
    s = ok(h.game.handleAction(s, at(second!), 'answer', { text: word }, h.ctx));
    expect(s.phase).toBe('reveal');
    expect(s.points[first!]).toBe(100);
    expect(s.points[second!]).toBe(70);
    expect(s.points[pleader]).toBe(100);
  });

  it('ne finit pas quand un devineur se trompe, et ne révèle le métier qu’à la fin', () => {
    const h = started(['mime_metier']);
    let s = h.state;
    const word = s.round!.prompt!.text;
    const pleader = s.round!.pleader!;
    const guesser = ['a', 'b', 'c'].find((id) => id !== pleader)!;
    s = ok(h.game.handleAction(s, { id: guesser, name: guesser }, 'answer', { text: 'mauvaise réponse' }, h.ctx));
    expect(s.phase).toBe('write');
    expect(JSON.stringify(h.game.getPublicState(s))).not.toContain(word);
  });
});

describe('BOUM ! : Où est-ce ?', () => {
  it('ne montre pas le code du bon pays dans les vues publiques et de l’écran', () => {
    const h = started(['ou_est_ce']);
    const pub = h.game.getPublicState(h.state) as { prompt: Record<string, unknown> | null };
    expect(pub.prompt).not.toBeNull();
    expect(Object.keys(pub.prompt!)).not.toContain('answer');
    expect(JSON.stringify(h.game.getHostState(h.state))).not.toContain('"answer"');
  });

  it('refuse un code pays inconnu et un second choix du même joueur', () => {
    const h = started(['ou_est_ce']);
    expect(h.game.handleAction(h.state, A, 'country', { code: 'ZZ' }, h.ctx).ok).toBe(false);
    const once = ok(h.game.handleAction(h.state, A, 'country', { code: 'BE' }, h.ctx));
    expect(h.game.handleAction(once, A, 'country', { code: 'FR' }, h.ctx).ok).toBe(false);
  });

  it('révèle quand tous ont choisi : 100 au bon pays, des points proches, 0 au loin', () => {
    const h = started(['ou_est_ce']);
    let s = h.state;
    const answer = s.round!.prompt!.answer!;
    expect(answer).toBe('FR');
    s = ok(h.game.handleAction(s, A, 'country', { code: 'FR' }, h.ctx));
    expect(s.phase).toBe('write');
    s = ok(h.game.handleAction(s, B, 'country', { code: 'BE' }, h.ctx));
    s = ok(h.game.handleAction(s, C, 'country', { code: 'JP' }, h.ctx));
    expect(s.phase).toBe('reveal');
    expect(s.points.a).toBe(100);
    expect(s.points.b).toBeGreaterThan(50);
    expect(s.points.b).toBeLessThan(100);
    expect(s.points.c).toBe(0);
  });
});

describe('BOUM ! : Devine la chanson', () => {
  const CLIP = 'data:audio/webm;base64,AAAA';

  it('ne montre le titre qu’au chanteur, et jamais l’artiste ou le film avant la révélation', () => {
    const h = started(['devine_chanson']);
    const s = h.state;
    const title = s.round!.prompt!.text;
    const answer = s.round!.prompt!.answer!;
    const pleader = s.round!.pleader!;
    const publicJson = JSON.stringify(h.game.getPublicState(s));
    expect(publicJson).not.toContain(title);
    expect(publicJson).not.toContain(answer);
    expect(JSON.stringify(h.game.getHostState(s))).not.toContain(answer);
    expect((h.game.getPlayerState(s, pleader) as { secretWord: string | null }).secretWord).toBe(title);
    for (const id of ['a', 'b', 'c'].filter((id) => id !== pleader)) {
      expect((h.game.getPlayerState(s, id) as { secretWord: string | null }).secretWord).toBeNull();
    }
  });

  it('attend l’extrait du chanteur : pas de réponse avant, chanteur sans saisie', () => {
    const h = started(['devine_chanson']);
    const s = h.state;
    const pleader = s.round!.pleader!;
    const guesser = ['a', 'b', 'c'].find((id) => id !== pleader)!;
    const answer = s.round!.prompt!.answer!;
    expect(h.game.handleAction(s, { id: guesser, name: guesser }, 'answer', { text: answer }, h.ctx).ok).toBe(false);
    expect(h.game.handleAction(s, { id: pleader, name: 'x' }, 'answer', { text: answer }, h.ctx).ok).toBe(false);
    expect((h.game.getPlayerState(s, pleader) as { mustAct: boolean }).mustAct).toBe(true);
    expect((h.game.getPlayerState(s, guesser) as { mustAct: boolean }).mustAct).toBe(false);
  });

  it('refuse un extrait qui n’est ni audio ni envoyé par le chanteur', () => {
    const h = started(['devine_chanson']);
    const s = h.state;
    const pleader = s.round!.pleader!;
    const guesser = ['a', 'b', 'c'].find((id) => id !== pleader)!;
    expect(
      h.game.handleAction(s, { id: pleader, name: 'x' }, 'clip', { dataUrl: 'https://x.test/a.mp3' }, h.ctx).ok,
    ).toBe(false);
    expect(h.game.handleAction(s, { id: guesser, name: 'x' }, 'clip', { dataUrl: CLIP }, h.ctx).ok).toBe(false);
    expect(h.game.handleAction(s, { id: pleader, name: 'x' }, 'clip', { dataUrl: CLIP }, h.ctx).ok).toBe(true);
  });

  it('accepte une des bonnes réponses séparées par « / », et donne 100 puis 70, 50 par trouveur au chanteur', () => {
    const snapshot = bank();
    snapshot.entries = snapshot.entries.map((e) => (e.type === 'chanson' ? { ...e, answer: 'Alpha / Beta' } : e));
    const h = harness([A, B, C], 7, snapshot);
    let s = ok(h.game.start(h.initial, h.ctx));
    s = h.game.onTimer({ ...s, modes: ['devine_chanson'], index: 0 }, 'boum-announce', h.ctx);
    const pleader = s.round!.pleader!;
    const [first, second] = ['a', 'b', 'c'].filter((id) => id !== pleader);
    const at = (id: string) => ({ id, name: id });
    s = ok(h.game.handleAction(s, at(pleader), 'clip', { dataUrl: CLIP }, h.ctx));
    s = ok(h.game.handleAction(s, at(first!), 'answer', { text: 'beta' }, h.ctx));
    expect(s.phase).toBe('write');
    s = ok(h.game.handleAction(s, at(second!), 'answer', { text: 'Alpha' }, h.ctx));
    expect(s.phase).toBe('reveal');
    expect(s.points[first!]).toBe(100);
    expect(s.points[second!]).toBe(70);
    expect(s.points[pleader]).toBe(100);
  });

  it('refuse qu’un devineur réponde deux fois, et révèle l’artiste seulement à la fin', () => {
    const h = started(['devine_chanson']);
    let s = h.state;
    const pleader = s.round!.pleader!;
    const answer = s.round!.prompt!.answer!;
    const [first, second] = ['a', 'b', 'c'].filter((id) => id !== pleader);
    const at = (id: string) => ({ id, name: id });
    s = ok(h.game.handleAction(s, at(pleader), 'clip', { dataUrl: CLIP }, h.ctx));
    s = ok(h.game.handleAction(s, at(first!), 'answer', { text: answer }, h.ctx));
    expect(h.game.handleAction(s, at(first!), 'answer', { text: answer }, h.ctx).ok).toBe(false);
    expect(JSON.stringify(h.game.getPublicState(s))).not.toContain(answer);
    s = ok(h.game.handleAction(s, at(second!), 'answer', { text: 'mauvaise réponse' }, h.ctx));
    expect(s.phase).toBe('write');
    expect(JSON.stringify(h.game.getPublicState(s))).not.toContain(answer);
  });
});

describe('BOUM ! : Le mot secret', () => {
  const secretOf = (h: ReturnType<typeof started>, s: BoumState, id: string) =>
    (h.game.getPlayerState(s, id) as { secretWord: string | null }).secretWord;
  const at = (id: string) => ({ id, name: id });

  it('ne montre le mot qu’au joueur désigné, jamais à l’écran ni aux autres téléphones', () => {
    const h = started(['le_mot_secret']);
    const s = h.state;
    const word = s.round!.prompt!.text;
    const pleader = s.round!.pleader!;
    expect(JSON.stringify(h.game.getPublicState(s))).not.toContain(word);
    expect(JSON.stringify(h.game.getHostState(s))).not.toContain(word);
    for (const id of ['a', 'b', 'c'].filter((id) => id !== pleader)) expect(secretOf(h, s, id)).toBeNull();
    expect(secretOf(h, s, pleader)).toBe(word);
  });

  it('refuse un indice de plusieurs mots, un indice qui reprend le mot, puis un second indice', () => {
    const h = started(['le_mot_secret']);
    let s = h.state;
    const pleader = s.round!.pleader!;
    const writer = ['a', 'b', 'c'].find((id) => id !== pleader)!;
    // Mots de la banque de test : « mot_secret N », dont le mot long est « secret ».
    expect(h.game.handleAction(s, at(writer), 'answer', { text: 'deux mots' }, h.ctx).ok).toBe(false);
    expect(h.game.handleAction(s, at(writer), 'answer', { text: 'secrets' }, h.ctx).ok).toBe(false);
    s = ok(h.game.handleAction(s, at(writer), 'answer', { text: 'indice' }, h.ctx));
    expect((h.game.getPublicState(s) as { clues: string[] }).clues).toEqual(['indice']);
    expect((h.game.getPlayerState(s, writer) as { mustAct: boolean }).mustAct).toBe(false);
    expect(h.game.handleAction(s, at(writer), 'answer', { text: 'autre' }, h.ctx).ok).toBe(false);
  });

  it('donne 100 au joueur qui devine et 50 à chaque auteur d’indice, puis révèle', () => {
    const h = started(['le_mot_secret']);
    let s = h.state;
    const word = s.round!.prompt!.text;
    const pleader = s.round!.pleader!;
    const [w1, w2] = ['a', 'b', 'c'].filter((id) => id !== pleader);
    s = ok(h.game.handleAction(s, at(w1!), 'answer', { text: 'indice' }, h.ctx));
    s = ok(h.game.handleAction(s, at(w2!), 'answer', { text: 'signe' }, h.ctx));
    expect(h.game.handleAction(s, at(pleader), 'answer', { text: 'pas le bon' }, h.ctx).ok).toBe(false);
    expect(s.phase).toBe('write');
    s = ok(h.game.handleAction(s, at(pleader), 'answer', { text: word }, h.ctx));
    expect(s.phase).toBe('reveal');
    expect(s.points[pleader]).toBe(100);
    expect(s.points[w1!]).toBe(50);
    expect(s.points[w2!]).toBe(50);
  });

  it('ne donne aucun point quand le temps est écoulé sans mot trouvé', () => {
    const h = started(['le_mot_secret']);
    let s = h.state;
    const pleader = s.round!.pleader!;
    const writer = ['a', 'b', 'c'].find((id) => id !== pleader)!;
    s = ok(h.game.handleAction(s, at(writer), 'answer', { text: 'indice' }, h.ctx));
    s = h.game.onTimer(s, 'boum-timer', h.ctx);
    expect(s.phase).toBe('reveal');
    expect(s.points[pleader] ?? 0).toBe(0);
    expect(s.points[writer] ?? 0).toBe(0);
  });
});

describe('BOUM ! : Photo-défi', () => {
  const photo = (letter: string) => `data:image/jpeg;base64,${letter.repeat(8)}`;
  const at = (id: string) => ({ id, name: id });

  it('refuse une photo qui n’est pas un JPEG, puis accepte une photo et la cache aux autres', () => {
    const h = started(['photo_defi']);
    let s = h.state;
    expect(h.game.handleAction(s, at('a'), 'photo', { dataUrl: 'data:image/png;base64,QUFB' }, h.ctx).ok).toBe(false);
    s = ok(h.game.handleAction(s, at('a'), 'photo', { dataUrl: photo('B') }, h.ctx));
    expect(JSON.stringify(h.game.getPublicState(s))).not.toContain(photo('B'));
    expect(JSON.stringify(h.game.getHostState(s))).not.toContain(photo('B'));
    expect((h.game.getPlayerState(s, 'a') as { myText: string | null }).myText).toBeNull();
    expect(h.game.handleAction(s, at('a'), 'photo', { dataUrl: photo('C') }, h.ctx).ok).toBe(false);
  });

  it('ouvre le vote avec les photos, puis donne 100 par vote reçu à l’auteur', () => {
    const h = started(['photo_defi']);
    let s = h.state;
    s = ok(h.game.handleAction(s, at('a'), 'photo', { dataUrl: photo('A') }, h.ctx));
    s = ok(h.game.handleAction(s, at('b'), 'photo', { dataUrl: photo('B') }, h.ctx));
    s = ok(h.game.handleAction(s, at('c'), 'photo', { dataUrl: photo('C') }, h.ctx));
    expect(s.phase).toBe('vote');
    const options = (h.game.getPublicState(s) as { options: { image: string | null }[] }).options;
    expect(options.map((o) => o.image).sort()).toEqual([photo('A'), photo('B'), photo('C')].sort());
    const idxB = s.round!.options.indexOf('b');
    const idxA = s.round!.options.indexOf('a');
    s = ok(h.game.handleAction(s, at('a'), 'vote', { option: idxB }, h.ctx));
    s = ok(h.game.handleAction(s, at('c'), 'vote', { option: idxB }, h.ctx));
    s = ok(h.game.handleAction(s, at('b'), 'vote', { option: idxA }, h.ctx));
    expect(s.phase).toBe('reveal');
    expect(s.points.b).toBe(200);
    expect(s.points.a).toBe(100);
    expect(s.points.c ?? 0).toBe(0);
  });
});

describe('BOUM ! : Grimace', () => {
  const photo = (letter: string) => `data:image/jpeg;base64,${letter.repeat(8)}`;
  const at = (id: string) => ({ id, name: id });

  it('refuse la photo d’un autre joueur, cache la photo pendant la saisie, puis la montre à la notation', () => {
    const h = started(['grimace']);
    let s = h.state;
    const pleader = s.round!.pleader!;
    const other = ['a', 'b', 'c'].find((id) => id !== pleader)!;
    expect(h.game.handleAction(s, at(other), 'photo', { dataUrl: photo('B') }, h.ctx).ok).toBe(false);
    expect(JSON.stringify(h.game.getPublicState(s))).not.toContain(photo('B'));
    s = ok(h.game.handleAction(s, at(pleader), 'photo', { dataUrl: photo('B') }, h.ctx));
    expect(s.phase).toBe('rate');
    expect(JSON.stringify(h.game.getPublicState(s))).toContain(photo('B'));
  });

  it('refuse qu’on se note soi-même, puis attribue la note du détecteur à celui qui fait la grimace', () => {
    const h = started(['grimace']);
    let s = h.state;
    const pleader = s.round!.pleader!;
    const [j1, j2] = ['a', 'b', 'c'].filter((id) => id !== pleader);
    s = ok(h.game.handleAction(s, at(pleader), 'photo', { dataUrl: photo('C') }, h.ctx));
    expect(h.game.handleAction(s, at(pleader), 'rate', { stars: 5 }, h.ctx).ok).toBe(false);
    s = ok(h.game.handleAction(s, at(j1!), 'rate', { stars: 4 }, h.ctx));
    expect(s.phase).toBe('rate');
    s = ok(h.game.handleAction(s, at(j2!), 'rate', { stars: 2 }, h.ctx));
    expect(s.phase).toBe('reveal');
    expect(s.points[pleader]).toBe(detectorPoints([4, 2]));
  });
});

describe('BOUM ! : Galerie du thème', () => {
  const photo = (letter: string) => `data:image/jpeg;base64,${letter.repeat(8)}`;
  const at = (id: string) => ({ id, name: id });

  it('tire un thème de galerie, puis passe au vote dès que tous ont envoyé leur photo', () => {
    const h = started(['galerie_theme']);
    let s = h.state;
    expect(s.round!.prompt!.text.startsWith('theme_galerie')).toBe(true);
    s = ok(h.game.handleAction(s, at('a'), 'photo', { dataUrl: photo('A') }, h.ctx));
    s = ok(h.game.handleAction(s, at('b'), 'photo', { dataUrl: photo('B') }, h.ctx));
    expect(s.phase).toBe('write');
    s = ok(h.game.handleAction(s, at('c'), 'photo', { dataUrl: photo('C') }, h.ctx));
    expect(s.phase).toBe('vote');
  });
});
