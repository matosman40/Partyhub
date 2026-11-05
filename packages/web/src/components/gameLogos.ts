import { hashText } from '@partyhub/shared';

/**
 * Identité visuelle des jeux : titre, couleurs de la scène et marque graphique propre à chaque jeu.
 * Les jeux intégrés ont une spécification dessinée à la main ; les autres (paquets, cartes, plateau,
 * solo) reçoivent une identité stable, dérivée de leur identifiant.
 */

/** Motif graphique posé autour du titre. */
export type LogoMark =
  | 'bubble'
  | 'fuse'
  | 'lens'
  | 'moon'
  | 'arrows'
  | 'crown'
  | 'skyline'
  | 'deck'
  | 'bolt'
  | 'star'
  | 'duo'
  | 'frame'
  | 'runner';

export interface LogoSpec {
  /** Une ou deux lignes ; la seconde est plus petite. */
  lines: [string] | [string, string];
  /** Couleur du titre. */
  fill: string;
  /** Liseré et formes de la marque. */
  edge: string;
  /** Contour du titre. */
  ink: string;
  /** Deux tons sombres du fond de scène. */
  sky: [string, string];
  mark: LogoMark;
  /** Inclinaison du titre, en degrés. */
  tilt: number;
}

export const GAME_LOGOS: Record<string, LogoSpec> = {
  'quiz-party': {
    lines: ['Quiz', 'Party'],
    fill: '#FFD23F',
    edge: '#FF4F8B',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'bubble',
    tilt: -4,
  },
  'phrases-trous': {
    lines: ['Phrases', 'à trous'],
    fill: '#ECEAE3',
    edge: '#3247E0',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'frame',
    tilt: -3,
  },
  'bombes-party': {
    lines: ['Bombes', 'party'],
    fill: '#FF4F8B',
    edge: '#FFD23F',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'fuse',
    tilt: -2,
  },
  'gags-en-rafale': {
    lines: ['Gags', 'en rafale'],
    fill: '#FFD23F',
    edge: '#3247E0',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'star',
    tilt: -4,
  },
  'essai-appareils': {
    lines: ['Essai', 'Appareils'],
    fill: '#ECEAE3',
    edge: '#FF4F8B',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'lens',
    tilt: 3,
  },
  'micro-defis': {
    lines: ['Micro', 'Défis'],
    fill: '#FF4F8B',
    edge: '#3247E0',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'bolt',
    tilt: -3,
  },
  'photo-mystere': {
    lines: ['Photo', 'mystère'],
    fill: '#FFD23F',
    edge: '#FF4F8B',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'lens',
    tilt: 2,
  },
  sauteurs: {
    lines: ['Course des', 'sauteurs'],
    fill: '#FFD23F',
    edge: '#ECEAE3',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'runner',
    tilt: -2,
  },
  funambule: {
    lines: ['Funambule'],
    fill: '#ECEAE3',
    edge: '#FFD23F',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'arrows',
    tilt: -2,
  },
  'aventure-ia': {
    lines: ['Aventure', 'IA'],
    fill: '#FFD23F',
    edge: '#ECEAE3',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'star',
    tilt: -1,
  },
  imposteur: {
    lines: ['L’Imposteur'],
    fill: '#FF4F8B',
    edge: '#ECEAE3',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'lens',
    tilt: 0,
  },
  'loups-village': {
    lines: ['Les Loups', 'du village'],
    fill: '#ECEAE3',
    edge: '#3247E0',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'moon',
    tilt: -3,
  },
  'plus-ou-moins': {
    lines: ['Plus', 'ou moins'],
    fill: '#FFD23F',
    edge: '#FF4F8B',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'arrows',
    tilt: -2,
  },
  boum: {
    lines: ['BOUM !'],
    fill: '#FF4F8B',
    edge: '#FFD23F',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'star',
    tilt: -4,
  },
  banquise: {
    lines: ['Banquise'],
    fill: '#ECEAE3',
    edge: '#FF4F8B',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'frame',
    tilt: -2,
  },
  'plutot-qui': {
    lines: ['Plutôt', 'qui ?'],
    fill: '#FF4F8B',
    edge: '#FFD23F',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'duo',
    tilt: 2,
  },
  president: {
    lines: ['Président'],
    fill: '#FFD23F',
    edge: '#ECEAE3',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'crown',
    tilt: -1,
  },
  promoteur: {
    lines: ['Le', 'Promoteur'],
    fill: '#ECEAE3',
    edge: '#3247E0',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'skyline',
    tilt: -2,
  },
  'rami-51': {
    lines: ['Rami', '51'],
    fill: '#FFD23F',
    edge: '#3247E0',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'deck',
    tilt: -3,
  },
  reflexe: {
    lines: ['Réflexe'],
    fill: '#FF4F8B',
    edge: '#ECEAE3',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'bolt',
    tilt: -8,
  },
  tarot: {
    lines: ['Tarot'],
    fill: '#ECEAE3',
    edge: '#FFD23F',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'star',
    tilt: 0,
  },
  'poker-texas': {
    lines: ['Poker', 'Texas'],
    fill: '#FF4F8B',
    edge: '#3247E0',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'deck',
    tilt: -4,
  },
  association: {
    lines: ['Association', 'express'],
    fill: '#FFD23F',
    edge: '#FF4F8B',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'duo',
    tilt: -2,
  },
  'cartes-couleurs': {
    lines: ['Couleurs', '& chiffres'],
    fill: '#ECEAE3',
    edge: '#FF4F8B',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'deck',
    tilt: -2,
  },
  'cartes-coco': {
    lines: ['Blanc-manger', 'coco'],
    fill: '#FFD23F',
    edge: '#ECEAE3',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'moon',
    tilt: -3,
  },
  sudoku: {
    lines: ['Sudoku'],
    fill: '#ECEAE3',
    edge: '#FFD23F',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'frame',
    tilt: -2,
  },
  solitaire: {
    lines: ['Solitaire'],
    fill: '#FF4F8B',
    edge: '#FFD23F',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'deck',
    tilt: -2,
  },
  taquin: {
    lines: ['Taquin'],
    fill: '#FFD23F',
    edge: '#ECEAE3',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'arrows',
    tilt: -3,
  },
  'mots-croises': {
    lines: ['Mots', 'croisés'],
    fill: '#FF4F8B',
    edge: '#3247E0',
    ink: '#1B1A4B',
    sky: ['#14122E', '#1B1A4B'],
    mark: 'frame',
    tilt: -3,
  },
  'imite-moi': {
    lines: ['Imite-moi !'],
    fill: '#FF4F8B',
    edge: '#ECEAE3',
    ink: '#14122E',
    sky: ['#1B1A4B', '#14122E'],
    mark: 'star',
    tilt: -4,
  },
};

