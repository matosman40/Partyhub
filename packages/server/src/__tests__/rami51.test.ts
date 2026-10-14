import { describe, expect, it } from 'vitest';
import { noticeSchema, type GameContext, type PlayerRef } from '@partyhub/shared';
import {
  rami51,
  checkMeld,
  checkLayoff,
  checkSwap,
  checkOpening,
  handPenalty,
  penaltyValue,
  type Meld,
  type RamiCard,
  type RamiState,
} from '@partyhub/games';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCtx(connected: string[], random = seeded(7)) {
  const timers = new Map<string, number>();
  const clock = { t: 1_000_000 };
  const ctx: GameContext = {
    now: () => clock.t,
    schedule: (key, ms) => void timers.set(key, ms),
    cancel: (key) => void timers.delete(key),
    random,
    connectedPlayerIds: () => connected,
  };
  return { ctx, timers, clock };
}

const P = (id: string): PlayerRef => ({ id, name: id.toUpperCase() });

/** « 7h » → 7 de cœur (premier jeu), « 7h-2 » → second jeu, « jk-3 » → troisième joker. */
const card = (spec: string): RamiCard => ({ uid: spec.includes('-') ? spec : `${spec}-1`, entry: spec.split('-')[0]! });
const cards = (spec: string): RamiCard[] => spec.split(/\s+/).filter(Boolean).map(card);

function meldOf(id: string, owner: string, spec: string): Meld {
  const check = checkMeld(cards(spec));
  if (!check.ok) throw new Error(check.error);
  return { id, owner, kind: check.kind, cards: check.cards };
}

/** Début de tour cohérent pour un état construit à la main (photo de début de tour comprise). */
function freshTurn(s: RamiState): void {
  const id = s.order[s.turn]!;
  s.drawn = null;
  s.mustUse = [];
  s.openedThisTurn = false;
  s.tableActions = 0;
  s.drawSnap = null;
  s.startSnap = structuredClone({
    hand: s.hands[id] ?? [],
    melds: s.melds,
    draw: s.draw,
    discard: s.discard,
    opened: !!s.opened[id],
    drawn: null,
    mustUse: [],
    openedThisTurn: false,
    tableActions: 0,
  });
}

interface TableSpec {
  hands: Record<string, string>;
  draw?: string;
  discard?: string;
  melds?: Meld[];
  opened?: string[];
  turn?: string;
  scores?: Record<string, number>;
  settings?: Record<string, unknown>;
}

/** Partie lancée puis remplacée par une table choisie (mains, pioche, défausse, combinaisons). */
function table(spec: TableSpec) {
  const ids = Object.keys(spec.hands);
  const h = makeCtx(ids);
  const init = rami51.initialize(rami51.settingsSchema.parse({ turnSeconds: 0, ...spec.settings }), ids.map(P), h.ctx);
  const res = rami51.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  const s = structuredClone(res.state);
  s.hands = Object.fromEntries(ids.map((id) => [id, cards(spec.hands[id]!)]));
  s.draw = cards(spec.draw ?? '2c-2 3c-2 4c-2');
  s.discard = cards(spec.discard ?? '9s-2');
  s.melds = spec.melds ?? [];
  s.nextMeld = 50;
  s.opened = Object.fromEntries(ids.map((id) => [id, (spec.opened ?? []).includes(id)]));
  s.turn = ids.indexOf(spec.turn ?? ids[0]!);
  if (spec.scores) s.scores = { ...s.scores, ...spec.scores };
  freshTurn(s);
  return { state: s, ...h };
}

function act(h: { ctx: GameContext }, state: RamiState, id: string, type: string, payload?: unknown): RamiState {
  const res = rami51.handleAction(state, P(id), type, payload, h.ctx);
  if (!res.ok) throw new Error(`${id} ${type} : ${res.error}`);
  return res.state;
}

function refused(h: { ctx: GameContext }, state: RamiState, id: string, type: string, payload?: unknown): string {
  const res = rami51.handleAction(state, P(id), type, payload, h.ctx);
  if (res.ok) throw new Error(`${id} ${type} aurait dû être refusé`);
  return res.error;
}

const uids = (list: RamiCard[]) => list.map((c) => c.uid).sort();

/** Toutes les cartes de la manche : mains, pioche, défausse et table. */
function everyCard(s: RamiState): string[] {
  return [
    ...Object.values(s.hands)
      .flat()
      .map((c) => c.uid),
    ...s.draw.map((c) => c.uid),
    ...s.discard.map((c) => c.uid),
    ...s.melds.flatMap((m) => m.cards.map((c) => c.uid)),
  ];
}

