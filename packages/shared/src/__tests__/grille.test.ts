import { describe, expect, it } from 'vitest';
import { THEMES_PLATEAU, THEME_IDS, THEME_PAR_DEFAUT, themeDePlateau, type ThemeId } from '../grille-themes.js';
import {
  actionContextuelle,
  avance,
  ajouterPersonnage,
  appliquerAction,
  devantLePersonnage,
  creerGrille,
  creerDecor,
  GRILLE_HAUTEUR,
  GRILLE_LARGEUR,
  retirerPersonnage,
  actionGrilleSchema,
  type EtatGrille,
  type ObjetGrille,
  formeContient,
  CASE_PLATEFORME,
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
    theme: THEME_PAR_DEFAUT,
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
    const e = creerGrille({ graine: 3, theme: 'arene' });
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
    const dehors = appliquerAction(plateau([], { a: [GRILLE_LARGEUR - 2, 1] }), 'a', { type: 'sauter', dir: 'right' });
    expect(dehors.ok).toBe(false);
  });

  it('franchit un pilier (règle documentée : seule la case d’atterrissage compte)', () => {
    const e = plateau([], { a: [1, 1] });
    const decor = e.decor.map((l, y) => (y === 1 ? l.slice(0, 2) + '#' + l.slice(3) : l));
    const r = ok(appliquerAction({ ...e, decor }, 'a', { type: 'sauter', dir: 'right' }));
    expect(r.personnages.a).toMatchObject({ x: 3, y: 1, attitude: 'saut' });
  });

  it('franchit un autre joueur sans le déplacer', () => {
    const r = ok(appliquerAction(plateau([], { a: [1, 1], b: [2, 1] }), 'a', { type: 'sauter', dir: 'right' }));
    expect(r.personnages.a).toMatchObject({ x: 3, y: 1 });
    expect(r.personnages.b).toMatchObject({ x: 2, y: 1 });
  });

  it('refuse de sauter en portant une boîte', () => {
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

  it('une marche refusée sans changer de direction rend le même état, sans toucher au compteur', () => {
    const e = ok(appliquerAction(plateau([], { a: [1, 1] }), 'a', { type: 'marcher', dir: 'up' }));
    const encore = appliquerAction(e, 'a', { type: 'marcher', dir: 'up' });
    expect(encore.ok).toBe(true);
    if (encore.ok) expect(encore.etat).toBe(e);
    const tourne = ok(appliquerAction(e, 'a', { type: 'marcher', dir: 'left' }));
    expect(tourne.seq).toBe(e.seq + 1);
  });

  it('un personnage inconnu est refusé', () => {
    expect(appliquerAction(plateau(), 'x', { type: 'saluer' }).ok).toBe(false);
  });
});

