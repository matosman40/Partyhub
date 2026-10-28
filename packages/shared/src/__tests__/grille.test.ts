import { describe, expect, it } from 'vitest';
import {
  ajouterPersonnage,
  appliquerAction,
  creerGrille,
  creerDecor,
  GRILLE_HAUTEUR,
  GRILLE_LARGEUR,
  retirerPersonnage,
  actionGrilleSchema,
  type EtatGrille,
  type ObjetGrille,
} from '../grille.js';

/** Plateau vide entouré de murs, avec des personnages et des objets placés à la main. */
function plateau(objets: ObjetGrille[] = [], personnages: Record<string, [number, number]> = {}): EtatGrille {
  const base: EtatGrille = {
    largeur: GRILLE_LARGEUR,
    hauteur: GRILLE_HAUTEUR,
    decor: creerDecor(GRILLE_LARGEUR, GRILLE_HAUTEUR).map((ligne, y) =>
      ligne
        .split('')
        .map((c, x) =>
          c === '#' && !(x === 0 || y === 0 || x === GRILLE_LARGEUR - 1 || y === GRILLE_HAUTEUR - 1) ? '.' : c,
        )
        .join(''),
    ),
    objets,
    personnages: {},
    dernier: null,
    seq: 0,
  };
  let e = base;
  for (const [id, [x, y]] of Object.entries(personnages)) {
    e = { ...e, personnages: { ...e.personnages, [id]: { id, x, y, dir: 'down', attitude: 'repos' } } };
  }
  return e;
}

function caisse(id: string, x: number, y: number): ObjetGrille {
  return { id, nature: 'caisse', x, y, porte: null };
}
function boite(id: string, x: number, y: number): ObjetGrille {
  return { id, nature: 'boite', x, y, porte: null };
}

function ok(r: ReturnType<typeof appliquerAction>): EtatGrille {
  if (!r.ok) throw new Error(r.erreur);
  return r.etat;
}

describe('décor du plateau', () => {
  it('a des murs sur tout le pourtour et des piliers fixes, comme Bomberman', () => {
    const d = creerDecor(GRILLE_LARGEUR, GRILLE_HAUTEUR);
    expect(d[0]).toBe('#'.repeat(GRILLE_LARGEUR));
    expect(d[GRILLE_HAUTEUR - 1]).toBe('#'.repeat(GRILLE_LARGEUR));
    expect(d[2]?.[2]).toBe('#');
    expect(d[2]?.[3]).toBe('.');
  });

  it('une même graine donne toujours le même plateau, avec des caisses, des boîtes et des ballons', () => {
    const a = creerGrille({ graine: 7 });
    const b = creerGrille({ graine: 7 });
    expect(a).toEqual(b);
    expect(a.objets.some((o) => o.nature === 'caisse')).toBe(true);
    expect(a.objets.some((o) => o.nature === 'boite')).toBe(true);
    expect(a.objets.some((o) => o.nature === 'ballon')).toBe(true);
  });

  it('les coins de départ restent libres : aucun objet à deux cases d’un coin', () => {
    const e = creerGrille({ graine: 3 });
    for (const [x, y] of [
      [1, 1],
      [GRILLE_LARGEUR - 2, GRILLE_HAUTEUR - 2],
    ]) {
      expect(e.objets.some((o) => Math.abs(o.x - x!) + Math.abs(o.y - y!) <= 2)).toBe(false);
    }
  });
});