describe('Rami 51 : combinaisons', () => {
  it('accepte les brelans et carrés de couleurs différentes, refuse les doublons de couleur', () => {
    const brelan = checkMeld(cards('7s 7h 7d'));
    expect(brelan).toMatchObject({ ok: true, kind: 'set', points: 21, franche: false });
    expect(checkMeld(cards('7s 7h 7d 7c'))).toMatchObject({ ok: true, kind: 'set', points: 28 });
    const doublon = checkMeld(cards('7s 7s-2 7h'));
    expect(doublon.ok).toBe(false);
    if (!doublon.ok) expect(doublon.error).toContain('couleurs différentes');
    const cinq = checkMeld(cards('7s 7h 7d 7c 7s-2'));
    expect(cinq.ok).toBe(false);
    expect(checkMeld(cards('7s 7h')).ok).toBe(false);
  });

  it('accepte une suite d’une seule couleur dans n’importe quel ordre, refuse les trous et les mélanges', () => {
    const run = checkMeld(cards('7h 5h 6h'));
    expect(run).toMatchObject({ ok: true, kind: 'run', points: 18, franche: true });
    if (run.ok) expect(run.cards.map((c) => c.entry)).toEqual(['5h', '6h', '7h']);
    const melange = checkMeld(cards('5h 6s 7h'));
    expect(melange.ok).toBe(false);
    if (!melange.ok) expect(melange.error).toContain('ni un brelan');
    const trou = checkMeld(cards('5h 6h 8h'));
    expect(trou.ok).toBe(false);
    if (!trou.ok) expect(trou.error).toBe('Ces cartes ne se suivent pas : il manque 7♥.');
    const double = checkMeld(cards('5h 6h 6h-2 7h'));
    expect(double.ok).toBe(false);
  });

  it('l’as est bas (A-2-3, 1 point) ou haut (D-R-A, 11 points), jamais entre les deux', () => {
    const bas = checkMeld(cards('ah 2h 3h'));
    expect(bas).toMatchObject({ ok: true, points: 6 });
    if (bas.ok) expect(bas.cards.map((c) => c.pos)).toEqual([1, 2, 3]);
    const haut = checkMeld(cards('qh kh ah'));
    expect(haut).toMatchObject({ ok: true, points: 31 });
    if (haut.ok) expect(haut.cards.map((c) => c.pos)).toEqual([12, 13, 14]);
    const tour = checkMeld(cards('kh ah 2h'));
    expect(tour.ok).toBe(false);
    if (!tour.ok) expect(tour.error).toContain('R-A-2');
  });

  it('une suite compte 13 cartes au plus', () => {
    const treize = checkMeld(cards('ah 2h 3h 4h 5h 6h 7h 8h 9h 10h jh qh kh'));
    expect(treize).toMatchObject({ ok: true, kind: 'run' });
    const quatorze = checkMeld(cards('ah 2h 3h 4h 5h 6h 7h 8h 9h 10h jh qh kh ah-2'));
    expect(quatorze.ok).toBe(false);
    if (!quatorze.ok) expect(quatorze.error).toContain('13 cartes');
  });

  it('place le joker : il comble le trou, sinon prolonge vers le haut, sinon vers le bas', () => {
    const trou = checkMeld(cards('5h jk 7h'));
    expect(trou).toMatchObject({ ok: true, kind: 'run', points: 18, franche: false, joker: true });
    if (trou.ok) expect(trou.cards[1]).toMatchObject({ entry: 'jk', pos: 6, stands: ['h'] });

    const haut = checkMeld(cards('5h 6h jk'));
    if (!haut.ok) throw new Error(haut.error);
    expect(haut.cards.map((c) => c.pos)).toEqual([5, 6, 7]);
    expect(haut.cards[2]!.entry).toBe('jk');

    const bas = checkMeld(cards('qh kh ah jk'));
    if (!bas.ok) throw new Error(bas.error);
    expect(bas.cards[0]).toMatchObject({ entry: 'jk', pos: 11 });
    expect(bas.points).toBe(41);

    const asBas = checkMeld(cards('ah 2h jk'));
    if (!asBas.ok) throw new Error(asBas.error);
    expect(asBas.cards.map((c) => c.pos)).toEqual([1, 2, 3]);
    expect(asBas.points).toBe(6);

    const roiAs = checkMeld(cards('kh ah jk'));
    if (!roiAs.ok) throw new Error(roiAs.error);
    expect(roiAs.cards.map((c) => c.pos)).toEqual([12, 13, 14]);
  });

  it('un seul joker par combinaison, avec au moins deux vraies cartes, et un seul trou comblé', () => {
    const deux = checkMeld(cards('5h jk-1 jk-2'));
    expect(deux.ok).toBe(false);
    if (!deux.ok) expect(deux.error).toBe('Un seul joker par combinaison.');
    const deuxTrous = checkMeld(cards('5h jk 8h'));
    expect(deuxTrous.ok).toBe(false);
    if (!deuxTrous.ok) expect(deuxTrous.error).toContain('un seul trou');
    expect(checkMeld(cards('5h 6s jk')).ok).toBe(false);
  });

  it('dans un brelan, le joker prend une couleur manquante et vaut la carte remplacée', () => {
    const brelan = checkMeld(cards('7s 7h jk'));
    if (!brelan.ok) throw new Error(brelan.error);
    expect(brelan.kind).toBe('set');
    expect(brelan.points).toBe(21);
    expect(brelan.cards[2]).toMatchObject({ entry: 'jk', stands: ['c', 'd'] });
    const carre = checkMeld(cards('7s 7h 7d jk'));
    if (!carre.ok) throw new Error(carre.error);
    expect(carre.cards[3]!.stands).toEqual(['c']);
    expect(checkMeld(cards('as ah ad'))).toMatchObject({ ok: true, points: 33 });
    expect(checkMeld(cards('ks kh jk'))).toMatchObject({ ok: true, points: 30 });
  });

  it('compte les pénalités : joker 20, as 11, figures 10, les autres leur valeur', () => {
    expect(penaltyValue('jk')).toBe(20);
    expect(penaltyValue('ah')).toBe(11);
    expect(penaltyValue('kd')).toBe(10);
    expect(penaltyValue('qs')).toBe(10);
    expect(penaltyValue('7c')).toBe(7);
    expect(handPenalty(cards('jk as kd 5h 2c'))).toBe(48);
  });

  it('complète une combinaison de la table selon sa nature', () => {
    const run = meldOf('m1', 'a', '5h 6h 7h');
    expect(checkLayoff(run, cards('8h'))).toMatchObject({ ok: true, points: 26 });
    expect(checkLayoff(run, cards('4h 3h')).ok).toBe(true);
    expect(checkLayoff(run, cards('9h')).ok).toBe(false);
    const couleur = checkLayoff(run, cards('8s'));
    expect(couleur.ok).toBe(false);
    if (!couleur.ok) expect(couleur.error).toContain('♥');
    const joker = checkLayoff(run, cards('jk'));
    if (!joker.ok) throw new Error(joker.error);
    expect(joker.cards[3]).toMatchObject({ entry: 'jk', pos: 8 });

    const avecJoker = meldOf('m2', 'a', '5h jk 7h');
    const occupe = checkLayoff(avecJoker, cards('6h-2'));
    expect(occupe.ok).toBe(false);
    if (!occupe.ok) expect(occupe.error).toContain('Échanger le joker');
    expect(checkLayoff(avecJoker, cards('jk-2')).ok).toBe(false);

    const haut = meldOf('m3', 'a', 'jh qh kh');
    const asHaut = checkLayoff(haut, cards('ah'));
    if (!asHaut.ok) throw new Error(asHaut.error);
    expect(asHaut.cards[3]!.pos).toBe(14);
    const asBas = checkLayoff(meldOf('m4', 'a', '2h 3h 4h'), cards('ah'));
    if (!asBas.ok) throw new Error(asBas.error);
    expect(asBas.cards[0]!.pos).toBe(1);
    const tour = checkLayoff(meldOf('m5', 'a', 'qh kh ah'), cards('2h'));
    expect(tour.ok).toBe(false);
    if (!tour.ok) expect(tour.error).toContain('R-A-2');

    const brelan = meldOf('m6', 'a', '7s 7h 7d');
    expect(checkLayoff(brelan, cards('7c'))).toMatchObject({ ok: true, points: 28 });
    expect(checkLayoff(brelan, cards('7s-2')).ok).toBe(false);
    const rang = checkLayoff(brelan, cards('8c'));
    expect(rang.ok).toBe(false);
    if (!rang.ok) expect(rang.error).toContain('que des 7');
    const brelanJoker = meldOf('m7', 'a', '7s 7h jk');
    const quatre = checkLayoff(brelanJoker, cards('7d'));
    if (!quatre.ok) throw new Error(quatre.error);
    expect(quatre.cards.find((c) => c.entry === 'jk')!.stands).toEqual(['c']);
    expect(checkLayoff(brelanJoker, cards('7d 7c')).ok).toBe(false);
  });

  it('échange un joker contre la carte exacte qu’il remplace', () => {
    const run = meldOf('m1', 'b', '5h jk 7h');
    const swap = checkSwap(run, card('6h-2'));
    if (!swap.ok) throw new Error(swap.error);
    expect(swap.joker.entry).toBe('jk');
    expect(swap.cards.map((c) => c.entry)).toEqual(['5h', '6h', '7h']);
    const faux = checkSwap(run, card('6s'));
    expect(faux.ok).toBe(false);
    if (!faux.ok) expect(faux.error).toContain('6♥');

    const brelan = meldOf('m2', 'b', '7s 7h jk');
    expect(checkSwap(brelan, card('7c')).ok).toBe(true);
    expect(checkSwap(brelan, card('7d')).ok).toBe(true);
    expect(checkSwap(brelan, card('7s-2')).ok).toBe(false);
    expect(checkSwap(meldOf('m3', 'b', '7s 7h 7d'), card('7c')).ok).toBe(false);
  });

  it('ouverture : au moins 51 points et une tierce franche, cartes jamais réutilisées', () => {
    const court = checkOpening([cards('8h 9h 10h'), cards('4s 5s 6s')], 51);
    expect(court).toMatchObject({ ok: false, points: 42, franche: true });
    expect(court.error).toBe('Ouverture insuffisante : 42 points sur 51.');
    const sansFranche = checkOpening([cards('ks kh kd'), cards('qs qh qc')], 51);
    expect(sansFranche).toMatchObject({ ok: false, points: 60, franche: false });
    expect(sansFranche.error).toBe('Il faut au moins une tierce franche pour ouvrir.');
    const jokerPasFranc = checkOpening([cards('9h jk jh qh'), cards('ks kh kd')], 51);
    expect(jokerPasFranc.error).toBe('Il faut au moins une tierce franche pour ouvrir.');
    expect(checkOpening([cards('8h 9h 10h jh'), cards('7s 7h 7d')], 51)).toMatchObject({ ok: true, points: 58 });
    const deuxFois = checkOpening([cards('8h 9h 10h'), cards('10h 10s 10d')], 51);
    expect(deuxFois.error).toContain('deux combinaisons');
    const mauvaise = checkOpening([cards('8h 9h 10h'), cards('2s 9d kc')], 51);
    expect(mauvaise.error).toMatch(/^Combinaison 2 : /);
  });
});