describe('arrivée et départ des personnages', () => {
  it('place chaque nouveau personnage sur une case de départ libre', () => {
    // Le plateau carré a ses départs dans les coins.
    let e = creerGrille({ graine: 7, theme: 'arene' });
    e = ajouterPersonnage(e, 'a');
    e = ajouterPersonnage(e, 'b');
    expect(e.personnages.a).toMatchObject({ x: 1, y: 1 });
    expect(e.personnages.b).toMatchObject({ x: GRILLE_LARGEUR - 2, y: GRILLE_HAUTEUR - 2 });
    expect(ajouterPersonnage(e, 'a')).toBe(e);
  });

  it('dans une forme organique, les personnages partent à l’intérieur du contour', () => {
    const e = creerGrille({ graine: 7, theme: 'fete' });
    let f = ajouterPersonnage(e, 'a');
    f = ajouterPersonnage(f, 'b');
    for (const p of Object.values(f.personnages)) {
      expect(formeContient(themeDePlateau('fete').forme, e.largeur, e.hauteur, p.x, p.y)).toBe(true);
      expect(e.decor[p.y]?.[p.x]).toBe('.');
    }
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

describe('bouton d’action', () => {
  it('dit ce qui est devant le personnage, dans la direction où il regarde', () => {
    // Dans le coin (1, 1) : le mur est à gauche et au-dessus, la caisse à droite, le sol en bas.
    const e = plateau([{ id: 'c', nature: 'caisse', x: 2, y: 1, porte: null }], { a: [1, 1] });
    const regarde = (dir: 'up' | 'down' | 'left' | 'right') => ({
      ...e,
      personnages: { a: { ...e.personnages.a!, dir } },
    });
    expect(devantLePersonnage(regarde('right'), 'a')).toBe('caisse');
    expect(devantLePersonnage(regarde('left'), 'a')).toBe('mur');
    expect(devantLePersonnage(regarde('up'), 'a')).toBe('mur');
    expect(devantLePersonnage(regarde('down'), 'a')).toBe('rien');
    expect(devantLePersonnage(e, 'inconnu')).toBeNull();
  });

  it('reconnaît une plateforme devant soi : pas d’action, et la marche refusée garde sa référence', () => {
    const base = plateau([], { a: [2, 1] });
    const decor = base.decor.map((l, y) => (y === 1 ? l.slice(0, 3) + CASE_PLATEFORME + l.slice(4) : l));
    const e = { ...base, decor, personnages: { a: { ...base.personnages.a!, dir: 'right' as const } } };
    expect(devantLePersonnage(e, 'a')).toBe('plateforme');
    expect(actionContextuelle(e, 'a')).toBeNull();
    const r = appliquerAction(e, 'a', { type: 'marcher', dir: 'right' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.etat).toBe(e);
  });

  it('pousse une caisse devant soi, et porte une boîte devant soi', () => {
    const avecCaisse = plateau([{ id: 'c', nature: 'caisse', x: 3, y: 2, porte: null }], { a: [2, 2] });
    const caisse = { ...avecCaisse, personnages: { a: { ...avecCaisse.personnages.a!, dir: 'right' as const } } };
    expect(actionContextuelle(caisse, 'a')).toEqual({ type: 'pousser', dir: 'right' });

    const avecBoite = plateau([{ id: 'b', nature: 'boite', x: 3, y: 2, porte: null }], { a: [2, 2] });
    const boite = { ...avecBoite, personnages: { a: { ...avecBoite.personnages.a!, dir: 'right' as const } } };
    expect(actionContextuelle(boite, 'a')).toEqual({ type: 'porter', dir: 'right' });
  });

  it('pose la boîte portée, et ne fait rien s’il n’y a rien devant', () => {
    const portee = plateau([{ id: 'b', nature: 'boite', x: 2, y: 2, porte: 'a' }], { a: [2, 2] });
    expect(actionContextuelle(portee, 'a')).toEqual({ type: 'porter', dir: 'down' });
    const vide = plateau([], { a: [2, 2] });
    expect(actionContextuelle(vide, 'a')).toBeNull();
  });

  it('ne propose rien face à un mur, ni quand le geste serait refusé', () => {
    const e = plateau([], { a: [1, 1] });
    const mur = { ...e, personnages: { a: { ...e.personnages.a!, dir: 'up' as const } } };
    expect(actionContextuelle(mur, 'a')).toBeNull();
    const coince = plateau([caisse('c', 2, 1), caisse('d', 3, 1)], { a: [1, 1] });
    const vers = { ...coince, personnages: { a: { ...coince.personnages.a!, dir: 'right' as const } } };
    expect(actionContextuelle(vers, 'a')).toBeNull();
  });
});

describe('thèmes du plateau', () => {
  it('propose des thèmes distincts, et retombe sur le thème par défaut si l’identifiant est inconnu', () => {
    const ids = Object.keys(THEMES_PLATEAU);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ids.map((id) => THEMES_PLATEAU[id as ThemeId].sol)).size).toBe(ids.length);
    expect(themeDePlateau('arene').id).toBe('arene');
    expect(themeDePlateau('inconnu').id).toBe(THEME_PAR_DEFAUT);
    expect(themeDePlateau(null).id).toBe(THEME_PAR_DEFAUT);
  });
});

/** Pose une plateforme de 2 × 2 cases, à partir de (x, y). */
function avecPlateforme(e: EtatGrille, x: number, y: number): EtatGrille {
  const decor = e.decor.map((ligne, cy) =>
    ligne
      .split('')
      .map((c, cx) => (cx >= x && cx <= x + 1 && cy >= y && cy <= y + 1 ? CASE_PLATEFORME : c))
      .join(''),
  );
  return { ...e, decor };
}

describe('plateformes', () => {
  /** Plateau avec une plateforme 2 × 2 sur les cases (4..5, 2..3). */
  const pf = (objets: ObjetGrille[], persos: Record<string, [number, number]>) =>
    avecPlateforme(plateau(objets, persos), 4, 2);

  it('pousser ne fait jamais monter : ni le pousseur, ni l’objet poussé', () => {
    const refus = { ok: false, erreur: 'Pour monter, sautez.' };
    // Pousseur au sol, caisse sur la plateforme : le pousseur monterait.
    const a = appliquerAction(pf([caisse('c', 4, 2)], { a: [3, 2] }), 'a', { type: 'pousser', dir: 'right' });
    expect(a).toEqual(refus);
    // Caisse au sol poussée sur la plateforme.
    const b = appliquerAction(pf([caisse('c', 3, 2)], { a: [2, 2] }), 'a', { type: 'pousser', dir: 'right' });
    expect(b).toEqual(refus);
    const balle: ObjetGrille = { id: 'b', nature: 'ballon', x: 3, y: 3, porte: null };
    const c = appliquerAction(pf([balle], { a: [2, 3] }), 'a', { type: 'pousser', dir: 'right' });
    expect(c).toEqual(refus);
  });

  it('sur la plateforme, on pousse vers le sol (descente permise) et d’une plateforme à l’autre', () => {
    const r = ok(appliquerAction(pf([caisse('c', 3, 2)], { a: [4, 2] }), 'a', { type: 'pousser', dir: 'left' }));
    expect(r.objets[0]).toMatchObject({ x: 2, y: 2 });
    expect(r.personnages.a).toMatchObject({ x: 3, y: 2 });
    const deux = avecPlateforme(pf([caisse('c', 4, 3)], { a: [4, 2] }), 4, 4);
    const pp = ok(appliquerAction(deux, 'a', { type: 'pousser', dir: 'down' }));
    expect(pp.objets[0]).toMatchObject({ x: 4, y: 4 });
    expect(pp.personnages.a).toMatchObject({ x: 4, y: 3 });
  });

  it('on saute de plateforme à plateforme et au sol ; sol vers plateforme occupée est refusé', () => {
    const sol = ok(appliquerAction(pf([], { a: [4, 2] }), 'a', { type: 'sauter', dir: 'right' }));
    expect(sol.personnages.a).toMatchObject({ x: 6, y: 2 }); // P -> sol
    const deux = avecPlateforme(pf([], { a: [4, 2] }), 6, 2);
    const pp = ok(appliquerAction(deux, 'a', { type: 'sauter', dir: 'right' }));
    expect(pp.personnages.a).toMatchObject({ x: 6, y: 2 }); // P -> P
    const bloque = appliquerAction(pf([caisse('c', 4, 2)], { a: [2, 2] }), 'a', { type: 'sauter', dir: 'right' });
    expect(bloque.ok).toBe(false);
  });

  it('on ne monte pas sur une plateforme en marchant depuis le sol', () => {
    const e = avecPlateforme(plateau([], { a: [2, 2] }), 3, 2);
    const r = appliquerAction(e, 'a', { type: 'marcher', dir: 'right' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.etat.personnages.a).toMatchObject({ x: 2, y: 2, dir: 'right' });
  });

  it('on monte sur une plateforme en sautant, et on en redescend en marchant', () => {
    const e = avecPlateforme(plateau([], { a: [2, 2] }), 3, 2);
    const saut = appliquerAction(e, 'a', { type: 'sauter', dir: 'right' });
    expect(saut.ok).toBe(true);
    if (!saut.ok) return;
    expect(saut.etat.personnages.a).toMatchObject({ x: 4, y: 2 });

    const descente = appliquerAction(saut.etat, 'a', { type: 'marcher', dir: 'left' });
    expect(descente.ok).toBe(true);
    if (!descente.ok) return;
    expect(descente.etat.personnages.a).toMatchObject({ x: 3, y: 2 });
    const aLaPorte = appliquerAction(descente.etat, 'a', { type: 'marcher', dir: 'left' });
    expect(aLaPorte.ok).toBe(true);
    if (!aLaPorte.ok) return;
    expect(aLaPorte.etat.personnages.a).toMatchObject({ x: 2, y: 2 });
  });

  it('cumule 6 puis 12 joueurs sur chaque thème et 50 graines : jamais sur une plateforme, toujours une sortie', () => {
    for (const id of THEME_IDS) {
      const forme = themeDePlateau(id).forme;
      for (let graine = 1; graine <= 50; graine++) {
        let e = creerGrille({ theme: id, graine });
        for (let i = 0; i < 12; i++) {
          const avant = e;
          e = ajouterPersonnage(e, `j${i}`);
          const p = e.personnages[`j${i}`];
          if (!p) throw new Error(`${id}/${graine} : joueur ${i} non placé`);
          expect(e.decor[p.y]?.[p.x], `${id}/${graine}/${i} sur du sol`).toBe('.');
          expect(formeContient(forme, e.largeur, e.hauteur, p.x, p.y)).toBe(true);
          expect(
            avant.objets.some((o) => o.porte === null && o.x === p.x && o.y === p.y),
            `${id}/${graine}/${i} pas sur un objet`,
          ).toBe(false);
          const voisinLibre = (['up', 'down', 'left', 'right'] as const).some((d) => {
            const v = avance(p.x, p.y, d);
            const c = e.decor[v.y]?.[v.x];
            return (
              (c === '.' || c === CASE_PLATEFORME) &&
              !Object.values(avant.personnages).some((q) => q.x === v.x && q.y === v.y) &&
              !e.objets.some((o) => o.porte === null && o.x === v.x && o.y === v.y)
            );
          });
          expect(voisinLibre, `${id}/${graine}/${i} a un voisin libre`).toBe(true);
        }
        expect(Object.keys(e.personnages)).toHaveLength(12);
      }
    }
  });

  it('les plateformes ne touchent pas les six départs ; le tennis n’en a pas', () => {
    for (const id of ['fete', 'arene', 'banquise', 'arene-ronde', 'escalade', 'ile'] as const) {
      const e = creerGrille({ theme: id, graine: 3 });
      expect(e.decor.join('')).toContain(CASE_PLATEFORME);
      let f = e;
      for (let i = 0; i < 6; i++) f = ajouterPersonnage(f, `j${i}`);
      for (const p of Object.values(f.personnages)) expect(e.decor[p.y]?.[p.x]).toBe('.');
    }
    expect(creerGrille({ theme: 'tennis' }).decor.join('')).not.toContain(CASE_PLATEFORME);
  });
});