describe('marcher', () => {
  it('avance d’une case dans la direction demandée, et tourne vers elle', () => {
    const e = ok(appliquerAction(plateau([], { a: [1, 1] }), 'a', { type: 'marcher', dir: 'right' }));
    expect(e.personnages.a).toMatchObject({ x: 2, y: 1, dir: 'right', attitude: 'repos' });
  });

  it('un mur ou une caisse bloque le pas : le personnage tourne, sans bouger', () => {
    const e = ok(appliquerAction(plateau([caisse('c', 2, 1)], { a: [1, 1] }), 'a', { type: 'marcher', dir: 'right' }));
    expect(e.personnages.a).toMatchObject({ x: 1, y: 1, dir: 'right' });
    const mur = ok(appliquerAction(plateau([], { a: [1, 1] }), 'a', { type: 'marcher', dir: 'up' }));
    expect(mur.personnages.a).toMatchObject({ x: 1, y: 1, dir: 'up' });
  });

  it('on ne marche pas sur un autre personnage', () => {
    const e = ok(appliquerAction(plateau([], { a: [1, 1], b: [2, 1] }), 'a', { type: 'marcher', dir: 'right' }));
    expect(e.personnages.a).toMatchObject({ x: 1, y: 1 });
  });

  it('une boîte portée suit son porteur', () => {
    const e0 = plateau([boite('b', 2, 1)], { a: [1, 1] });
    const e1 = ok(appliquerAction(e0, 'a', { type: 'porter', dir: 'right' }));
    const e2 = ok(appliquerAction(e1, 'a', { type: 'marcher', dir: 'down' }));
    expect(e2.personnages.a).toMatchObject({ x: 1, y: 2, attitude: 'porte' });
    expect(e2.objets[0]).toMatchObject({ x: 1, y: 2, porte: 'a' });
  });
});

describe('pousser', () => {
  it('pousse une caisse d’une case, et le personnage prend sa place', () => {
    const e = ok(appliquerAction(plateau([caisse('c', 2, 1)], { a: [1, 1] }), 'a', { type: 'pousser', dir: 'right' }));
    expect(e.objets[0]).toMatchObject({ x: 3, y: 1 });
    expect(e.personnages.a).toMatchObject({ x: 2, y: 1, attitude: 'pousse' });
  });

  it('refuse s’il y a un obstacle derrière la caisse, ou rien à pousser', () => {
    const bloque = appliquerAction(plateau([caisse('c', 2, 1), caisse('d', 3, 1)], { a: [1, 1] }), 'a', {
      type: 'pousser',
      dir: 'right',
    });
    expect(bloque.ok).toBe(false);
    const rien = appliquerAction(plateau([], { a: [1, 1] }), 'a', { type: 'pousser', dir: 'right' });
    expect(rien.ok).toBe(false);
  });

  it('une boîte ne se pousse pas : on la porte', () => {
    const r = appliquerAction(plateau([boite('b', 2, 1)], { a: [1, 1] }), 'a', { type: 'pousser', dir: 'right' });
    expect(r.ok).toBe(false);
  });

  it('refuse de pousser en portant une boîte', () => {
    const e = ok(
      appliquerAction(plateau([boite('b', 2, 1), caisse('c', 1, 2)], { a: [1, 1] }), 'a', {
        type: 'porter',
        dir: 'right',
      }),
    );
    expect(appliquerAction(e, 'a', { type: 'pousser', dir: 'down' }).ok).toBe(false);
  });
});

describe('sauter', () => {
  it('saute par-dessus la case devant, et atterrit deux cases plus loin', () => {
    const e = ok(appliquerAction(plateau([caisse('c', 2, 1)], { a: [1, 1] }), 'a', { type: 'sauter', dir: 'right' }));
    expect(e.personnages.a).toMatchObject({ x: 3, y: 1, attitude: 'saut' });
    expect(e.objets[0]).toMatchObject({ x: 2, y: 1 });
  });

  it('refuse si la case d’atterrissage est bloquée ou hors du plateau', () => {
    const bloque = appliquerAction(plateau([caisse('c', 3, 1)], { a: [1, 1] }), 'a', { type: 'sauter', dir: 'right' });
    expect(bloque.ok).toBe(false);
  });

  it('emmène la boîte portée avec soi', () => {
    const e0 = plateau([boite('b', 2, 1)], { a: [1, 1] });
    const e1 = ok(appliquerAction(e0, 'a', { type: 'porter', dir: 'right' }));
    expect(appliquerAction(e1, 'a', { type: 'sauter', dir: 'right' }).ok).toBe(false);
  });
});