/** Identité de repli : déterministe, à partir de l’identifiant et du nom du jeu. */
export function fallbackLogo(id: string, name: string): LogoSpec {
  const h = hashText(id);
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lines: LogoSpec['lines'] = words.length <= 1 ? [words[0] ?? id] : [words[0] ?? '', words.slice(1).join(' ')];
  const marks: LogoMark[] = ['frame', 'star', 'duo', 'bubble', 'lens'];
  const fills = ['#FFD23F', '#FF4F8B', '#ECEAE3'] as const;
  const edges = ['#FF4F8B', '#3247E0', '#FFD23F', '#ECEAE3'] as const;
  const fill = fills[h % fills.length] ?? fills[0];
  const availableEdges = edges.filter((color) => color !== fill);
  const edge = availableEdges[(h >>> 5) % availableEdges.length] ?? '#3247E0';
  const sky: LogoSpec['sky'] = h & 1 ? ['#1B1A4B', '#14122E'] : ['#14122E', '#1B1A4B'];
  return {
    lines,
    fill,
    edge,
    ink: h & 2 ? '#1B1A4B' : '#14122E',
    sky,
    mark: marks[(h >>> 9) % marks.length] ?? 'frame',
    tilt: ((h >>> 12) % 7) - 3,
  };
}

/** Identité d’un jeu : la sienne si elle est dessinée, sinon celle de repli. */
export function logoFor(id: string, name: string): LogoSpec {
  const spec = GAME_LOGOS[id];
  return spec ?? fallbackLogo(id, name);
}
