import { describe, expect, it } from 'vitest';
import {
  BANQUE,
  BANQUE_IDENTIFICATION,
  MAX_POINTS,
  POINTS_IDENTIFICATION,
  pointsEstimation,
  pointsIdentification,
  preparerIdentification,
  tirageSurprise,
  type TirageState,
} from '../tirage/module.js';
import { A, B, mulberry32, must } from './aventure-helpers.js';
import { harness } from './turn-harness.js';

/** Met une estimation de la banque en tête de partie, pour les tests qui jouent des estimations. */
function estimationEnTete(s: TirageState): TirageState {
  const tete = BANQUE[0]!;
  return { ...s, entrees: s.entrees.map((e, i) => (i === 0 ? tete : e)) };
}

/** Met une identification de la banque, avec ses choix, en tête de partie. */
function identificationEnTete(s: TirageState): TirageState {
  const auteurs = BANQUE_IDENTIFICATION.map((e) => e.reponse);
  const tete = preparerIdentification(BANQUE_IDENTIFICATION[0]!, auteurs, mulberry32(1))!;
  return { ...s, entrees: s.entrees.map((e, i) => (i === 0 ? tete : e)) };
}

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
  function setup(rounds = 2, difficulty = 2, kind: 'estimer' | 'identifier' = 'estimer') {
    const h = harness({ connected: [A.id, B.id], random: mulberry32(7) });
    let s = tirageSurprise.initialize({ rounds, guessSeconds: 60, difficulty }, [A, B], h.ctx);
    s = kind === 'estimer' ? estimationEnTete(s) : identificationEnTete(s);
    s = must(tirageSurprise.start(s, h.ctx));
    return { h, s };
  }

  it('tire des entrées sans répétition, en nombre demandé', () => {
    const { s } = setup(5);
    expect(s.entrees).toHaveLength(5);
    expect(new Set(s.entrees.map((e) => e.id)).size).toBe(5);
  });

  it('cache les estimations des autres et la réponse pendant la devinette', () => {
    const { h, s } = setup();
    const apres = must(tirageSurprise.handleAction(s, A, 'estimate', { valeur: 5 }, h.ctx));
    const pub = tirageSurprise.getPublicState(apres) as { answer: unknown; placements: unknown[]; answered: number };
    expect(pub.answer).toBeNull();
    expect(pub.placements).toEqual([]);
    expect(pub.answered).toBe(1);
    const vueB = tirageSurprise.getPlayerState(apres, B.id) as { myGuess: unknown; guessed: boolean };
    expect(vueB.myGuess).toBeNull();
    expect(vueB.guessed).toBe(false);
  });

  it('révèle quand tous ont répondu, et attribue les points selon l’écart', () => {
    const { h, s } = setup();
    const valeur = s.entrees[0]!.valeur;
    let st = must(tirageSurprise.handleAction(s, A, 'estimate', { valeur }, h.ctx));
    expect(st.phase).toBe('guess');
    st = must(tirageSurprise.handleAction(st, B, 'estimate', { valeur: Math.round(valeur * 1.5) + 1 }, h.ctx));
    expect(st.phase).toBe('reveal');
    expect(st.points[A.id]).toBe(MAX_POINTS);
    expect(st.points[B.id] ?? 0).toBeLessThan(MAX_POINTS);
  });

  it('le délai révèle la question, et un absent ne marque rien', () => {
    const { h, s } = setup();
    let st = must(tirageSurprise.handleAction(s, A, 'estimate', { valeur: 1 }, h.ctx));
    st = tirageSurprise.onTimer(st, 'estimate-timeout', h.ctx);
    expect(st.phase).toBe('reveal');
    expect(st.manches[0]!.gains[B.id]).toBe(0);
  });

  it('enchaîne les questions puis termine', () => {
    const { h, s } = setup(2);
    let st = tirageSurprise.onTimer(s, 'estimate-timeout', h.ctx);
    st = tirageSurprise.onTimer(st, 'reveal-next', h.ctx);
    expect(st.index).toBe(1);
    st = tirageSurprise.onTimer(st, 'estimate-timeout', h.ctx);
    st = tirageSurprise.onTimer(st, 'reveal-next', h.ctx);
    expect(tirageSurprise.isFinished(st)).toBe(true);
  });

  it('refuse une estimation hors devinette ou d’un inconnu', () => {
    const { h, s } = setup();
    expect(tirageSurprise.handleAction(s, { id: 'x', name: 'Inconnu' }, 'estimate', { valeur: 1 }, h.ctx).ok).toBe(
      false,
    );
    expect(tirageSurprise.handleAction(s, A, 'autre', {}, h.ctx).ok).toBe(false);
    const fin = tirageSurprise.onTimer(s, 'estimate-timeout', h.ctx);
    expect(tirageSurprise.handleAction(fin, A, 'estimate', { valeur: 1 }, h.ctx).ok).toBe(false);
  });
});