describe('porter', () => {
  it('prend une boîte devant soi, puis la pose devant soi, sur une case libre', () => {
    const e1 = ok(appliquerAction(plateau([boite('b', 2, 1)], { a: [1, 1] }), 'a', { type: 'porter', dir: 'right' }));
    expect(e1.objets[0]).toMatchObject({ porte: 'a', x: 1, y: 1 });
    expect(e1.personnages.a?.attitude).toBe('porte');
    const e2 = ok(appliquerAction(e1, 'a', { type: 'porter', dir: 'right' }));
    expect(e2.objets[0]).toMatchObject({ porte: null, x: 2, y: 1 });
    expect(e2.personnages.a?.attitude).toBe('repos');
  });

  it('ne porte pas une caisse, et refuse s’il n’y a rien devant', () => {
    expect(appliquerAction(plateau([caisse('c', 2, 1)], { a: [1, 1] }), 'a', { type: 'porter', dir: 'right' }).ok).toBe(
      false,
    );
    expect(appliquerAction(plateau([], { a: [1, 1] }), 'a', { type: 'porter', dir: 'right' }).ok).toBe(false);
  });

  it('ne pose pas sur une case occupée', () => {
    const e1 = ok(
      appliquerAction(plateau([boite('b', 2, 1), caisse('c', 2, 1)].slice(0, 1), { a: [1, 1] }), 'a', {
        type: 'porter',
        dir: 'right',
      }),
    );
    const occupee = plateau([caisse('c', 2, 1)], { a: [1, 1] });
    const avec = { ...occupee, objets: [...occupee.objets, { ...e1.objets[0]!, porte: 'a' }] };
    expect(appliquerAction(avec, 'a', { type: 'porter', dir: 'right' }).ok).toBe(false);
  });
});

describe('saluer et gestes partagés', () => {
  it('saluer ne bouge pas le personnage et prend l’attitude de salut', () => {
    const e = ok(appliquerAction(plateau([], { a: [4, 3] }), 'a', { type: 'saluer' }));
    expect(e.personnages.a).toMatchObject({ x: 4, y: 3, attitude: 'salut' });
    expect(e.dernier).toEqual({ joueur: 'a', geste: 'salut' });
  });

  it('chaque geste accepté avance le compteur, même s’il répète le précédent', () => {
    const e1 = ok(appliquerAction(plateau([], { a: [4, 3] }), 'a', { type: 'saluer' }));
    const e2 = ok(appliquerAction(e1, 'a', { type: 'saluer' }));
    expect(e2.seq).toBe(e1.seq + 1);
  });

  it('un personnage inconnu est refusé', () => {
    expect(appliquerAction(plateau(), 'x', { type: 'saluer' }).ok).toBe(false);
  });
});

describe('arrivée et départ des personnages', () => {
  it('place chaque nouveau personnage sur une case de départ libre', () => {
    let e = creerGrille({ graine: 7 });
    e = ajouterPersonnage(e, 'a');
    e = ajouterPersonnage(e, 'b');
    expect(e.personnages.a).toMatchObject({ x: 1, y: 1 });
    expect(e.personnages.b).toMatchObject({ x: GRILLE_LARGEUR - 2, y: GRILLE_HAUTEUR - 2 });
    expect(ajouterPersonnage(e, 'a')).toBe(e);
  });

  it('quand un personnage part, la boîte qu’il portait reste posée sur place', () => {
    const e0 = plateau([boite('b', 2, 1)], { a: [1, 1] });
    const e1 = ok(appliquerAction(e0, 'a', { type: 'porter', dir: 'right' }));
    const e2 = retirerPersonnage(e1, 'a');
    expect(e2.personnages.a).toBeUndefined();
    expect(e2.objets[0]).toMatchObject({ porte: null, x: 1, y: 1 });
  });
});

describe('format des actions reçues', () => {
  it('accepte les cinq gestes et refuse une direction ou un geste inconnu', () => {
    expect(actionGrilleSchema.safeParse({ type: 'saluer' }).success).toBe(true);
    expect(actionGrilleSchema.safeParse({ type: 'pousser', dir: 'left' }).success).toBe(true);
    expect(actionGrilleSchema.safeParse({ type: 'pousser', dir: 'diagonale' }).success).toBe(false);
    expect(actionGrilleSchema.safeParse({ type: 'danser' }).success).toBe(false);
  });
});
