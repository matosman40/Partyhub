import { WILD_FAMILY, type CardEntry, type CardGameDefinition, type GameNotice } from '@partyhub/shared';

/**
 * Règles pures du tarot à quatre : paquet de 78 cartes, valeur des cartes, cartes
 * jouables, gagnant d'un pli, validation de l'écart et marque d'une donne.
 * Le serveur et le téléphone utilisent les mêmes fonctions : une carte refusée sur
 * le téléphone l'est aussi sur le serveur, et inversement.
 *
 * Identifiants des cartes :
 * - couleurs : lettre de la couleur (« s » pique, « h » cœur, « d » carreau, « c » trèfle)
 *   puis le rang de 1 à 14 (11 valet, 12 cavalier, 13 dame, 14 roi) : « h14 » = roi de cœur ;
 * - atouts : « t1 » (le Petit) à « t21 » ;
 * - l'Excuse : « excuse ».
 *
 * Les points se comptent en demi-points entiers : un roi vaut 9, une petite carte 1,
 * le paquet entier 182 (soit 91 points). On évite ainsi les erreurs d'arrondi.
 */

export type SuitId = 's' | 'h' | 'd' | 'c';
/** Famille d'une carte : une couleur, les atouts (« t ») ou l'Excuse (« e »). */
export type FamilyId = SuitId | 't' | 'e';
export type Side = 'attack' | 'defence';

export const SUITS = [
  { id: 's', label: 'Pique', name: 'pique', glyph: '♠', color: '#16162e' },
  { id: 'h', label: 'Cœur', name: 'cœur', glyph: '♥', color: '#d6293a' },
  { id: 'd', label: 'Carreau', name: 'carreau', glyph: '♦', color: '#d6293a' },
  { id: 'c', label: 'Trèfle', name: 'trèfle', glyph: '♣', color: '#16162e' },
] as const;

const SUIT_NAME: Record<SuitId, string> = { s: 'pique', h: 'cœur', d: 'carreau', c: 'trèfle' };
const SUIT_GLYPH: Record<SuitId, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** Famille de rendu des atouts : un or foncé, lisible sur le papier des cartes. */
export const TRUMP_FAMILY = 't';
export const TRUMP_COLOR = '#9c6b00';

export const EXCUSE = 'excuse';
export const PETIT = 't1';
export const VINGT_ET_UN = 't21';
export const OUDLERS: readonly string[] = [PETIT, VINGT_ET_UN, EXCUSE];

export const PLAYERS = 4;
export const HAND_SIZE = 18;
export const CHIEN_SIZE = 6;
export const TRICKS_PER_DEAL = 18;
/** Total du paquet, en demi-points (91 points). */
export const TOTAL_HALF_POINTS = 182;

const FACE_SHORT: Record<number, string> = { 11: 'V', 12: 'C', 13: 'D', 14: 'R' };
const FACE_NAME: Record<number, string> = { 11: 'Valet', 12: 'Cavalier', 13: 'Dame', 14: 'Roi' };

// ---------------------------------------------------------------------------
// Paquet et lecture des cartes
// ---------------------------------------------------------------------------

/** Les 78 cartes : quatre couleurs de 14 cartes, 21 atouts et l'Excuse. */
export const TAROT_DECK: readonly string[] = [
  ...SUITS.flatMap((suit) => Array.from({ length: 14 }, (_, i) => `${suit.id}${i + 1}`)),
  ...Array.from({ length: 21 }, (_, i) => `t${i + 1}`),
  EXCUSE,
];

interface Parsed {
  family: FamilyId;
  rank: number;
}

const PARSED: Map<string, Parsed> = new Map(
  TAROT_DECK.map((id): [string, Parsed] => {
    if (id === EXCUSE) return [id, { family: 'e', rank: 0 }];
    return [id, { family: id[0] as FamilyId, rank: Number(id.slice(1)) }];
  }),
);

