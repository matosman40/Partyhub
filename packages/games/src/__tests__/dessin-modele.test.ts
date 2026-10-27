import { describe, expect, it } from 'vitest';
import {
  HISTORIQUE_VIDE,
  VUE_INITIALE,
  ajouter,
  annuler,
  clamperEchelle,
  contraindre,
  epaisseur,
  longueurEncre,
  longueurTrait,
  refaire,
  segmentsLisses,
  tailleTampon,
  toutEffacer,
  versEcran,
  versMonde,
  zoomer,
  type Element,
  type TraitLibre,
} from '../client/dessin/modele.js';

const trait = (points: { x: number; y: number }[], extra: Partial<TraitLibre> = {}): TraitLibre => ({
  type: 'libre',
  mode: 'dessin',
  pinceau: 'stylo',
  couleur: '#ffffff',
  taille: 10,
  points,
  ...extra,
});

const tampon = (x: number, y: number): Element => ({ type: 'tampon', symbole: '⭐', x, y, taille: 8, rotation: 0 });

describe('Dessin : historique annuler et refaire', () => {
  it('annuler puis refaire remet le dernier élément, dans le même ordre', () => {
    const a = trait([{ x: 0, y: 0 }]);
    const b = tampon(10, 10);
    let h = ajouter(ajouter(HISTORIQUE_VIDE, a), b);
    h = annuler(h);
    expect(h.elements).toEqual([a]);
    h = refaire(h);
    expect(h.elements).toEqual([a, b]);
  });

  it('un nouveau trait après une annulation vide la pile « refaire »', () => {
    let h = ajouter(HISTORIQUE_VIDE, trait([{ x: 0, y: 0 }]));
    h = annuler(h);
    h = ajouter(h, tampon(1, 1));
    expect(h.refaits).toEqual([]);
    expect(refaire(h)).toBe(h);
  });

  it('annuler sur un dessin vide ne change rien', () => {
    expect(annuler(HISTORIQUE_VIDE)).toBe(HISTORIQUE_VIDE);
  });

  it('tout effacer repart d’une feuille vide', () => {
    expect(toutEffacer()).toEqual(HISTORIQUE_VIDE);
  });
});

describe('Dessin : longueur d’encre', () => {
  it('mesure un trait droit en unités du dessin', () => {
    expect(
      longueurTrait([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBe(5);
  });

  it('compte les traits de dessin, pas la gomme ni les tampons', () => {
    const elements: Element[] = [
      trait([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
      trait(
        [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
        ],
        { mode: 'gomme' },
      ),
      tampon(5, 5),
    ];
    expect(longueurEncre(elements)).toBe(5);
  });
});

describe('Dessin : lissage des traits', () => {
  it('un seul point ne produit aucun segment', () => {
    expect(segmentsLisses([{ x: 0, y: 0 }])).toEqual([]);
  });

  it('deux points donnent un segment qui finit au second point', () => {
    expect(
      segmentsLisses([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toEqual([{ controle: { x: 10, y: 0 }, fin: { x: 10, y: 0 } }]);
  });

  it('les milieux servent de points de fin, les points bruts de contrôle', () => {
    const segments = segmentsLisses([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(segments).toEqual([
      { controle: { x: 10, y: 0 }, fin: { x: 10, y: 5 } },
      { controle: { x: 10, y: 10 }, fin: { x: 10, y: 10 } },
    ]);
  });
});

describe('Dessin : épaisseur des pinceaux', () => {
  it('chaque pinceau module la taille réglée', () => {
    expect(epaisseur(trait([], { pinceau: 'stylo', taille: 10 }))).toBe(5);
    expect(epaisseur(trait([], { pinceau: 'marqueur', taille: 10 }))).toBeCloseTo(22);
  });

  it('un tampon se calcule à partir de la taille réglée', () => {
    expect(tailleTampon(8)).toBe(24);
  });
});

describe('Dessin : zoom', () => {
  it('garde le point sous le centre du zoom à la même place à l’écran', () => {
    const ancre = { x: 100, y: 100 };
    const vue = zoomer(VUE_INITIALE, 2, ancre, ancre, 640, 400);
    expect(vue.echelle).toBe(2);
    expect(versEcran(vue, versMonde(VUE_INITIALE, ancre))).toEqual(ancre);
  });

  it('un geste à deux doigts fait suivre le point du dessin au milieu des doigts', () => {
    const depart = { x: 320, y: 200 };
    const arrivee = { x: 340, y: 210 };
    const vue = zoomer(VUE_INITIALE, 2, depart, arrivee, 640, 400);
    expect(versEcran(vue, versMonde(VUE_INITIALE, depart))).toEqual(arrivee);
  });

  it('l’échelle reste entre 1 et 5', () => {
    expect(clamperEchelle(0.2)).toBe(1);
    expect(clamperEchelle(9)).toBe(5);
    expect(zoomer(VUE_INITIALE, 10, { x: 0, y: 0 }, { x: 0, y: 0 }, 640, 400).echelle).toBe(5);
  });

  it('on ne peut pas faire glisser le bord du dessin au milieu de la zone', () => {
    const decale = contraindre({ echelle: 2, decalage: { x: 50, y: -2000 } }, 640, 400);
    expect(decale.decalage).toEqual({ x: 0, y: -400 });
  });

  it('à l’échelle 1, le dessin est toujours cadré à l’origine', () => {
    expect(contraindre({ echelle: 1, decalage: { x: -30, y: 25 } }, 640, 400).decalage).toEqual({ x: 0, y: 0 });
  });
});