describe('Rami 51 : donne et tours', () => {
  it('distribue 13 cartes à chacun, retourne une carte (jamais un joker) et garde les 108 cartes', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      const h = makeCtx(ids, seeded(seed));
      const init = rami51.initialize(rami51.settingsSchema.parse({}), ids.map(P), h.ctx);
      const res = rami51.start(init, h.ctx);
      if (!res.ok) throw new Error(res.error);
      const s = res.state;
      for (const id of ids) expect(s.hands[id]).toHaveLength(13);
      expect(s.discard).toHaveLength(1);
      expect(s.discard[0]!.entry).not.toBe('jk');
      expect(s.draw).toHaveLength(108 - 65 - 1);
      const all = everyCard(s);
      expect(all).toHaveLength(108);
      expect(new Set(all).size).toBe(108);
      // Premier tour : le joueur après le donneur ; minuteur de tour armé.
      expect(s.dealer).toBe(0);
      expect(s.order[s.turn]).toBe('b');
      expect(h.timers.get('turn')).toBe(90_000);
    }
  });

  it('fait tourner le donneur à chaque manche', () => {
    const h = makeCtx(['a', 'b', 'c']);
    const init = rami51.initialize(rami51.settingsSchema.parse({ turnSeconds: 0 }), ['a', 'b', 'c'].map(P), h.ctx);
    const res = rami51.start(init, h.ctx);
    if (!res.ok) throw new Error(res.error);
    const over: RamiState = { ...res.state, phase: 'round-over' };
    const next = rami51.nextRound(over, h.ctx);
    expect(next.round).toBe(2);
    expect(next.dealer).toBe(1);
    expect(next.order[next.turn]).toBe('c');
    expect(next.lastEvent).toContain('B distribue, C commence');
  });

  it('refuse d’agir hors de son tour, de défausser sans piocher et de piocher deux fois', () => {
    const t = table({ hands: { a: '2s 5d 9c', b: '3h 4h 8c' } });
    expect(refused(t, t.state, 'b', 'draw', { from: 'deck' })).toBe('Ce n’est pas votre tour.');
    expect(refused(t, t.state, 'a', 'discard', { cardId: '2s-1' })).toBe('Piochez d’abord une carte.');
    const drawn = act(t, t.state, 'a', 'draw', { from: 'deck' });
    expect(uids(drawn.hands.a!)).toContain('4c-2');
    expect(drawn.draw).toHaveLength(2);
    expect(refused(t, drawn, 'a', 'draw', { from: 'deck' })).toBe('Vous avez déjà pioché ce tour-ci.');
    const after = act(t, drawn, 'a', 'discard', { cardId: '9c-1' });
    expect(after.order[after.turn]).toBe('b');
    expect(after.discard[after.discard.length - 1]!.uid).toBe('9c-1');
  });
});

