/**
 * Thèmes du plateau en grille : même règle, autre lieu. Chaque jeu choisit le sien. Le thème dit où se
 * passe la partie : une pelouse de fête, une mer avec une banquise, une plateforme de pierre au-dessus
 * du vide. Il règle le sol, ce qui entoure le plateau, la forme des murs et le nombre de caisses. Le
 * navigateur l’applique sur la TV en 3D et sur le téléphone en 2D : les couleurs viennent d’ici, à un seul
 * endroit.
 */

import { z } from 'zod';

export const THEME_IDS = ['fete', 'arene', 'banquise', 'arene-ronde', 'tennis', 'escalade'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const themeIdSchema = z.enum(THEME_IDS);

/** Le lieu : ce qui entoure le plateau, et la forme de ses bords et de ses murs. */
export type Ambiance = 'pelouse' | 'mer' | 'plateforme' | 'gymnase';

/** La forme du plateau : un rectangle, ou un disque (les cases hors du disque sont des murs). */
export type Forme = 'carree' | 'ronde';
/** Le décor intérieur : des piliers façon Bomberman, ou seulement le bord. */
export type Decor = 'piliers' | 'bord';

export type MotifSol = 'herbe' | 'dalles' | 'glace' | 'court' | 'mousse';
export type MotifMur = 'feuillage' | 'pierre' | 'glace' | 'prise';

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
  forme: Forme;
  decor: Decor;
  /** Un filet au milieu du plateau (décor seulement, il ne bloque pas les personnages). */
  filet?: boolean;
  /** Le contour : des haies (par défaut) ou un grillage de court. */
  murs?: 'haie' | 'grillage';
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
    forme: 'carree',
    decor: 'piliers',
  },
  arene: {
    id: 'arene',
    nom: 'Plateforme de combat',
    description:
      'Une arène de pierre et de métal, avec un anneau orangé, au-dessus d’une mer de bulles, pour les jeux de combat.',
    ambiance: 'plateforme',
    fond: '#1d4f5a',
    ciel: '#c8f3f5',
    sol: '#2a2f3a',
    eau: '#1a1f2a',
    lumiere: { ambiante: 0.95, soleil: 1.5, couleurSoleil: '#ffd9a8' },
    dalles: ['#a9b4c6', '#98a4b8'],
    motifSol: 'dalles',
    mur: { couleur: '#c7ccd9', joint: '#5d6375', motif: 'pierre' },
    caisse: { couleur: '#e8733a', trait: '#7a2f14' },
    boite: '#d8dbe6',
    ballon: '#ffd23f',
    densiteCaisses: 0.12,
    forme: 'carree',
    decor: 'piliers',
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
    forme: 'carree',
    decor: 'piliers',
  },
  'arene-ronde': {
    id: 'arene-ronde',
    nom: 'Arène ronde',
    description:
      'Une arène ronde de métal et de pierre, avec un anneau orangé et des bulles autour, pour les combats d’élimination.',
    ambiance: 'plateforme',
    fond: '#1d4f5a',
    ciel: '#c8f3f5',
    sol: '#333a4a',
    eau: '#1a1f2a',
    lumiere: { ambiante: 0.95, soleil: 1.5, couleurSoleil: '#ffd9a8' },
    dalles: ['#b7c2d4', '#a2aec2'],
    motifSol: 'dalles',
    mur: { couleur: '#c7ccd9', joint: '#5d6375', motif: 'pierre' },
    caisse: { couleur: '#e8733a', trait: '#7a2f14' },
    boite: '#d8dbe6',
    ballon: '#ffd23f',
    densiteCaisses: 0.1,
    forme: 'ronde',
    decor: 'bord',
  },
  tennis: {
    id: 'tennis',
    nom: 'Court de tennis',
    description: 'Un court en dur bleu, avec ses lignes blanches et son filet, au milieu d’une pelouse de club.',
    ambiance: 'pelouse',
    fond: '#1d3d2a',
    ciel: '#e8f7ff',
    sol: '#2f7d4f',
    eau: '#2b7bb0',
    lumiere: { ambiante: 0.9, soleil: 1.3, couleurSoleil: '#fff6df' },
    dalles: ['#2f74b5', '#2a68a6'],
    motifSol: 'court',
    mur: { couleur: '#2f7d3a', joint: '#1d4f24', motif: 'feuillage' },
    caisse: { couleur: '#d9d2c3', trait: '#7a6f5c' },
    boite: '#ffffff',
    ballon: '#e6ff3b',
    densiteCaisses: 0.04,
    forme: 'carree',
    decor: 'bord',
    filet: true,
    murs: 'grillage',
  },
  escalade: {
    id: 'escalade',
    nom: 'Mur d’escalade',
    description: 'Un mur de prises colorées au-dessus d’un tapis bleu, pour les jeux d’adresse et de grimpe.',
    ambiance: 'gymnase',
    fond: '#141b2b',
    ciel: '#2a3550',
    sol: '#1e2a3d',
    eau: '#1e2a3d',
    lumiere: { ambiante: 0.85, soleil: 1.1, couleurSoleil: '#dfe8ff' },
    dalles: ['#2d6fd1', '#2660b8'],
    motifSol: 'mousse',
    mur: { couleur: '#8a8f9c', joint: '#4a4f5c', motif: 'prise' },
    caisse: { couleur: '#e8733a', trait: '#7a2f14' },
    boite: '#d8dbe6',
    ballon: '#ff4d6d',
    densiteCaisses: 0.14,
    forme: 'carree',
    decor: 'piliers',
  },
};

export const THEME_PAR_DEFAUT: ThemeId = 'fete';

/** Le thème demandé, ou le thème par défaut si l’identifiant est inconnu ou absent. */
export function themeDePlateau(id: string | null | undefined): ThemePlateau {
  if (id && Object.prototype.hasOwnProperty.call(THEMES_PLATEAU, id)) return THEMES_PLATEAU[id as ThemeId];
  return THEMES_PLATEAU[THEME_PAR_DEFAUT];
}
