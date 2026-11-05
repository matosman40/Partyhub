import { describe, expect, it } from 'vitest';
import { BANQUE, MAX_POINTS, pointsEstimation, tirageEstimer } from '../tirage/module.js';
import { A, B, PLAYERS, mulberry32, must } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

describe('points d’une estimation', () => {
  it('donne le maximum pile sur la bonne valeur', () => {
    expect(pointsEstimation(1000, 1000, 0.5)).toBe(MAX_POINTS);
  });

  it('décroît avec l’écart relatif, et s’annule au-delà de la tolérance', () => {
    expect(pointsEstimation(1100, 1000, 0.5)).toBeGreaterThan(pointsEstimation(1300, 1000, 0.5));
    expect(pointsEstimation(1600, 1000, 0.5)).toBe(0);
  });

  it('une tolérance plus étroite rapporte moins pour le même écart', () => {
    expect(pointsEstimation(1200, 1000, 1)).toBeGreaterThan(pointsEstimation(1200, 1000, 0.2));
  });
});

describe('banque du mode Estimer', () => {
  it('chaque entrée a une valeur, une source et un identifiant unique', () => {
    expect(new Set(BANQUE.map((e) => e.id)).size).toBe(BANQUE.length);
    for (const e of BANQUE) {
      expect(e.source).toMatch(/^https:\/\/www\.wikidata\.org\//);
      expect(e.valeur).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('déroulé d’une partie Tirage surprise', () => {
  function setup(rounds = 2, difficulty = 2) {
    const h = harness({ connected: [A.id, B.id], random: mulberry32(7) });
    let s = tirageEstimer.initialize({ rounds, guessSeconds: 60, difficulty }, [A, B], h.ctx);
    s = must(tirageEstimer.start(s, h.ctx));
    return { h, s };
  }

  it('tire des entrées sans répétition, en nombre demandé', () => {
    const { s } = setup(5);
    expect(s.entrees).toHaveLength(5);
    expect(new Set(s.entrees.map((e) => e.id)).size).toBe(5);
  });

  it('cache les estimations des autres et la réponse pendant la devinette', () => {
    const { h, s } = setup();
    const apres = must(tirageEstimer.handleAction(s, A, 'estimate', { valeur: 5 }, h.ctx));
    const pub = tirageEstimer.getPublicState(apres) as { answer: unknown; placements: unknown[]; answered: number };
    expect(pub.answer).toBeNull();
    expect(pub.placements).toEqual([]);
    expect(pub.answered).toBe(1);
    const vueB = tirageEstimer.getPlayerState(apres, B.id) as { myGuess: unknown; guessed: boolean };
    expect(vueB.myGuess).toBeNull();
    expect(vueB.guessed).toBe(false);
  });

  it('révèle quand tous ont répondu, et attribue les points selon l’écart', () => {
    const { h, s } = setup();
    const valeur = s.entrees[0]!.valeur;
    let st = must(tirageEstimer.handleAction(s, A, 'estimate', { valeur }, h.ctx));
    expect(st.phase).toBe('guess');
    st = must(tirageEstimer.handleAction(st, B, 'estimate', { valeur: Math.round(valeur * 1.5) + 1 }, h.ctx));
    expect(st.phase).toBe('reveal');
    expect(st.points[A.id]).toBe(MAX_POINTS);
    expect(st.points[B.id] ?? 0).toBeLessThan(MAX_POINTS);
  });

  it('le délai révèle la question, et un absent ne marque rien', () => {
    const { h, s } = setup();
    let st = must(tirageEstimer.handleAction(s, A, 'estimate', { valeur: 1 }, h.ctx));
    st = tirageEstimer.onTimer(st, 'estimate-timeout', h.ctx);
    expect(st.phase).toBe('reveal');
    expect(st.manches[0]!.gains[B.id]).toBe(0);
  });

  it('enchaîne les questions puis termine', () => {
    const { h, s } = setup(2);
    let st = tirageEstimer.onTimer(s, 'estimate-timeout', h.ctx);
    st = tirageEstimer.onTimer(st, 'reveal-next', h.ctx);
    expect(st.index).toBe(1);
    st = tirageEstimer.onTimer(st, 'estimate-timeout', h.ctx);
    st = tirageEstimer.onTimer(st, 'reveal-next', h.ctx);
    expect(tirageEstimer.isFinished(st)).toBe(true);
  });

  it('refuse une estimation hors devinette ou d’un inconnu', () => {
    const { h, s } = setup();
    expect(tirageEstimer.handleAction(s, { id: 'x', name: 'Inconnu' }, 'estimate', { valeur: 1 }, h.ctx).ok).toBe(
      false,
    );
    expect(tirageEstimer.handleAction(s, A, 'autre', {}, h.ctx).ok).toBe(false);
    const fin = tirageEstimer.onTimer(s, 'estimate-timeout', h.ctx);
    expect(tirageEstimer.handleAction(fin, A, 'estimate', { valeur: 1 }, h.ctx).ok).toBe(false);
  });
});