describe('Rami 51 : ouverture et poses', () => {
  it('ouvre avec 51 points et une tierce franche, sinon refuse avec le compte exact', () => {
    const t = table({ hands: { a: '8h 9h 10h 4s 5s 6s ks kh kd qs qh qc jh', b: '3h 4h 8c' } });
    const s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    expect(
      refused(t, s, 'a', 'open', {
        melds: [
          ['8h-1', '9h-1', '10h-1'],
          ['4s-1', '5s-1', '6s-1'],
        ],
      }),
    ).toBe('Ouverture insuffisante : 42 points sur 51.');
    expect(
      refused(t, s, 'a', 'open', {
        melds: [
          ['ks-1', 'kh-1', 'kd-1'],
          ['qs-1', 'qh-1', 'qc-1'],
        ],
      }),
    ).toBe('Il faut au moins une tierce franche pour ouvrir.');
    const opened = act(t, s, 'a', 'open', {
      melds: [
        ['8h-1', '9h-1', '10h-1'],
        ['ks-1', 'kh-1', 'kd-1'],
      ],
    });
    expect(opened.opened.a).toBe(true);
    expect(opened.melds).toHaveLength(2);
    expect(opened.melds.every((m) => m.owner === 'a')).toBe(true);
    expect(opened.hands.a).toHaveLength(14 - 6);
    expect(opened.lastEvent).toBe('A ouvre avec 57 points (2 combinaisons).');
    expect(refused(t, opened, 'a', 'open', { melds: [['qs-1', 'qh-1', 'qc-1']] })).toContain('déjà ouvert');
    // Une fois ouvert : nouvelles combinaisons et compléments dans le même tour.
    const more = act(t, opened, 'a', 'meld', { cardIds: ['qs-1', 'qh-1', 'qc-1'] });
    expect(more.melds).toHaveLength(3);
    const layoff = act(t, more, 'a', 'layoff', { meldId: more.melds[0]!.id, cardIds: ['jh-1'] });
    expect(layoff.melds[0]!.cards.map((c) => c.entry)).toEqual(['8h', '9h', '10h', 'jh']);
    expect(refused(t, more, 'a', 'layoff', { meldId: more.melds[0]!.id, cardIds: ['4s-1'] })).toBe(
      'Cette suite est à ♥ : le 4♠ ne va pas.',
    );
    expect(refused(t, more, 'a', 'layoff', { meldId: 'm999', cardIds: ['4s-1'] })).toContain('plus sur la table');
  });

  it('avant l’ouverture, on ne pose pas, on ne complète pas et on n’échange pas', () => {
    const t = table({
      hands: { a: '5s 6s 7s 6h 9d', b: '3h 4h 8c' },
      melds: [meldOf('m1', 'b', '5h jk 7h')],
      opened: ['b'],
    });
    const s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    expect(refused(t, s, 'a', 'meld', { cardIds: ['5s-1', '6s-1', '7s-1'] })).toBe(
      'Ouvrez d’abord (51 points avec une tierce franche) pour poser une combinaison.',
    );
    expect(refused(t, s, 'a', 'layoff', { meldId: 'm1', cardIds: ['6h-1'] })).toContain('Ouvrez d’abord');
    expect(refused(t, s, 'a', 'swap', { meldId: 'm1', cardId: '6h-1' })).toContain('échanger un joker');
  });

  it('on ne pose jamais sa dernière carte', () => {
    const t = table({ hands: { a: '9h 10h jh qh kh', b: '3h 4h 8c' }, draw: '2c-2 ah' });
    const s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    expect(s.hands.a).toHaveLength(6);
    expect(refused(t, s, 'a', 'open', { melds: [['9h-1', '10h-1', 'jh-1', 'qh-1', 'kh-1', 'ah-1']] })).toBe(
      'Gardez au moins une carte en main pour la défausse.',
    );
    const opened = act(t, s, 'a', 'open', { melds: [['10h-1', 'jh-1', 'qh-1', 'kh-1', 'ah-1']] });
    expect(opened.hands.a!.map((c) => c.uid)).toEqual(['9h-1']);
    expect(refused(t, opened, 'a', 'layoff', { meldId: opened.melds[0]!.id, cardIds: ['9h-1'] })).toBe(
      'Gardez au moins une carte en main pour la défausse.',
    );
  });

  it('une carte prise dans la défausse doit être posée dans le tour, et ne retourne jamais à la défausse', () => {
    const t = table({
      hands: { a: '5h 6h 9s kd', b: '3c 4c 8c' },
      discard: '2d 7h',
      opened: ['a'],
    });
    const took = act(t, t.state, 'a', 'draw', { from: 'discard' });
    const me = rami51.getPlayerState(took, 'a') as { mustUse: string[]; hasDrawn: boolean; canUndo: boolean };
    expect(me.mustUse).toEqual(['7h-1']);
    expect(me.hasDrawn).toBe(true);
    expect(me.canUndo).toBe(true);
    expect(refused(t, took, 'a', 'discard', { cardId: 'kd-1' })).toBe('Posez d’abord le 7♥ pris dans la défausse.');
    expect(refused(t, took, 'a', 'discard', { cardId: '7h-1' })).toBe('Posez d’abord le 7♥ pris dans la défausse.');
    const laid = act(t, took, 'a', 'meld', { cardIds: ['5h-1', '6h-1', '7h-1'] });
    expect(laid.mustUse).toEqual([]);
    const done = act(t, laid, 'a', 'discard', { cardId: 'kd-1' });
    expect(done.order[done.turn]).toBe('b');
  });

  it('un joker récupéré doit être reposé dans le tour', () => {
    const t = table({
      hands: { a: '6s 9h 9d 2c', b: '3c 4c 8c' },
      melds: [meldOf('m1', 'b', '5s jk 7s')],
      opened: ['a', 'b'],
    });
    const s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    expect(refused(t, s, 'a', 'swap', { meldId: 'm1', cardId: '9h-1' })).toContain('6♠');
    const swapped = act(t, s, 'a', 'swap', { meldId: 'm1', cardId: '6s-1' });
    expect(swapped.melds[0]!.cards.map((c) => c.entry)).toEqual(['5s', '6s', '7s']);
    expect(uids(swapped.hands.a!)).toContain('jk-1');
    expect(swapped.mustUse).toEqual(['jk-1']);
    expect(refused(t, swapped, 'a', 'discard', { cardId: '2c-1' })).toBe(
      'Reposez d’abord le joker récupéré sur la table.',
    );
    const relaid = act(t, swapped, 'a', 'meld', { cardIds: ['9h-1', '9d-1', 'jk-1'] });
    expect(relaid.mustUse).toEqual([]);
    expect(relaid.melds[1]!.cards.find((c) => c.entry === 'jk')!.stands).toEqual(['s', 'c']);
    const done = act(t, relaid, 'a', 'discard', { cardId: '2c-1' });
    expect(done.order[done.turn]).toBe('b');
  });
});

