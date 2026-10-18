import { hashText } from '@partyhub/shared';

/**
 * Identité visuelle des jeux : titre, couleurs de la scène et marque graphique propre à chaque jeu.
 * Les jeux intégrés ont une spécification dessinée à la main ; les autres (paquets, cartes, plateau,
 * solo) reçoivent une identité stable, dérivée de leur identifiant.
 */

/** Motif graphique posé autour du titre. */
export type LogoMark =
  'bubble' | 'fuse' | 'lens' | 'moon' | 'arrows' | 'crown' | 'skyline' | 'deck' | 'bolt' | 'star' | 'duo' | 'frame';

export interface LogoSpec {
  /** Une ou deux lignes ; la seconde est plus petite. */
  lines: [string] | [string, string];
  /** Couleur du titre. */
  fill: string;
  /** Liseré et formes de la marque. */
  edge: string;
  /** Contour et relief du titre. */
  ink: string;
  /** Couleurs du fond de scène (dégradé du haut vers le bas). */
  sky: [string, string];
  mark: LogoMark;
  /** Inclinaison du titre, en degrés. */
  tilt: number;
}

export const GAME_LOGOS: Record<string, LogoSpec> = {
  'quiz-party': {
    lines: ['Quiz', 'Party'],
    fill: '#ffd23f',
    edge: '#ff3d8b',
    ink: '#1a1030',
    sky: ['#3a1670', '#0b0630'],
    mark: 'bubble',
    tilt: -4,
  },
  'phrases-trous': {
    lines: ['Phrases', 'à trous'],
    fill: '#c3a6ff',
    edge: '#ff9ad5',
    ink: '#1a0f2e',
    sky: ['#0c3a4f', '#031019'],
    mark: 'frame',
    tilt: -3,
  },
  'bombes-party': {
    lines: ['Bombes', 'party'],
    fill: '#ff8a3d',
    edge: '#ffe27a',
    ink: '#140805',
    sky: ['#4a0f12', '#0c0303'],
    mark: 'fuse',
    tilt: -2,
  },
  'gags-en-rafale': {
    lines: ['Gags', 'en rafale'],
    fill: '#9dff4a',
    edge: '#ff3dcf',
    ink: '#0c0519',
    sky: ['#2d0b4a', '#080214'],
    mark: 'star',
    tilt: -4,
  },
  'micro-defis': {
    lines: ['Micro', 'Défis'],
    fill: '#ff5fd2',
    edge: '#7cf3ff',
    ink: '#1a0a2e',
    sky: ['#1b0f3d', '#070318'],
    mark: 'bolt',
    tilt: -3,
  },
  'plateau-fete': {
    lines: ['Plateau', 'fête'],
    fill: '#ffc83d',
    edge: '#ff4f9a',
    ink: '#2a0d3f',
    sky: ['#2a1450', '#0b0620'],
    mark: 'star',
    tilt: -4,
  },
  'tennis-party': {
    lines: ['Tennis', 'party'],
    fill: '#d8ff3a',
    edge: '#2f86e6',
    ink: '#0a1c33',
    sky: ['#1f5fb0', '#071a33'],
    mark: 'bolt',
    tilt: -2,
  },
  funambule: {
    lines: ['Funambule'],
    fill: '#ffd27a',
    edge: '#5ee7c4',
    ink: '#0a1c22',
    sky: ['#14404c', '#051218'],
    mark: 'arrows',
    tilt: -2,
  },
  'aventure-ia': {
    lines: ['Aventure', 'IA'],
    fill: '#b6ff5c',
    edge: '#ffc83d',
    ink: '#0d1404',
    sky: ['#1d3b2a', '#06120b'],
    mark: 'star',
    tilt: -1,
  },
  'loups-village': {
    lines: ['Les Loups', 'du village'],
    fill: '#f4d35e',
    edge: '#b9a6ff',
    ink: '#080a1c',
    sky: ['#1a2c63', '#050814'],
    mark: 'moon',
    tilt: -3,
  },
  'plus-ou-moins': {
    lines: ['Plus', 'ou moins'],
    fill: '#b8f56b',
    edge: '#ff9f43',
    ink: '#0d2412',
    sky: ['#14603f', '#041a12'],
    mark: 'arrows',
    tilt: -2,
  },
  boum: {
    lines: ['BOUM !'],
    fill: '#ffe14d',
    edge: '#ff3b1f',
    ink: '#2a0a05',
    sky: ['#ff7a1a', '#7a0c1e'],
    mark: 'star',
    tilt: -4,
  },
  banquise: {
    lines: ['Banquise'],
    fill: '#eaf8ff',
    edge: '#7fdcff',
    ink: '#082a44',
    sky: ['#1b4f7a', '#06192e'],
    mark: 'frame',
    tilt: -2,
  },
  'plutot-qui': {
    lines: ['Plutôt', 'qui ?'],
    fill: '#fff3b0',
    edge: '#ff6fa8',
    ink: '#3a1030',
    sky: ['#ffc2e2', '#b9a6ff'],
    mark: 'duo',
    tilt: 2,
  },
  president: {
    lines: ['Président'],
    fill: '#ffd166',
    edge: '#06d6a0',
    ink: '#03241a',
    sky: ['#0d6248', '#02150f'],
    mark: 'crown',
    tilt: -1,
  },
  promoteur: {
    lines: ['Le', 'Promoteur'],
    fill: '#7fdcff',
    edge: '#ff7a3d',
    ink: '#0a1a33',
    sky: ['#24457a', '#0a1430'],
    mark: 'skyline',
    tilt: -2,
  },
  'rami-51': {
    lines: ['Rami', '51'],
    fill: '#ffe066',
    edge: '#e63946',
    ink: '#0a2a18',
    sky: ['#1f7a4a', '#082a18'],
    mark: 'deck',
    tilt: -3,
  },
  reflexe: {
    lines: ['Réflexe'],
    fill: '#fff200',
    edge: '#ffffff',
    ink: '#000000',
    sky: ['#1a1a1a', '#000000'],
    mark: 'bolt',
    tilt: -8,
  },
  tarot: {
    lines: ['Tarot'],
    fill: '#f5d68a',
    edge: '#7c3aed',
    ink: '#1e1036',
    sky: ['#3b1d7a', '#120729'],
    mark: 'star',
    tilt: 0,
  },
  'poker-texas': {
    lines: ['Poker', 'Texas'],
    fill: '#fbf6ea',
    edge: '#d63a3a',
    ink: '#0c2418',
    sky: ['#1d6b43', '#0a2c1c'],
    mark: 'deck',
    tilt: -4,
  },
  association: {
    lines: ['Association', 'express'],
    fill: '#ff6f61',
    edge: '#fff4f0',
    ink: '#2a1b3d',
    sky: ['#17a39a', '#0b5f5a'],
    mark: 'duo',
    tilt: -2,
  },
  'cartes-couleurs': {
    lines: ['Couleurs', '& chiffres'],
    fill: '#ff9ecf',
    edge: '#42e0c2',
    ink: '#2a0a22',
    sky: ['#5b1f5e', '#1c0620'],
    mark: 'deck',
    tilt: -2,
  },
  'cartes-coco': {
    lines: ['Blanc-manger', 'coco'],
    fill: '#fff6e0',
    edge: '#8a5a2b',
    ink: '#2b1d10',
    sky: ['#0f6b5a', '#06261f'],
    mark: 'moon',
    tilt: -3,
  },
  sudoku: {
    lines: ['Sudoku'],
    fill: '#e0fbfc',
    edge: '#ee6c4d',
    ink: '#14213d',
    sky: ['#293241', '#0d1117'],
    mark: 'frame',
    tilt: -2,
  },
  solitaire: {
    lines: ['Solitaire'],
    fill: '#f6f7eb',
    edge: '#e63946',
    ink: '#0b2233',
    sky: ['#3d5a80', '#101e33'],
    mark: 'deck',
    tilt: -2,
  },
  taquin: {
    lines: ['Taquin'],
    fill: '#ffc6ff',
    edge: '#3a0ca3',
    ink: '#1b0836',
    sky: ['#4361ee', '#14206b'],
    mark: 'arrows',
    tilt: -3,
  },
  'mots-croises': {
    lines: ['Mots', 'croisés'],
    fill: '#f7e7c1',
    edge: '#2a9d8f',
    ink: '#1f1a10',
    sky: ['#5c4a2e', '#1d160a'],
    mark: 'frame',
    tilt: -3,
  },
  'imite-moi': {
    lines: ['Imite-moi !'],
    fill: '#c7f9cc',
    edge: '#ff5e5b',
    ink: '#2a1020',
    sky: ['#7a1f5c', '#2a0820'],
    mark: 'star',
    tilt: -4,
  },
  karaoke: {
    lines: ['Karaoké'],
    fill: '#5efce8',
    edge: '#ff2e63',
    ink: '#0b1d2a',
    sky: ['#0d3b4f', '#04121a'],
    mark: 'bubble',
    tilt: -3,
  },
  'tribunal-absurde': {
    lines: ['Tribunal', 'de l’absurde'],
    fill: '#e9d5a6',
    edge: '#ff4d6d',
    ink: '#1f0a12',
    sky: ['#4a1030', '#14040f'],
    mark: 'skyline',
    tilt: -3,
  },
  'imposteur-parmi-nous': {
    lines: ['L’imposteur', 'parmi nous'],
    fill: '#ff2e63',
    edge: '#ffd23f',
    ink: '#14061f',
    sky: ['#2d0f4a', '#0a0316'],
    mark: 'lens',
    tilt: -3,
  },
  'telephone-arabe': {
    lines: ['Téléphone arabe', 'illustré'],
    fill: '#6cc8ff',
    edge: '#ffd23f',
    ink: '#0d1b2a',
    sky: ['#0f4c75', '#06182a'],
    mark: 'duo',
    tilt: -3,
  },
};

/** Identité de repli : déterministe, à partir de l’identifiant et du nom du jeu. */
export function fallbackLogo(id: string, name: string): LogoSpec {
  const h = hashText(id);
  const hue = h % 360;
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lines: LogoSpec['lines'] = words.length <= 1 ? [words[0] ?? id] : [words[0] ?? '', words.slice(1).join(' ')];
  const marks: LogoMark[] = ['frame', 'star', 'duo', 'bubble', 'lens'];
  return {
    lines,
    fill: `hsl(${hue} 95% 68%)`,
    edge: `hsl(${(hue + 150) % 360} 90% 62%)`,
    ink: `hsl(${hue} 60% 8%)`,
    sky: [`hsl(${hue} 55% 24%)`, `hsl(${hue} 60% 9%)`],
    mark: marks[(h >>> 9) % marks.length] ?? 'frame',
    tilt: ((h >>> 12) % 7) - 3,
  };
}

/** Identité d’un jeu : la sienne si elle est dessinée, sinon celle de repli. */
export function logoFor(id: string, name: string): LogoSpec {
  const spec = GAME_LOGOS[id];
  return spec ?? fallbackLogo(id, name);
}
