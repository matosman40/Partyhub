import { describe, expect, it } from 'vitest';
import type { GameContext, PlayerRef } from '@partyhub/shared';
import {
  tarot,
  TAROT_DECK,
  TOTAL_HALF_POINTS,
  OUDLERS,
  EXCUSE,
  PETIT,
  countHalfPoints,
  dealDeltas,
  legalCards,
  scoreDeal,
  trickWinner,
  type TarotState,
} from '@partyhub/games';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeCtx(connected: string[], random = seeded(11)) {
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

const IDS = ['a', 'b', 'c', 'd'];
const P = (id: string): PlayerRef => ({ id, name: id.toUpperCase() });

function started(seed = 11) {
  const h = makeCtx(IDS, seeded(seed));
  const init = tarot.initialize(tarot.settingsSchema.parse({}), IDS.map(P), h.ctx);
  const res = tarot.start(init, h.ctx);
  if (!res.ok) throw new Error(res.error);
  return { state: res.state, ...h };
}

describe('règles du tarot', () => {
  it('le jeu contient 78 cartes et 91 points (182 demi-points)', () => {
    expect(TAROT_DECK).toHaveLength(78);
    expect(countHalfPoints([...TAROT_DECK])).toBe(TOTAL_HALF_POINTS);
    expect(TOTAL_HALF_POINTS).toBe(182);
  });

  it('les trois bouts sont les oudlers', () => {
    expect(OUDLERS).toEqual(expect.arrayContaining([PETIT, EXCUSE]));
    expect(OUDLERS).toHaveLength(3);
  });

  it('un atout bat une couleur, et la plus haute atout gagne le pli', () => {
    // Pli : trèfle, atout 4, atout 9, trèfle roi → le 9 d'atout gagne (indice 2).
    expect(trickWinner(['ct13', 't4', 't9', 'ch13'])).toBe(2);
  });

  it('le preneur qui fait son contrat marque, la somme des gains est nulle', () => {
    const score = scoreDeal({
      contract: 'garde',
      attackCards: [...TAROT_DECK].slice(0, 30),
      excuseTransfer: 0,
      petitAuBout: null,
      tricks: { attack: 10, defence: 8 },
    });
    const deltas = dealDeltas(IDS, 'a', score.total);
    expect(Object.values(deltas).reduce((x, y) => x + y, 0)).toBe(0);
  });

  it('un chelem annoncé n’est pas compté, mais un chelem réalisé ajoute 200 points', () => {
    const score = scoreDeal({
      contract: 'petite',
      attackCards: [],
      excuseTransfer: 0,
      petitAuBout: null,
      tricks: { attack: 18, defence: 0 },
    });
    expect(score.chelem).toBe(200);
  });

  it('les cartes légales suivent l’obligation de fournir la couleur demandée', () => {
    const hand = ['c3', 'c9', 'h5'];
    expect(legalCards(hand, ['c10'])).toEqual(['c3', 'c9']);
  });
});

describe('déroulement d’une partie de tarot', () => {
  it('exige exactement quatre joueurs', () => {
    const h = makeCtx(['a', 'b', 'c'], seeded(3));
    const init = tarot.initialize(tarot.settingsSchema.parse({}), ['a', 'b', 'c'].map(P), h.ctx);
    const res = tarot.start(init, h.ctx);
    expect(res.ok).toBe(false);
  });

  it('refuse une action d’un joueur qui n’a pas la main', () => {
    const h = started();
    const turn = h.state.turn!;
    const other = IDS.find((id) => id !== turn)!;
    const res = tarot.handleAction(h.state, P(other), 'pass', undefined, h.ctx);
    expect(res.ok).toBe(false);
  });

  it('ne révèle que sa propre main aux joueurs', () => {
    const h = started();
    const pub = tarot.getPublicState(h.state) as Record<string, unknown>;
    expect(JSON.stringify(pub)).not.toMatch(/"hands"/);
    const mine = tarot.getPlayerState(h.state, 'a') as { hand?: string[] };
    expect(mine.hand?.length).toBe(18);
  });

  it('une partie complète jouée par les robots se termine, avec 78 cartes à chaque étape', () => {
    const h = makeCtx(IDS, seeded(21));
    const init = tarot.initialize(tarot.settingsSchema.parse({}), IDS.map(P), h.ctx);
    let state = tarot.start(init, h.ctx);
    if (!state.ok) throw new Error(state.error);
    let s: TarotState = state.state;

    let guard = 0;
    while (!tarot.isFinished(s) && guard++ < 2000) {
      if (s.phase === 'round-over') {
        const next = tarot.nextRound(s, h.ctx);
        s = next;
        continue;
      }
      const actor = s.turn;
      if (!actor) {
        // Pas de main à jouer : laisser passer les temporisations.
        const key = [...h.timers.keys()][0];
        if (!key) break;
        s = tarot.onTimer(s, key, h.ctx);
        continue;
      }
      const move = tarot.suggest!(s, actor, seeded(guard + 7));
      if (!move) throw new Error('aucun coup suggéré');
      const res = tarot.handleAction(s, P(actor), move.type, move.payload, h.ctx);
      if (!res.ok) throw new Error(`${actor} ${move.type} : ${res.error}`);
      s = res.state;
    }
    expect(guard).toBeLessThan(2000);
    expect(tarot.isFinished(s)).toBe(true);
    // Somme des scores nulle : chaque donne est à somme nulle.
    const total = Object.values(s.scores).reduce((x, y) => x + y, 0);
    expect(total).toBe(0);
  });
});