describe('Rami 51 : fin de manche', () => {
  /** a a déjà ouvert : il pioche le 4♣ (second jeu), le pose sur sa suite et défausse sa dernière carte. */
  const goOut = (scores: Record<string, number>) => {
    const t = table({
      hands: { a: '3c', b: 'jk as kd 5h', c: '2d' },
      melds: [meldOf('m1', 'a', '5c 6c 7c')],
      opened: ['a'],
      scores,
    });
    let s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    s = act(t, s, 'a', 'layoff', { meldId: 'm1', cardIds: ['4c-2'] });
    expect(s.hands.a!.map((c) => c.uid)).toEqual(['3c-1']);
    return { t, out: act(t, s, 'a', 'discard', { cardId: '3c-1' }) };
  };

  it('la manche se termine quand un joueur défausse sa dernière carte ; les autres comptent leur main', () => {
    const { t, out } = goOut({ a: 10, b: 20, c: 30 });
    expect(out.phase).toBe('round-over');
    expect(out.roundWinner).toBe('a');
    expect(out.ramiSec).toBe(false);
    expect(out.result!.penalties).toEqual({ a: 0, b: 46, c: 2 });
    expect(out.scores).toEqual({ a: 10, b: 66, c: 32 });
    expect(out.lastEvent).toBe('A termine la manche !');
    expect(t.timers.has('next-round')).toBe(true);
    expect(t.timers.has('turn')).toBe(false);
    const pub = rami51.getPublicState(out) as {
      result: { hands: Record<string, RamiCard[]> } | null;
      current: unknown;
    };
    expect(uids(pub.result!.hands.b!)).toEqual(uids(cards('jk as kd 5h')));
    expect(pub.current).toBeNull();
    expect(rami51.handleAction(out, P('b'), 'draw', { from: 'deck' }, t.ctx).ok).toBe(false);
    // Le minuteur de fin de manche lance la suivante.
    const next = rami51.onTimer(out, 'next-round', t.ctx);
    expect(next.phase).toBe('play');
    expect(next.round).toBe(out.round + 1);
    expect(next.scores).toEqual(out.scores);
    expect((rami51.getPublicState(next) as { result: unknown }).result).toBeNull();
  });

  it('rami sec : ouvrir et finir dans le même tour double les pénalités des autres', () => {
    const t = table({ hands: { a: '10h jh qh kh 4c', b: 'jk as kd 5h', c: '2d' }, draw: '9c-2 ah' });
    const s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    const opened = act(t, s, 'a', 'open', { melds: [['10h-1', 'jh-1', 'qh-1', 'kh-1', 'ah-1']] });
    expect(opened.openedThisTurn).toBe(true);
    const out = act(t, opened, 'a', 'discard', { cardId: '4c-1' });
    expect(out.phase).toBe('round-over');
    expect(out.ramiSec).toBe(true);
    expect(out.result!.penalties).toEqual({ a: 0, b: 92, c: 4 });
    expect(out.lastEvent).toContain('Rami sec');
  });

  it('la partie s’arrête quand un total atteint l’objectif : le plus petit total gagne', () => {
    const { t, out: fin } = goOut({ a: 100, b: 470, c: 60 });
    expect(fin.phase).toBe('final');
    expect(rami51.isFinished(fin)).toBe(true);
    expect(fin.scores).toEqual({ a: 100, b: 516, c: 62 });
    expect(fin.lastEvent).toContain('C gagne avec 62 points');
    expect(t.timers.has('next-round')).toBe(false);
  });

  it('classe dans l’ordre croissant des totaux, ex æquo au même rang', () => {
    const t = table({ hands: { a: '3c', b: '4c', c: '5c' }, scores: { a: 120, b: 30, c: 30 } });
    expect(rami51.calculateScores(t.state)).toEqual([
      { playerId: 'b', name: 'B', points: 30, rank: 1 },
      { playerId: 'c', name: 'C', points: 30, rank: 1 },
      { playerId: 'a', name: 'A', points: 120, rank: 3 },
    ]);
  });

  it('pioche vide : la défausse sauf sa carte du dessus est mélangée ; sinon la manche s’arrête sans gagnant', () => {
    const t = table({ hands: { a: '2s 5d 9c', b: '3h 4h 8c' }, draw: '6d', discard: '2h 3s 4d' });
    let s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    expect(s.draw).toHaveLength(0);
    s = act(t, s, 'a', 'discard', { cardId: '9c-1' });
    expect(s.discard.map((c) => c.uid)).toEqual(['9c-1']);
    expect(uids(s.draw)).toEqual(['2h-1', '3s-1', '4d-1']);
    expect(s.order[s.turn]).toBe('b');
    expect(s.lastEvent).toContain('défausse est mélangée');

    const t2 = table({ hands: { a: '2s 5d 9c', b: '3h 4h 8c' }, draw: '6d', discard: '' });
    let x = act(t2, t2.state, 'a', 'draw', { from: 'deck' });
    x = act(t2, x, 'a', 'discard', { cardId: '9c-1' });
    expect(x.phase).toBe('round-over');
    expect(x.roundWinner).toBeNull();
    expect(x.result!.penalties).toEqual({ a: 2 + 5 + 6, b: 3 + 4 + 8 });
    expect(x.lastEvent).toContain('sans gagnant');
  });
});

