/**
 * Thèmes du plateau en grille : même règle, autre décor. Chaque jeu choisit le sien (une fête foraine
 * façon Mario Party, une arène de combat, une banquise…). Le navigateur les applique sur la TV en 3D et
 * sur le téléphone en 2D : les couleurs viennent d’ici, à un seul endroit.
 */

import { z } from 'zod';

export const THEME_IDS = ['fete', 'arene', 'banquise'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const themeIdSchema = z.enum(THEME_IDS);

export type MotifSol = 'damier' | 'dalles' | 'glace';
export type MotifMur = 'briques' | 'pierre';

export interface ThemePlateau {
  id: ThemeId;
  nom: string;
  description: string;
  /** Couleur du fond autour du plateau. */
  fond: string;
  /** Couleur du ciel et de la lumière douce qui vient d’en bas (herbe, pierre…). */
  ciel: string;
  sol: string;
  lumiere: { ambiante: number; soleil: number; couleurSoleil: string };
  /** Les deux couleurs du sol, en damier ou en dalles. */
  dalles: [string, string];
  motifSol: MotifSol;
  mur: { couleur: string; joint: string; motif: MotifMur };
  caisse: { couleur: string; trait: string };
  boite: string;
  ballon: string;
}

export const THEMES_PLATEAU: Record<ThemeId, ThemePlateau> = {
  fete: {
    id: 'fete',
    nom: 'Fête foraine',
    description: 'Un plateau de fête, vif et joyeux, pour les jeux de déplacement.',
    fond: '#1b1233',
    ciel: '#e6f7ff',
    sol: '#3c6b2c',
    lumiere: { ambiante: 0.75, soleil: 1.15, couleurSoleil: '#ffffff' },
    dalles: ['#6cc063', '#62b45a'],
    motifSol: 'damier',
    mur: { couleur: '#8a5a3b', joint: '#5b3a24', motif: 'briques' },
    caisse: { couleur: '#b9783f', trait: '#6b4220' },
    boite: '#e0b57a',
    ballon: '#ef4444',
  },
  arene: {
    id: 'arene',
    nom: 'Arène de combat',
    description: 'Une arène de pierre, sombre, éclairée en chaud, pour les jeux de combat.',
    fond: '#0c0e16',
    ciel: '#9fb4d6',
    sol: '#2a2f3a',
    lumiere: { ambiante: 0.5, soleil: 1.4, couleurSoleil: '#ffc38a' },
    dalles: ['#5b5f6a', '#50545e'],
    motifSol: 'dalles',
    mur: { couleur: '#3c4150', joint: '#23262f', motif: 'pierre' },
    caisse: { couleur: '#c0592b', trait: '#5a2412' },
    boite: '#8a8f9c',
    ballon: '#f5c542',
  },
  banquise: {
    id: 'banquise',
    nom: 'Banquise',
    description: 'Une banquise claire, glissante, pour les jeux de course et de glisse.',
    fond: '#0b2a3f',
    ciel: '#dff4ff',
    sol: '#bfe3f2',
    lumiere: { ambiante: 0.9, soleil: 1.0, couleurSoleil: '#ffffff' },
    dalles: ['#d7f0fb', '#c4e6f5'],
    motifSol: 'glace',
    mur: { couleur: '#7fc4e6', joint: '#3f86b0', motif: 'pierre' },
    caisse: { couleur: '#c58b52', trait: '#6b4220' },
    boite: '#f0f8ff',
    ballon: '#ff7a59',
  },
};

export const THEME_PAR_DEFAUT: ThemeId = 'fete';

/** Le thème demandé, ou le thème par défaut si l’identifiant est inconnu ou absent. */
export function themeDePlateau(id: string | null | undefined): ThemePlateau {
  if (id && Object.prototype.hasOwnProperty.call(THEMES_PLATEAU, id)) return THEMES_PLATEAU[id as ThemeId];
  return THEMES_PLATEAU[THEME_PAR_DEFAUT];
}
