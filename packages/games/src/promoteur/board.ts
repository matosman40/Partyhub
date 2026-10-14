/**
 * Plateau du Promoteur : définitions pures (sans serveur), partagées avec l'affichage.
 * Le plateau est un anneau de 24 cases. Les couleurs de rues donnent droit aux maisons.
 */

export type Group = 'brun' | 'ciel' | 'violet' | 'orange' | 'vert';

export type SquareKind =
  | 'start'
  | 'street'
  | 'station'
  | 'utility'
  | 'tax'
  | 'chance'
  | 'chest'
  | 'free'
  | 'jail'
  | 'goToJail';

export interface Square {
  index: number;
  kind: SquareKind;
  name: string;
  group?: Group;
  /** Prix d'achat. */
  price?: number;
  /** Loyer de base d'une rue (sans maison). */
  rent?: number;
  /** Coût d'une maison. */
  house?: number;
  /** Montant de l'impôt. */
  tax?: number;
}

export const BOARD_SIZE = 24;
export const SALARY = 200;
export const START_CASH = 1500;
export const JAIL_INDEX = 10;
export const BAIL = 50;
export const JAIL_TRIES = 3;
export const MAX_HOUSES = 4;
export const STATION_RENT = 25;
export const UTILITY_FACTOR = 4;

export const GROUP_LABEL: Record<Group, string> = {
  brun: 'Brun',
  ciel: 'Ciel',
  violet: 'Violet',
  orange: 'Orange',
  vert: 'Vert',
};

export const GROUP_COLOR: Record<Group, string> = {
  brun: '#9a6b3f',
  ciel: '#7dd3fc',
  violet: '#c084fc',
  orange: '#fb923c',
  vert: '#4ade80',
};

export const BOARD: Square[] = [
  { index: 0, kind: 'start', name: 'Départ' },
  { index: 1, kind: 'street', name: 'Rue des Lilas', group: 'brun', price: 60, rent: 2, house: 50 },
  { index: 2, kind: 'chest', name: 'Caisse commune' },
  { index: 3, kind: 'street', name: 'Allée des Pins', group: 'brun', price: 60, rent: 4, house: 50 },
  { index: 4, kind: 'tax', name: 'Impôts', tax: 150 },
  { index: 5, kind: 'station', name: 'Gare Nord', price: 200 },
  { index: 6, kind: 'street', name: 'Quai Ocre', group: 'ciel', price: 100, rent: 6, house: 50 },
  { index: 7, kind: 'chance', name: 'Chance' },
  { index: 8, kind: 'street', name: 'Rue Ocre', group: 'ciel', price: 100, rent: 6, house: 50 },
  { index: 9, kind: 'street', name: 'Place Ocre', group: 'ciel', price: 120, rent: 8, house: 50 },
  { index: 10, kind: 'jail', name: 'Visite · Prison' },
  { index: 11, kind: 'street', name: 'Avenue Violette', group: 'violet', price: 140, rent: 10, house: 100 },
  { index: 12, kind: 'utility', name: 'Compagnie électrique', price: 150 },
  { index: 13, kind: 'street', name: 'Boulevard Violet', group: 'violet', price: 140, rent: 10, house: 100 },
  { index: 14, kind: 'street', name: 'Place Violette', group: 'violet', price: 160, rent: 12, house: 100 },
  { index: 15, kind: 'station', name: 'Gare Est', price: 200 },
  { index: 16, kind: 'street', name: 'Rue Orange', group: 'orange', price: 180, rent: 14, house: 100 },
  { index: 17, kind: 'chest', name: 'Caisse commune' },
  { index: 18, kind: 'street', name: 'Avenue Orange', group: 'orange', price: 180, rent: 14, house: 100 },
  { index: 19, kind: 'street', name: 'Place Orange', group: 'orange', price: 200, rent: 16, house: 100 },
  { index: 20, kind: 'free', name: 'Parking' },
  { index: 21, kind: 'street', name: 'Rue Verte', group: 'vert', price: 220, rent: 18, house: 200 },
  { index: 22, kind: 'goToJail', name: 'Allez en prison' },
  { index: 23, kind: 'street', name: 'Boulevard Vert', group: 'vert', price: 240, rent: 20, house: 200 },
];

export type CardEffect = { kind: 'money'; amount: number } | { kind: 'move'; to: number } | { kind: 'jail' };

export interface Card {
  text: string;
  effect: CardEffect;
}

export const CHANCE: Card[] = [
  { text: 'Votre placement rapporte 150 €', effect: { kind: 'money', amount: 150 } },
  { text: 'Contravention pour excès de vitesse : 75 €', effect: { kind: 'money', amount: -75 } },
  { text: 'Retour au Départ, touchez le salaire', effect: { kind: 'move', to: 0 } },
  { text: 'Contrôle sans titre de transport : en visite', effect: { kind: 'jail' } },
  { text: 'Le fisc vous rembourse 100 €', effect: { kind: 'money', amount: 100 } },
  { text: 'Réparations de toiture : 100 €', effect: { kind: 'money', amount: -100 } },
  { text: 'Direction la Gare Est', effect: { kind: 'move', to: 15 } },
  { text: 'Vous gagnez un concours : 50 €', effect: { kind: 'money', amount: 50 } },
];

export const CHEST: Card[] = [
  { text: 'Erreur de la banque en votre faveur : 200 €', effect: { kind: 'money', amount: 200 } },
  { text: 'Frais médicaux : 100 €', effect: { kind: 'money', amount: -100 } },
  { text: 'Vente de gâteaux au voisinage : 50 €', effect: { kind: 'money', amount: 50 } },
  { text: 'Direction le Parking', effect: { kind: 'move', to: 20 } },
  { text: 'Amende pour stationnement : 60 €', effect: { kind: 'money', amount: -60 } },
  { text: 'Remboursement d’assurance : 80 €', effect: { kind: 'money', amount: 80 } },
];

/** Indices des cases d'une couleur donnée. */
export function groupSquares(group: Group): number[] {
  return BOARD.filter((sq) => sq.group === group).map((sq) => sq.index);
}

/** Position d'une case sur la grille 7 × 7 qui forme l'anneau du plateau (0 = coin bas-droit). */
export function cellOf(i: number): { col: number; row: number } {
  if (i <= 6) return { col: 6 - i, row: 6 };
  if (i <= 12) return { col: 0, row: 12 - i };
  if (i <= 18) return { col: i - 12, row: 0 };
  return { col: 6, row: i - 18 };
}

/** Case suivante sur l'anneau, dans le sens du jeu. */
export function nextSquare(i: number): number {
  return (i + 1) % BOARD_SIZE;
}

/** Nombre de cases à parcourir, dans le sens du jeu, pour aller de `from` à `to`. */
export function stepsBetween(from: number, to: number): number {
  return (((to - from) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
}

/** Décalage des pions posés sur la même case (en fractions de case). */
export const STACK_OFFSETS: [number, number][] = [
  [0, 0],
  [-0.24, -0.16],
  [0.24, 0.16],
  [-0.24, 0.16],
  [0.24, -0.16],
  [0, 0.3],
];