function parse(id: string): Parsed {
  return PARSED.get(id) ?? { family: 'e', rank: -1 };
}

/** Vrai si l'identifiant désigne une carte du paquet. */
export function isCard(id: string): boolean {
  return PARSED.has(id);
}

export function familyOf(id: string): FamilyId {
  return parse(id).family;
}

/** Rang : 1 à 14 dans une couleur, 1 à 21 pour un atout, 0 pour l'Excuse. */
export function rankOf(id: string): number {
  return parse(id).rank;
}

export function isTrump(id: string): boolean {
  return parse(id).family === 't';
}

export function isExcuse(id: string): boolean {
  return id === EXCUSE;
}

export function isOudler(id: string): boolean {
  return OUDLERS.includes(id);
}

export function isKing(id: string): boolean {
  const p = parse(id);
  return p.family !== 't' && p.family !== 'e' && p.rank === 14;
}

/** Carte de couleur qui n'est pas un roi : la seule qu'on écarte sans condition. */
function isPlainDiscard(id: string): boolean {
  const p = parse(id);
  return p.family !== 't' && p.family !== 'e' && p.rank < 14;
}

/** Valeur d'une carte en demi-points : roi 9, dame 7, cavalier 5, valet 3, oudler 9, autre 1. */
export function cardHalfPoints(id: string): number {
  if (isOudler(id)) return 9;
  const p = parse(id);
  if (p.family === 't') return 1;
  if (p.rank === 14) return 9;
  if (p.rank === 13) return 7;
  if (p.rank === 12) return 5;
  if (p.rank === 11) return 3;
  return 1;
}

export function countHalfPoints(cards: readonly string[]): number {
  return cards.reduce((sum, id) => sum + cardHalfPoints(id), 0);
}

/** Demi-points lisibles à la française : 91 donne « 45,5 », -7 donne « −3,5 ». */
export function formatHalf(half: number): string {
  const abs = Math.abs(half);
  return `${half < 0 ? '−' : ''}${Math.floor(abs / 2)}${abs % 2 === 1 ? ',5' : ''}`;
}

/** Force d'une carte pour les tris : l'Excuse, puis les couleurs par rang, puis les atouts. */
export function cardStrength(id: string): number {
  const p = parse(id);
  if (p.family === 'e') return 0;
  if (p.family === 't') return 100 + p.rank;
  return p.rank;
}

/** Symbole court, comme sur la carte : « 10♥ », « R♠ », « 21 », « ★ » pour l'Excuse. */
export function cardSymbol(id: string): string {
  const p = parse(id);
  if (p.family === 'e') return '★';
  if (p.family === 't') return String(p.rank);
  return `${FACE_SHORT[p.rank] ?? String(p.rank)}${SUIT_GLYPH[p.family]}`;
}

/** Nom complet (lecteurs d'écran, listes) : « Roi de cœur », « Atout 12 », « Le Petit », « Excuse ». */
export function cardName(id: string): string {
  const p = parse(id);
  if (p.family === 'e') return 'Excuse';
  if (p.family === 't') return p.rank === 1 ? 'Le Petit' : `Atout ${p.rank}`;
  return `${FACE_NAME[p.rank] ?? String(p.rank)} de ${SUIT_NAME[p.family]}`;
}

/** Nom avec article, pour les phrases du journal : « le roi de cœur », « l'atout 12 », « l'Excuse ». */
export function cardPhrase(id: string): string {
  const p = parse(id);
  if (p.family === 'e') return 'l’Excuse';
  if (p.family === 't') {
    if (p.rank === 1) return 'le Petit';
    if (p.rank === 21) return 'le 21 d’atout';
    return `l’atout ${p.rank}`;
  }
  const face = FACE_NAME[p.rank];
  if (!face) return `le ${p.rank} de ${SUIT_NAME[p.family]}`;
  return `${p.rank === 13 ? 'la' : 'le'} ${face.toLowerCase()} de ${SUIT_NAME[p.family]}`;
}

