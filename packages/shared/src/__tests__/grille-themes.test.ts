import { describe, expect, it } from 'vitest';
import {
  THEMES_PLATEAU,
  THEME_IDS,
  THEME_PAR_DEFAUT,
  estThemeId,
  themeDePlateau,
  themeIdSchema,
  type ThemePlateau,
} from '../grille-themes.js';
import {
  CASE_PLATEFORME,
  GRILLE_HAUTEUR,
  GRILLE_LARGEUR,
  contourDeLaForme,
  creerDecor,
  creerGrille,
  formeContient,
  rayonOrganique,
} from '../grille.js';
import { createRoomSchema } from '../schemas.js';

const L = GRILLE_LARGEUR;
const H = GRILLE_HAUTEUR;
const HEX = /^#[0-9a-f]{6}$/i;

function couleursDe(t: ThemePlateau): Array<[string, string]> {
  return [
    ['fond', t.fond],
    ['ciel', t.ciel],
    ['sol', t.sol],
    ['eau', t.eau],
    ['lumiere.couleurSoleil', t.lumiere.couleurSoleil],
    ['dalles[0]', t.dalles[0]],
    ['dalles[1]', t.dalles[1]],
    ['mur.couleur', t.mur.couleur],
    ['mur.joint', t.mur.joint],
    ['caisse.couleur', t.caisse.couleur],
    ['caisse.trait', t.caisse.trait],
    ['boite', t.boite],
    ['ballon', t.ballon],
  ];
}

describe('catalogue des thèmes', () => {
  it('les clés de THEMES_PLATEAU sont exactement THEME_IDS, et chaque id est sa clé', () => {
    expect(Object.keys(THEMES_PLATEAU).sort()).toEqual([...THEME_IDS].sort());
    for (const [cle, theme] of Object.entries(THEMES_PLATEAU)) expect(theme.id).toBe(cle);
  });

  it('le thème par défaut existe', () => {
    expect(THEME_IDS).toContain(THEME_PAR_DEFAUT);
  });

  it.each(THEME_IDS)('%s : couleurs en #rrggbb (le rendu en nuance exige ce format)', (id) => {
    for (const [nom, couleur] of couleursDe(THEMES_PLATEAU[id])) {
      expect(couleur, `${id}.${nom}`).toMatch(HEX);
    }
  });

  it.each(THEME_IDS)('%s : densité de caisses dans [0, 1], lumières positives', (id) => {
    const t = THEMES_PLATEAU[id];
    expect(t.densiteCaisses).toBeGreaterThanOrEqual(0);
    expect(t.densiteCaisses).toBeLessThanOrEqual(1);
    expect(t.lumiere.ambiante).toBeGreaterThan(0);
    expect(t.lumiere.soleil).toBeGreaterThan(0);
    expect(t.nom.length).toBeGreaterThan(0);
    expect(t.description.length).toBeGreaterThan(0);
  });
});

describe('identifiants de thème', () => {
  it('themeIdSchema accepte les thèmes connus et refuse « volcan »', () => {
    for (const id of THEME_IDS) expect(themeIdSchema.safeParse(id).success).toBe(true);
    expect(themeIdSchema.safeParse('volcan').success).toBe(false);
    expect(themeIdSchema.safeParse('constructor').success).toBe(false);
  });

  it('estThemeId ne reconnaît que les clés propres', () => {
    expect(estThemeId('arene')).toBe(true);
    expect(estThemeId('volcan')).toBe(false);
    expect(estThemeId('constructor')).toBe(false);
    expect(estThemeId('__proto__')).toBe(false);
    expect(estThemeId('toString')).toBe(false);
  });

  it('themeDePlateau retombe sur le thème par défaut pour tout identifiant inconnu', () => {
    const defaut = THEMES_PLATEAU[THEME_PAR_DEFAUT];
    for (const id of ['constructor', '__proto__', 'hasOwnProperty', 'volcan', '', null, undefined]) {
      expect(themeDePlateau(id), String(id)).toBe(defaut);
    }
    expect(themeDePlateau('arene')).toBe(THEMES_PLATEAU.arene);
  });

  it('createRoomSchema accepte un thème connu ou aucun, et refuse le reste', () => {
    expect(createRoomSchema.safeParse({ gameId: 'plateau-test', theme: 'arene' }).success).toBe(true);
    expect(createRoomSchema.safeParse({ gameId: 'plateau-test' }).success).toBe(true);
    expect(createRoomSchema.safeParse({ gameId: 'plateau-test', theme: 'volcan' }).success).toBe(false);
    expect(createRoomSchema.safeParse({ gameId: 'plateau-test', theme: 'constructor' }).success).toBe(false);
    expect(createRoomSchema.safeParse({ gameId: 'plateau-test', theme: 3 }).success).toBe(false);
  });
});