describe('Rami 51 : temps écoulé et annulation', () => {
  it('temps écoulé sans pioche : le joueur pioche puis défausse sa carte la plus forte hors joker', () => {
    const t = table({ hands: { a: 'jk 2c ks 9d', b: '3h 4h 8c' }, draw: '2c-2 5h', settings: { turnSeconds: 60 } });
    const s = rami51.onTimer(t.state, 'turn', t.ctx);
    expect(uids(s.hands.a!)).toEqual(uids(cards('jk 2c 9d 5h')));
    expect(s.discard[s.discard.length - 1]!.uid).toBe('ks-1');
    expect(s.order[s.turn]).toBe('b');
    expect(s.lastEvent).toBe('Temps écoulé : A pioche et défausse le R♠.');
    expect(t.timers.get('turn')).toBe(60_000);
  });

  it('temps écoulé après la prise de la défausse : la carte y retourne, puis pioche et défausse', () => {
    const t = table({ hands: { a: '5h 6h kd 2c', b: '3c 4c 8c' }, discard: '2d 7h', draw: '9s-2 4s', opened: ['a'] });
    let s = act(t, t.state, 'a', 'draw', { from: 'discard' });
    s = act(t, s, 'a', 'meld', { cardIds: ['5h-1', '6h-1', '7h-1'] });
    const after = rami51.onTimer(s, 'turn', t.ctx);
    expect(after.melds).toHaveLength(0);
    expect(uids(after.hands.a!)).toEqual(uids(cards('5h 6h 2c 4s')));
    expect(after.discard.map((c) => c.uid)).toEqual(['2d-1', '7h-1', 'kd-1']);
    expect(after.order[after.turn]).toBe('b');
  });

  it('temps écoulé avec un joker récupéré non reposé : retour au début du tour', () => {
    const t = table({
      hands: { a: '6s 9h 2c', b: '3c 4c 8c' },
      melds: [meldOf('m1', 'b', '5s jk 7s')],
      opened: ['a', 'b'],
      draw: '9s-2 kh',
    });
    let s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    s = act(t, s, 'a', 'swap', { meldId: 'm1', cardId: '6s-1' });
    const after = rami51.onTimer(s, 'turn', t.ctx);
    expect(after.melds[0]!.cards.map((c) => c.entry)).toEqual(['5s', 'jk', '7s']);
    expect(uids(after.hands.a!)).toEqual(uids(cards('6s 9h 2c')));
    expect(after.discard[after.discard.length - 1]!.uid).toBe('kh-1');
  });

  it('temps écoulé après des poses valables : elles restent, la carte la plus forte est défaussée', () => {
    const t = table({ hands: { a: '8h 9h 10h ks kh kd 2c 5d', b: '3c 4c 8c' }, draw: '9s-2 qs' });
    let s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    s = act(t, s, 'a', 'open', {
      melds: [
        ['8h-1', '9h-1', '10h-1'],
        ['ks-1', 'kh-1', 'kd-1'],
      ],
    });
    const after = rami51.onTimer(s, 'turn', t.ctx);
    expect(after.melds).toHaveLength(2);
    expect(after.opened.a).toBe(true);
    expect(uids(after.hands.a!)).toEqual(uids(cards('2c 5d')));
    expect(after.discard[after.discard.length - 1]!.uid).toBe('qs-1');
  });

  it('annuler reprend les poses du tour ; une prise de défausse sans pose retourne sur la défausse', () => {
    const t = table({ hands: { a: '8h 9h 10h ks kh kd 2c 5d', b: '3c 4c 8c' }, discard: '9s-2 jh' });
    expect(refused(t, t.state, 'a', 'undo')).toContain('pas encore pioché');
    let s = act(t, t.state, 'a', 'draw', { from: 'deck' });
    expect(refused(t, s, 'a', 'undo')).toBe('Rien à annuler.');
    const opened = act(t, s, 'a', 'open', {
      melds: [
        ['8h-1', '9h-1', '10h-1'],
        ['ks-1', 'kh-1', 'kd-1'],
      ],
    });
    const undone = act(t, opened, 'a', 'undo');
    expect(undone.melds).toHaveLength(0);
    expect(undone.opened.a).toBe(false);
    expect(uids(undone.hands.a!)).toEqual(uids(s.hands.a!));
    expect(undone.drawn).toBe('deck');
    expect(undone.lastEvent).toBe('A reprend les cartes posées ce tour.');

    s = act(t, t.state, 'a', 'draw', { from: 'discard' });
    const meld = act(t, s, 'a', 'open', {
      melds: [
        ['8h-1', '9h-1', '10h-1', 'jh-1'],
        ['ks-1', 'kh-1', 'kd-1'],
      ],
    });
    const back = act(t, meld, 'a', 'undo');
    expect(back.mustUse).toEqual(['jh-1']);
    const putBack = act(t, back, 'a', 'undo');
    expect(putBack.drawn).toBeNull();
    expect(putBack.discard.map((c) => c.uid)).toEqual(['9s-2', 'jh-1']);
    expect(uids(putBack.hands.a!)).toEqual(uids(t.state.hands.a!));
    expect(putBack.lastEvent).toBe('A repose le V♥ sur la défausse.');
  });
});