/** Nom d'une couleur en minuscules (« cœur »), pour les messages. */
export function suitName(suit: SuitId): string {
  return SUIT_NAME[suit];
}

// Couleurs alternées dans la main : noir, rouge, noir, rouge.
const SUIT_ORDER: Record<string, number> = { s: 0, h: 1, c: 2, d: 3 };

/** Main triée : les atouts du plus petit au plus grand, l'Excuse, puis pique, cœur, trèfle et carreau. */
export function sortHand(cards: readonly string[]): string[] {
  const key = (id: string): number => {
    const p = parse(id);
    if (p.family === 't') return p.rank;
    if (p.family === 'e') return 50;
    return 100 + (SUIT_ORDER[p.family] ?? 0) * 20 + p.rank;
  };
  return [...cards].sort((a, b) => key(a) - key(b));
}

/** Définition du paquet au format commun, utilisée seulement pour le rendu des cartes. */
export const TAROT_NOTICE: GameNotice = {
  goal: 'À quatre : un preneur joue seul contre les trois autres et doit réunir assez de points dans ses plis pour remplir son contrat. Le meilleur total après la dernière donne gagne.',
  steps: [
    'Chacun reçoit 18 cartes, 6 forment le chien. Le donneur change à chaque donne. Si votre seul atout est le Petit (Excuse ou non), c’est le Petit sec : la donne est annulée et refaite.',
    'Enchères en un seul tour, à partir du joueur après le donneur : passez ou annoncez plus haut que l’enchère précédente. Petite (×1), Garde (×2), Garde sans le chien (×4), Garde contre le chien (×6).',
    'Si tout le monde passe, les cartes sont redistribuées par le donneur suivant. Sinon, la plus haute enchère désigne le preneur ; les trois autres forment la défense.',
    'Petite ou Garde : le chien est montré à tous, le preneur le prend et écarte 6 cartes. Ni roi ni oudler à l’écart, des atouts seulement sans autre choix (ils sont montrés). L’écart compte pour le preneur.',
    'Garde sans le chien : personne ne le voit, il compte pour le preneur. Garde contre le chien : personne ne le voit, il compte pour la défense.',
    'Le joueur après le donneur entame. Fournissez la couleur demandée ; sinon coupez, en surcoupant si possible ; sans atout, jouez ce que vous voulez. Sur un atout, montez si vous le pouvez.',
    'L’Excuse se joue à tout moment et ne gagne jamais le pli : elle reste à son camp, qui cède un demi-point si l’autre camp gagne le pli. Jouée au dernier pli, elle va au camp qui le remporte.',
    'Points à faire selon les oudlers (le Petit, le 21, l’Excuse) gagnés par le preneur : 56 sans oudler, 51 avec un, 41 avec deux, 36 avec trois.',
    'Marque : 25 + l’écart avec les points à faire (arrondi au-dessus), fois le multiplicateur. Petit au bout (le Petit dans le dernier pli) : 10 fois le multiplicateur pour le camp qui remporte ce pli.',
    'Chelem non annoncé : 200 points pour le camp qui remporte les 18 plis.',
    'Le preneur marque trois fois ce résultat, chaque défenseur le perd une fois : le total des scores reste nul.',
  ],
  tips: [
    'Variantes retenues : enchères en un seul tour, Petit sec annulé même avec l’Excuse (le même donneur redistribue), écart et chien comptés comme indiqué ci-dessus.',
    'Non prévus : poignées, chelem annoncé et misère.',
    'Une donne annulée (Petit sec ou tout le monde passe) ne compte pas dans le nombre de donnes.',
    'Temps écoulé : on passe pendant les enchères, l’écart prend les cartes les plus faibles, et la plus petite carte permise est jouée. L’écart dispose d’un temps double.',
    'Les cartes jouables s’éclairent sur votre téléphone : touchez-en une pour la jouer.',
  ],
};