describe('banque du mode Identifier', () => {
  it('chaque entrée a une réponse, une image locale et une source ouverte (Met ou iNaturalist)', () => {
    expect(new Set(BANQUE_IDENTIFICATION.map((e) => e.id)).size).toBe(BANQUE_IDENTIFICATION.length);
    for (const e of BANQUE_IDENTIFICATION) {
      expect(e.reponse.length).toBeGreaterThan(0);
      expect(e.image).toMatch(/^\/tirage\/(met|inat)\/\d+\.(jpg|png|gif)$/);
      expect(e.source).toMatch(/^https:\/\/www\.(metmuseum\.org|inaturalist\.org)\//);
    }
  });

  it('les espèces portent un crédit de photographe ; les tableaux du Met n’en ont pas besoin', () => {
    for (const e of BANQUE_IDENTIFICATION) {
      if (e.source.includes('inaturalist')) expect(e.credit).toMatch(/CC (BY|BY-SA)|CC0/);
    }
  });

  it('chaque thème a assez de réponses distinctes pour quatre choix', () => {
    for (const theme of new Set(BANQUE_IDENTIFICATION.map((e) => e.theme))) {
      const reponses = new Set(BANQUE_IDENTIFICATION.filter((e) => e.theme === theme).map((e) => e.reponse));
      expect(reponses.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('prépare quatre choix distincts, dont la bonne réponse à l’index indiqué', () => {
    const auteurs = BANQUE_IDENTIFICATION.map((e) => e.reponse);
    const prete = preparerIdentification(BANQUE_IDENTIFICATION[0]!, auteurs, mulberry32(3));
    expect(prete).not.toBeNull();
    expect(prete!.choix).toHaveLength(4);
    expect(new Set(prete!.choix).size).toBe(4);
    expect(prete!.choix[prete!.bonne]).toBe(BANQUE_IDENTIFICATION[0]!.reponse);
  });

  it('renvoie null s’il n’y a pas assez d’auteurs distincts', () => {
    const base = BANQUE_IDENTIFICATION[0]!;
    expect(preparerIdentification(base, [base.reponse, 'Seul'], mulberry32(1))).toBeNull();
  });
});

describe('points d’une identification', () => {
  it('rapporte les points pleins pour la bonne réponse, rien sinon', () => {
    expect(pointsIdentification(2, 2)).toBe(POINTS_IDENTIFICATION);
    expect(pointsIdentification(1, 2)).toBe(0);
  });
});

describe('déroulé en mode Identifier', () => {
  function setup() {
    const h = harness({ connected: [A.id, B.id], random: mulberry32(7) });
    let s = tirageSurprise.initialize({ rounds: 3, guessSeconds: 60, difficulty: 2 }, [A, B], h.ctx);
    s = identificationEnTete(s);
    s = must(tirageSurprise.start(s, h.ctx));
    return { h, s };
  }

  it('publie la question, l’image et les choix pendant la devinette, sans la réponse', () => {
    const { s } = setup();
    const pub = tirageSurprise.getPublicState(s) as {
      kind: string;
      image: string | null;
      choices: string[] | null;
      answer: unknown;
    };
    expect(pub.kind).toBe('identifier');
    expect(pub.image).toMatch(/^\/tirage\//);
    expect(pub.choices).toHaveLength(4);
    expect(pub.answer).toBeNull();
  });

  it('attribue les points à la bonne réponse et rien aux autres', () => {
    const { h, s } = setup();
    const entree = s.entrees[0] as { kind: 'identifier'; bonne: number };
    let st = must(tirageSurprise.handleAction(s, A, 'choose', { choix: entree.bonne }, h.ctx));
    st = must(tirageSurprise.handleAction(st, B, 'choose', { choix: (entree.bonne + 1) % 4 }, h.ctx));
    expect(st.phase).toBe('reveal');
    expect(st.points[A.id]).toBe(POINTS_IDENTIFICATION);
    expect(st.points[B.id] ?? 0).toBe(0);
  });

  it('refuse une estimation sur une question à choix, et un choix hors liste', () => {
    const { h, s } = setup();
    expect(tirageSurprise.handleAction(s, A, 'estimate', { valeur: 5 }, h.ctx).ok).toBe(false);
    expect(tirageSurprise.handleAction(s, A, 'choose', { choix: 9 }, h.ctx).ok).toBe(false);
  });

  it('montre les choix avec le texte de chaque joueur, à la révélation', () => {
    const { h, s } = setup();
    const entree = s.entrees[0] as { kind: 'identifier'; bonne: number; reponse: string; choix: string[] };
    let st = must(tirageSurprise.handleAction(s, A, 'choose', { choix: entree.bonne }, h.ctx));
    st = tirageSurprise.onTimer(st, 'estimate-timeout', h.ctx);
    const pub = tirageSurprise.getPublicState(st) as {
      choices: unknown;
      answer: { reponse: string };
      placements: Array<{ playerId: string; choice: string | null }>;
    };
    expect(pub.choices).toBeNull();
    expect(pub.answer.reponse).toBe(entree.reponse);
    expect(pub.placements.find((p) => p.playerId === A.id)?.choice).toBe(entree.reponse);
    expect(pub.placements.find((p) => p.playerId === B.id)?.choice).toBeNull();
  });
});