describe('Rami 51 : vues', () => {
  it('ne révèle jamais la main d’un autre joueur avant la fin de la manche', () => {
    const ids = ['a', 'b', 'c'];
    const h = makeCtx(ids, seeded(3));
    const init = rami51.initialize(rami51.settingsSchema.parse({}), ids.map(P), h.ctx);
    const res = rami51.start(init, h.ctx);
    if (!res.ok) throw new Error(res.error);
    let s = res.state;
    const current = s.order[s.turn]!;
    s = act(h, s, current, 'draw', { from: 'deck' });
    const pub = rami51.getPublicState(s) as Record<string, unknown>;
    const text = JSON.stringify(pub);
    for (const id of ids) for (const c of s.hands[id]!) expect(text).not.toContain(`"${c.uid}"`);
    for (const c of s.draw) expect(text).not.toContain(`"${c.uid}"`);
    expect(pub.result).toBeNull();
    expect(pub).not.toHaveProperty('hands');
    expect(pub).not.toHaveProperty('draw');
    expect(text).not.toContain('Snap');
    expect(pub.counts).toEqual({ a: s.hands.a!.length, b: s.hands.b!.length, c: s.hands.c!.length });
    expect(pub.drawCount).toBe(s.draw.length);

    for (const id of ids) {
      const me = rami51.getPlayerState(s, id) as { hand: RamiCard[]; isMyTurn: boolean; canTakeDiscard: boolean };
      const mine = JSON.stringify(me);
      expect(uids(me.hand)).toEqual(uids(s.hands[id]!));
      for (const other of ids.filter((o) => o !== id)) {
        for (const c of s.hands[other]!) expect(mine).not.toContain(`"${c.uid}"`);
      }
      expect(me.isMyTurn).toBe(id === current);
      expect(me.canTakeDiscard).toBe(false);
    }
    expect(rami51.getHostState(s)).toEqual(pub);
  });

  it('la notice respecte le format éditable de l’administration', () => {
    expect(noticeSchema.safeParse(rami51.manifest.notice).success).toBe(true);
    expect(rami51.manifest).toMatchObject({
      id: 'rami-51',
      category: 'cartes',
      name: 'Rami 51',
      minPlayers: 2,
      maxPlayers: 5,
    });
    expect(rami51.defaultSettings).toEqual({ targetScore: 500, openingPoints: 51, turnSeconds: 90 });
  });
});