function toEntry(id: string): CardEntry {
  const p = parse(id);
  return {
    id,
    label: cardName(id),
    symbol: cardSymbol(id),
    family: p.family === 'e' ? WILD_FAMILY : p.family,
    effect: p.family === 'e' ? 'wild' : 'none',
    count: 1,
    // Valeur en demi-points (entiers).
    points: cardHalfPoints(id),
  };
}

export const TAROT_DEFINITION: CardGameDefinition = {
  name: 'Tarot',
  description: 'Le tarot à quatre : enchères, chien, écart et plis, un preneur contre trois défenseurs.',
  icon: '🎴',
  theme: 'classique',
  families: [
    ...SUITS.map((s) => ({ id: s.id, label: s.label, color: s.color })),
    { id: TRUMP_FAMILY, label: 'Atout', color: TRUMP_COLOR },
  ],
  cards: TAROT_DECK.map(toEntry),
  rules: { minPlayers: 4, maxPlayers: 4, handSize: HAND_SIZE, matchOn: 'family', targetScore: 0, turnSeconds: 30 },
  notice: TAROT_NOTICE,
};

const ENTRY_BY_ID: Map<string, CardEntry> = new Map(TAROT_DEFINITION.cards.map((c) => [c.id, c]));

/** Entrée de rendu d'une carte (pour CardFace). */
export function tarotEntry(id: string): CardEntry | undefined {
  return ENTRY_BY_ID.get(id);
}

/** Vrai si le seul atout de la main est le Petit (l'Excuse ne compte pas comme un atout ici). */
export function hasPetitSec(hand: readonly string[]): boolean {
  const trumps = hand.filter(isTrump);
  return trumps.length === 1 && trumps[0] === PETIT;
}

// ---------------------------------------------------------------------------
// Jeu de la carte
// ---------------------------------------------------------------------------

/** Couleur demandée : celle de la première carte qui n'est pas l'Excuse, ou null (pli vide ou Excuse seule). */
export function ledFamily(trick: readonly string[]): SuitId | 't' | null {
  for (const id of trick) {
    if (isExcuse(id)) continue;
    return familyOf(id) as SuitId | 't';
  }
  return null;
}

function highestTrump(trick: readonly string[]): number {
  return trick.filter(isTrump).reduce((max, id) => Math.max(max, rankOf(id)), 0);
}

/**
 * Cartes jouables, dans l'ordre de la main. Fournir la couleur demandée ; sinon couper
 * (en surcoupant si possible), sinon jouer n'importe quoi. Sur un atout, monter si possible.
 * L'Excuse est toujours jouable.
 */
export function legalCards(hand: readonly string[], trick: readonly string[]): string[] {
  const led = ledFamily(trick);
  if (led === null) return [...hand];
  const allowed = new Set<string>();
  if (led !== 't') {
    for (const id of hand) if (familyOf(id) === led) allowed.add(id);
  }
  if (allowed.size === 0) {
    const trumps = hand.filter(isTrump);
    if (trumps.length === 0) return [...hand];
    const top = highestTrump(trick);
    const over = trumps.filter((id) => rankOf(id) > top);
    for (const id of over.length > 0 ? over : trumps) allowed.add(id);
  }
  if (hand.includes(EXCUSE)) allowed.add(EXCUSE);
  return hand.filter((id) => allowed.has(id));
}

/** Pourquoi une carte ne peut pas être jouée maintenant, ou null si elle est permise. */
export function playError(hand: readonly string[], trick: readonly string[], cardId: string): string | null {
  if (!hand.includes(cardId)) return 'Cette carte n’est pas dans votre main.';
  if (legalCards(hand, trick).includes(cardId)) return null;
  const led = ledFamily(trick);
  if (led !== null && led !== 't' && hand.some((id) => familyOf(id) === led)) {
    return `Vous devez fournir à ${SUIT_NAME[led]}.`;
  }
  if (!isTrump(cardId)) {
    return led === 't'
      ? 'Vous devez jouer atout.'
      : `Vous n’avez pas de ${SUIT_NAME[led as SuitId]} : vous devez couper.`;
  }
  return 'Vous devez monter à l’atout.';
}

