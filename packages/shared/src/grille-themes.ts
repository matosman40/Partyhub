/**
 * Thèmes du plateau en grille : même règle, autre lieu. Chaque jeu choisit le sien. Le thème dit où se
 * passe la partie : une pelouse de fête, une mer avec une banquise, une plateforme de pierre au-dessus
 * du vide. Il règle le sol, ce qui entoure le plateau, la forme des murs et le nombre de caisses. Le
 * navigateur l’applique sur la TV en 3D et sur le téléphone en 2D : les couleurs viennent d’ici, à un seul
 * endroit.
 */

import { z } from 'zod';

export const THEME_IDS = ['fete', 'arene', 'banquise'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const themeIdSchema = z.enum(THEME_IDS);

/** Le lieu : ce qui entoure le plateau, et la forme de ses bords et de ses murs. */
export type Ambiance = 'pelouse' | 'mer' | 'plateforme';

export type MotifSol = 'herbe' | 'dalles' | 'glace';
export type MotifMur = 'feuillage' | 'pierre' | 'glace';

export interface ThemePlateau {
  id: ThemeId;
  nom: string;
  description: string;
  ambiance: Ambiance;
  /** Couleur du fond de la page autour de la scène. */
  fond: string;
  /** Couleur du ciel et de la lumière douce qui vient d’en bas (herbe, pierre…). */
  ciel: string;
  /** Couleur du terrain qui entoure le plateau (ambiance pelouse). */
  sol: string;
  /** Couleur de l’eau qui entoure le plateau (ambiance mer). */
  eau: string;
  lumiere: { ambiante: number; soleil: number; couleurSoleil: string };
  /** Les deux couleurs du sol, en damier ou en dalles. */
  dalles: [string, string];
  motifSol: MotifSol;
  mur: { couleur: string; joint: string; motif: MotifMur };
  caisse: { couleur: string; trait: string };
  boite: string;
  ballon: string;
  /** Part des cases libres qui reçoivent une caisse (entre 0 et 1). Plus bas : plateau plus dégagé. */
  densiteCaisses: number;
}

export const THEMES_PLATEAU: Record<ThemeId, ThemePlateau> = {
  fete: {
    id: 'fete',
    nom: 'Pelouse de fête',
    description: 'Une pelouse ensoleillée, avec des buissons et des arbres, pour les jeux de déplacement.',
    ambiance: 'pelouse',
    fond: '#1c2f3d',
    ciel: '#e6f7ff',
    sol: '#3f7a33',
    eau: '#2b7bb0',
    lumiere: { ambiante: 0.8, soleil: 1.2, couleurSoleil: '#fff6df' },
    dalles: ['#6cc063', '#62b45a'],
    motifSol: 'herbe',
    mur: { couleur: '#2f7d3a', joint: '#1d4f24', motif: 'feuillage' },
    caisse: { couleur: '#b9783f', trait: '#6b4220' },
    boite: '#e0b57a',
    ballon: '#ef4444',
    densiteCaisses: 0.18,
  },
  arene: {
    id: 'arene',
    nom: 'Plateforme de combat',
    description: 'Une plateforme de pierre au-dessus du vide, éclairée en chaud, pour les jeux de combat.',
    ambiance: 'plateforme',
    fond: '#07080d',
    ciel: '#9fb4d6',
    sol: '#2a2f3a',
    eau: '#1a1f2a',
    lumiere: { ambiante: 0.5, soleil: 1.4, couleurSoleil: '#ffc38a' },
    dalles: ['#5b5f6a', '#50545e'],
    motifSol: 'dalles',
    mur: { couleur: '#3c4150', joint: '#23262f', motif: 'pierre' },
    caisse: { couleur: '#c0592b', trait: '#5a2412' },
    boite: '#8a8f9c',
    ballon: '#f5c542',
    densiteCaisses: 0.12,
  },
  banquise: {
    id: 'banquise',
    nom: 'Banquise en mer',
    description: 'Une banquise claire au milieu de la mer, pour les jeux de glisse et de course.',
    ambiance: 'mer',
    fond: '#0b2a3f',
    ciel: '#dff4ff',
    sol: '#bfe3f2',
    eau: '#1d5f8c',
    lumiere: { ambiante: 0.9, soleil: 1.0, couleurSoleil: '#ffffff' },
    dalles: ['#d7f0fb', '#c4e6f5'],
    motifSol: 'glace',
    mur: { couleur: '#dff6ff', joint: '#7fc4e6', motif: 'glace' },
    caisse: { couleur: '#c58b52', trait: '#6b4220' },
    boite: '#f0f8ff',
    ballon: '#ff7a59',
    densiteCaisses: 0.2,
  },
};

export const THEME_PAR_DEFAUT: ThemeId = 'fete';

/** Le thème demandé, ou le thème par défaut si l’identifiant est inconnu ou absent. */
export function themeDePlateau(id: string | null | undefined): ThemePlateau {
  if (id && Object.prototype.hasOwnProperty.call(THEMES_PLATEAU, id)) return THEMES_PLATEAU[id as ThemeId];
  return THEMES_PLATEAU[THEME_PAR_DEFAUT];
}