describe('Rami 51 : parties de robots', () => {
  const run = (players: number, seed: number, settings: Record<string, unknown> = {}) => {
    const ids = ['a', 'b', 'c', 'd', 'e'].slice(0, players);
    const random = seeded(seed);
    const h = makeCtx(ids, random);
    const init = rami51.initialize(rami51.settingsSchema.parse({ turnSeconds: 0, ...settings }), ids.map(P), h.ctx);
    const res = rami51.start(init, h.ctx);
    if (!res.ok) throw new Error(res.error);
    let state = res.state;
    let steps = 0;
    let keys = new Set<string>();
    let lastRound = state.round;
    let opens = 0;
    while (!rami51.isFinished(state) && steps < 60_000) {
      steps++;
      const all = everyCard(state);
      expect(all.length).toBe(108);
      expect(new Set(all).size).toBe(108);
      if (state.phase === 'round-over') {
        state = rami51.nextRound(state, h.ctx);
        continue;
      }
      if (state.round !== lastRound) {
        keys = new Set();
        lastRound = state.round;
      }
      const actor = state.order[state.turn]!;
      for (const id of ids) if (id !== actor) expect(rami51.suggest!(state, id, random)).toBeNull();
      const sug = rami51.suggest!(state, actor, random);
      expect(sug, `le robot ${actor} doit proposer une action`).toBeTruthy();
      expect(keys.has(sug!.key), 'la clé change à chaque coup').toBe(false);
      keys.add(sug!.key);
      const out = rami51.handleAction(state, P(actor), sug!.type, sug!.payload, h.ctx);
      expect(out.ok, out.ok ? '' : `${sug!.type} : ${out.error}`).toBe(true);
      if (sug!.type === 'open') opens++;
      if (out.ok) state = out.state;
    }
    return { state, steps, opens };
  };

  for (const [players, seed] of [
    [2, 1],
    [3, 2],
    [4, 3],
    [5, 4],
    [2, 5],
    [3, 6],
  ] as const) {
    it(`${players} robots (graine ${seed}) jouent une partie complète sans blocage`, () => {
      const { state, steps, opens } = run(players, seed);
      expect(rami51.isFinished(state), `partie non terminée après ${steps} actions`).toBe(true);
      expect(Math.max(...Object.values(state.scores))).toBeGreaterThanOrEqual(500);
      expect(opens).toBeGreaterThan(0);
      const ranking = rami51.calculateScores(state);
      expect(ranking[0]!.points).toBe(Math.min(...Object.values(state.scores)));
      expect(ranking[0]!.rank).toBe(1);
    });
  }
});