/**
 * Position (dans l'ordre de jeu) de la carte qui remporte le pli : le plus gros atout,
 * sinon la plus forte carte de la couleur demandée. L'Excuse ne gagne jamais.
 * Renvoie -1 si le pli ne contient que l'Excuse.
 */
export function trickWinner(trick: readonly string[]): number {
  const led = ledFamily(trick);
  let best = -1;
  for (let i = 0; i < trick.length; i++) {
    const id = trick[i]!;
    if (isExcuse(id)) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const current = trick[best]!;
    if (isTrump(id)) {
      if (!isTrump(current) || rankOf(id) > rankOf(current)) best = i;
    } else if (!isTrump(current) && familyOf(id) === led && rankOf(id) > rankOf(current)) {
      best = i;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Écart
// ---------------------------------------------------------------------------

/** Nombre de cartes de couleur qui ne sont pas des rois : on doit les écarter avant tout atout. */
export function plainDiscardCount(hand: readonly string[]): number {
  return hand.filter(isPlainDiscard).length;
}

/** Pourquoi cette carte ne peut pas aller à l'écart (main de 24 cartes), ou null si elle le peut. */
export function ecartCardError(hand: readonly string[], id: string): string | null {
  if (!hand.includes(id)) return 'Cette carte n’est pas dans votre main.';
  if (isKing(id) || isOudler(id)) return 'Les rois et les oudlers ne vont pas à l’écart.';
  if (isTrump(id) && plainDiscardCount(hand) >= CHIEN_SIZE) {
    return 'Les atouts ne vont à l’écart que si vous n’avez pas assez d’autres cartes.';
  }
  return null;
}

/** Vrai si la carte peut faire partie d'un écart valable pour cette main. */
export function canDiscard(hand: readonly string[], id: string): boolean {
  return ecartCardError(hand, id) === null;
}

/** Pourquoi cet écart est refusé, ou null s'il est valable. `hand` est la main avec le chien (24 cartes). */
export function ecartError(hand: readonly string[], ecart: readonly string[]): string | null {
  if (ecart.length !== CHIEN_SIZE) return `L’écart compte exactement ${CHIEN_SIZE} cartes.`;
  if (new Set(ecart).size !== ecart.length) return 'Carte choisie deux fois.';
  if (ecart.some((id) => !hand.includes(id))) return 'Cette carte n’est pas dans votre main.';
  if (ecart.some((id) => isKing(id) || isOudler(id))) return 'Les rois et les oudlers ne vont pas à l’écart.';
  const trumps = ecart.filter(isTrump).length;
  if (trumps > Math.max(0, CHIEN_SIZE - plainDiscardCount(hand))) {
    return 'Les atouts ne vont à l’écart que si vous n’avez pas assez d’autres cartes.';
  }
  return null;
}

/** Plus faible d'abord : valeur en points, puis force. */
export function byLowValue(a: string, b: string): number {
  return cardHalfPoints(a) - cardHalfPoints(b) || cardStrength(a) - cardStrength(b) || a.localeCompare(b);
}

/** Écart automatique (temps écoulé) : les cartes de couleur les plus faibles, puis les plus petits atouts si besoin. */
export function autoEcart(hand: readonly string[]): string[] {
  const plain = hand.filter(isPlainDiscard).sort(byLowValue);
  if (plain.length >= CHIEN_SIZE) return plain.slice(0, CHIEN_SIZE);
  const trumps = hand.filter((id) => isTrump(id) && !isOudler(id)).sort(byLowValue);
  return [...plain, ...trumps.slice(0, CHIEN_SIZE - plain.length)];
}

// ---------------------------------------------------------------------------
// Contrats et marque
// ---------------------------------------------------------------------------

export const CONTRACTS = ['petite', 'garde', 'garde-sans', 'garde-contre'] as const;
export type Contract = (typeof CONTRACTS)[number];

export const CONTRACT_LABEL: Record<Contract, string> = {
  petite: 'Petite',
  garde: 'Garde',
  'garde-sans': 'Garde sans le chien',
  'garde-contre': 'Garde contre le chien',
};

export const CONTRACT_COEF: Record<Contract, number> = {
  petite: 1,
  garde: 2,
  'garde-sans': 4,
  'garde-contre': 6,
};

/** Points à faire selon le nombre d'oudlers du preneur (0 à 3). */
export const POINTS_NEEDED: readonly number[] = [56, 51, 41, 36];

/** Contrats plus forts que l'enchère actuelle (tous si personne n'a encore annoncé). */
export function contractsAbove(highest: Contract | null): Contract[] {
  const from = highest ? CONTRACTS.indexOf(highest) + 1 : 0;
  return CONTRACTS.slice(from);
}

/** Petite et Garde : le chien est montré puis pris par le preneur, qui fait un écart. */
export function chienIsRevealed(contract: Contract): boolean {
  return contract === 'petite' || contract === 'garde';
}

/** Camp qui reçoit le chien (ou l'écart) : la défense seulement en Garde contre. */
export function chienSide(contract: Contract): Side {
  return contract === 'garde-contre' ? 'defence' : 'attack';
}

export interface DealInput {
  contract: Contract;
  /** Toutes les cartes comptées pour le preneur : plis, écart ou chien, Excuse gardée. */
  attackCards: readonly string[];
  /** Échange de l'Excuse, en demi-points ajoutés au preneur (+1, -1 ou 0). */
  excuseTransfer: number;
  /** Camp qui a remporté le dernier pli contenant le Petit, sinon null. */
  petitAuBout: Side | null;
  tricks: Record<Side, number>;
}

export interface DealScore {
  /** Points du preneur, en demi-points. */
  attackHalf: number;
  oudlers: number;
  needed: number;
  /** Écart avec les points à faire, en demi-points (négatif si le contrat chute). */
  diffHalf: number;
  made: boolean;
  /** 25 + écart arrondi au point supérieur. */
  base: number;
  coef: number;
  /** +10 pour le preneur, -10 pour la défense, 0 sinon (avant multiplicateur). */
  pab: number;
  chelem: number;
  /** Résultat d'un défenseur, au signe près : le preneur marque 3 fois ce total, chaque défenseur -1 fois. */
  total: number;
}

export function scoreDeal(input: DealInput): DealScore {
  const attackHalf = countHalfPoints(input.attackCards) + input.excuseTransfer;
  const oudlers = input.attackCards.filter(isOudler).length;
  const needed = POINTS_NEEDED[oudlers] ?? 36;
  const diffHalf = attackHalf - needed * 2;
  const made = diffHalf >= 0;
  const base = 25 + Math.ceil(Math.abs(diffHalf) / 2);
  const coef = CONTRACT_COEF[input.contract];
  const pab = input.petitAuBout === 'attack' ? 10 : input.petitAuBout === 'defence' ? -10 : 0;
  const chelem = input.tricks.attack === TRICKS_PER_DEAL ? 200 : input.tricks.defence === TRICKS_PER_DEAL ? -200 : 0;
  const total = (made ? base : -base) * coef + pab * coef + chelem;
  return { attackHalf, oudlers, needed, diffHalf, made, base, coef, pab, chelem, total };
}

/** Gains de la donne : le preneur marque 3 × total, chaque défenseur -total (somme nulle). */
export function dealDeltas(order: readonly string[], taker: string, total: number): Record<string, number> {
  return Object.fromEntries(order.map((id) => [id, id === taker ? total * (order.length - 1) : 0 - total]));
}