describe('formes courbes', () => {
  it('formeContient : le carré garde tout, le disque coupe les coins et garde le centre', () => {
    expect(formeContient('carree', L, H, 0, 0)).toBe(true);
    expect(formeContient('ronde', L, H, 1, 1)).toBe(false);
    expect(formeContient('ronde', L, H, L - 2, H - 2)).toBe(false);
    expect(formeContient('ronde', L, H, Math.floor(L / 2), Math.floor(H / 2))).toBe(true);
  });

  it('formeContient (ronde) est symétrique autour du centre', () => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < L; x++) {
        const v = formeContient('ronde', L, H, x, y);
        expect(formeContient('ronde', L, H, L - 1 - x, y)).toBe(v);
        expect(formeContient('ronde', L, H, x, H - 1 - y)).toBe(v);
      }
    }
  });

  it('formeContient (organique) garde le centre et coupe les coins', () => {
    expect(formeContient('organique', L, H, Math.floor(L / 2), Math.floor(H / 2))).toBe(true);
    expect(formeContient('organique', L, H, 0, 0)).toBe(false);
    expect(formeContient('organique', L, H, L - 1, H - 1)).toBe(false);
  });

  it.each(['ronde', 'organique'] as const)(
    'creerDecor (%s) : bordure et cases hors forme en mur, le reste en sol',
    (forme) => {
      const decor = creerDecor(L, H, { forme, decor: 'bord' });
      expect(decor).toHaveLength(H);
      for (let y = 0; y < H; y++) {
        expect(decor[y]).toHaveLength(L);
        for (let x = 0; x < L; x++) {
          const bord = x === 0 || y === 0 || x === L - 1 || y === H - 1;
          const attendu = bord || !formeContient(forme, L, H, x, y) ? '#' : '.';
          expect(decor[y]![x], `(${x},${y})`).toBe(attendu);
        }
      }
      // Au moins une case libre et un coin plein : la forme n'est ni vide ni un rectangle.
      expect(decor.join('')).toContain('.');
      expect(decor[1]![1]).toBe('#');
    },
  );

  it('creerDecor (carré) : piliers un sur deux, ou épars un sur seize, bordure pleine', () => {
    const piliers = creerDecor(L, H, { forme: 'carree', decor: 'piliers' });
    expect(piliers[2]![2]).toBe('#');
    expect(piliers[1]![1]).toBe('.');
    const epars = creerDecor(L, H, { forme: 'carree', decor: 'epars' });
    expect(epars[2]![2]).toBe('#');
    expect(epars[2]![4]).toBe('.');
    expect(epars[0]).toBe('#'.repeat(L));
  });

  it('rayonOrganique est fini, périodique et reste dans [0,96 ; 1,25]', () => {
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * Math.PI * 2;
      const r = rayonOrganique(t);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0.96);
      expect(r).toBeLessThanOrEqual(1.25);
      expect(rayonOrganique(t + Math.PI * 2)).toBeCloseTo(r, 9);
    }
  });

  it('contourDeLaForme : n points, ronde sur l’ellipse, organique à la distance du rayon organique', () => {
    const n = 64;
    const marge = 0.5;
    const rx = L / 2 - 1 + marge;
    const ry = H / 2 - 1 + marge;
    const ronde = contourDeLaForme('ronde', L, H, n, marge);
    expect(ronde).toHaveLength(n);
    for (const [x, z] of ronde) expect((x / rx) ** 2 + (z / ry) ** 2).toBeCloseTo(1, 9);
    expect(ronde[0]![0]).toBeCloseTo(rx, 9);
    expect(ronde[0]![1]).toBeCloseTo(0, 9);

    const orga = contourDeLaForme('organique', L, H, n, marge);
    expect(orga).toHaveLength(n);
    orga.forEach(([x, z], i) => {
      const r = Math.hypot(x / rx, z / ry);
      expect(r).toBeCloseTo(rayonOrganique((i / n) * Math.PI * 2), 9);
    });
    expect(contourDeLaForme('carree', L, H, 0)).toEqual([]);
  });

  it('chaque case libre d’un thème courbe est à l’intérieur du contour (polygone)', () => {
    for (const id of THEME_IDS) {
      const t = THEMES_PLATEAU[id];
      if (t.forme === 'carree') continue;
      const contour = contourDeLaForme(t.forme, L, H, 256, 0.5);
      const g = creerGrille({ theme: id });
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < L; x++) {
          if (g.decor[y]![x] === '#') continue;
          expect(pointDansPolygone(x - (L - 1) / 2, y - (H - 1) / 2, contour), `${id} (${x},${y})`).toBe(true);
        }
      }
    }
  });
});

/** Lancer de rayon : vrai si (px, pz) est dans le polygone. */
function pointDansPolygone(px: number, pz: number, poly: Array<[number, number]>): boolean {
  let dedans = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) dedans = !dedans;
  }
  return dedans;
}

describe('connexité du sol', () => {
  it.each(THEME_IDS)(
    '%s : toutes les cases de sol et de plateforme se rejoignent (hors caisses et obstacles mobiles)',
    (id) => {
      const g = creerGrille({ theme: id });
      const ouverte = (x: number, y: number) => {
        const c = g.decor[y]?.[x];
        return c === '.' || c === CASE_PLATEFORME;
      };
      let depart: [number, number] | null = null;
      let total = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < L; x++) {
          if (!ouverte(x, y)) continue;
          total++;
          depart ??= [x, y];
        }
      }
      expect(depart).not.toBeNull();
      const vus = new Set<string>([`${depart![0]},${depart![1]}`]);
      const pile = [depart!];
      while (pile.length > 0) {
        const [x, y] = pile.pop()!;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!ouverte(nx, ny) || vus.has(`${nx},${ny}`)) continue;
          vus.add(`${nx},${ny}`);
          pile.push([nx, ny]);
        }
      }
      expect(vus.size).toBe(total);
    },
  );
});
