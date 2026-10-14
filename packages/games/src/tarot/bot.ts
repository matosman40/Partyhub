import {
  CHIEN_SIZE,
  CONTRACTS,
  EXCUSE,
  PETIT,
  VINGT_ET_UN,
  autoEcart,
  byLowValue,
  cardHalfPoints,
  cardStrength,
  familyOf,
  isKing,
  isTrump,
  ledFamily,
  legalCards,
  rankOf,
  trickWinner,
  type Contract,
  type SuitId,
} from './rules.js';

/**
 * Robots du tarot (mode test). Ils jouent toujours une carte permise, avec des règles
 * simples : enchère selon la force de la main, écart qui crée des coupes, et jeu économe
 * (gagner à moindre frais un pli qui rapporte, sinon jouer petit, ne pas gâcher le Petit).
 * Ils ne connaissent que ce qu'un joueur voit : leur main, les plis joués, et l'écart
 * pour le preneur (les atouts écartés pour les autres).
 */

const SUIT_IDS: readonly SuitId[] = ['s', 'h', 'd', 'c'];

export interface PlayedCard {
  playerId: string;
  cardId: string;
}

/** Ce que voit un robot au moment de jouer une carte. */
export interface BotView {
  hand: readonly string[];
  /** Pli en cours, dans l'ordre de jeu. */
  trick: readonly PlayedCard[];
  me: string;
  taker: string | null;
  /** Les quatre joueurs, dans l'ordre de jeu. */
  order: readonly string[];
  /** Cartes sorties du jeu à sa connaissance : plis terminés, et écart s'il est connu. */
  seen: readonly string[];
}

/**
 * Force d'une main pour les enchères : bouts, atouts (les gros comptent double), rois et
 * figures, longues et coupes.
 */
export function handStrength(hand: readonly string[]): number {
  const trumps = hand.filter(isTrump);
  const count = trumps.length;
  let score = count * 2.5;
  score += trumps.filter((id) => rankOf(id) >= 16).length * 2;
  if (hand.includes(VINGT_ET_UN)) score += 12;
  if (hand.includes(EXCUSE)) score += 10;
  // Le Petit ne vaut que s'il est protégé par assez d'atouts.
  if (hand.includes(PETIT)) score += count >= 6 ? 8 : count >= 4 ? 5 : 1;
  for (const suit of SUIT_IDS) {
    const cards = hand.filter((id) => familyOf(id) === suit);
    const has = (rank: number) => cards.some((id) => rankOf(id) === rank);
    if (has(14)) score += has(13) ? 10 : 6;
    else if (has(13)) score += 3;
    if (has(12)) score += 2;
    if (has(11)) score += 1;
    if (cards.length >= 7) score += 9;
    else if (cards.length === 6) score += 7;
    else if (cards.length === 5) score += 5;
    if (count >= 5) {
      if (cards.length === 0) score += 6;
      else if (cards.length === 1) score += 3;
    }
  }
  return score;
}

/** Seuils de force pour chaque contrat (du plus fort au plus faible). */
const BID_THRESHOLDS: readonly [Contract, number][] = [
  ['garde-contre', 90],
  ['garde-sans', 75],
  ['garde', 62],
  ['petite', 52],
];

/** Enchère d'un robot : le contrat que sa main permet, s'il dépasse l'enchère actuelle ; sinon il passe. */
export function botBid(hand: readonly string[], highest: Contract | null): Contract | null {
  const strength = handStrength(hand);
  const wanted = BID_THRESHOLDS.find(([, min]) => strength >= min)?.[0] ?? null;
  if (!wanted) return null;
  const floor = highest ? CONTRACTS.indexOf(highest) : -1;
  return CONTRACTS.indexOf(wanted) > floor ? wanted : null;
}

/**
 * Écart d'un robot : vider d'abord les couleurs courtes sans roi (pour couper ensuite),
 * puis compléter avec les cartes les plus faibles. Toujours valable.
 */
export function botEcart(hand: readonly string[]): string[] {
  const plain = hand.filter((id) => !isTrump(id) && id !== EXCUSE && !isKing(id));
  if (plain.length <= CHIEN_SIZE) return autoEcart(hand);
  const chosen: string[] = [];
  const voidable = SUIT_IDS.map((suit) => hand.filter((id) => familyOf(id) === suit))
    .filter((cards) => cards.length > 0 && !cards.some(isKing))
    .sort((a, b) => a.length - b.length);
  for (const cards of voidable) {
    if (chosen.length + cards.length <= CHIEN_SIZE) chosen.push(...cards);
  }
  const rest = plain.filter((id) => !chosen.includes(id)).sort(byLowValue);
  chosen.push(...rest.slice(0, CHIEN_SIZE - chosen.length));
  return chosen;
}

function lowest(cards: readonly string[]): string {
  return [...cards].sort(byLowValue)[0]!;
}

function richest(cards: readonly string[]): string {
  return [...cards].sort((a, b) => cardHalfPoints(b) - cardHalfPoints(a) || cardStrength(a) - cardStrength(b))[0]!;
}

/** Atouts qui ne sont ni dans la main ni sortis du jeu : ceux que les autres peuvent encore avoir. */
function outstandingTrumps(view: BotView): number[] {
  const known = new Set([...view.hand, ...view.seen]);
  const out: number[] = [];
  for (let rank = 1; rank <= 21; rank++) if (!known.has(`t${rank}`)) out.push(rank);
  return out;
}

function playedInSuit(view: BotView, suit: SuitId): number {
  return view.seen.filter((id) => familyOf(id) === suit).length;
}

/** Entame du preneur : tirer les atouts quand il en a beaucoup, encaisser ses rois, puis vider ses couleurs courtes. */
function takerLead(view: BotView, options: readonly string[]): string {
  const trumps = options.filter(isTrump).sort((a, b) => rankOf(b) - rankOf(a));
  const outstanding = outstandingTrumps(view);
  const top = trumps[0];
  if (top && outstanding.length > 0 && trumps.length >= 6 && rankOf(top) > Math.max(...outstanding)) return top;
  const kings = options.filter((id) => isKing(id) && playedInSuit(view, familyOf(id) as SuitId) < 4);
  if (kings.length > 0) return kings[0]!;
  const suited = options.filter((id) => !isTrump(id));
  if (suited.length > 0) {
    const groups = SUIT_IDS.map((suit) => suited.filter((id) => familyOf(id) === suit)).filter((g) => g.length > 0);
    groups.sort((a, b) => a.length - b.length);
    return lowest(groups[0]!);
  }
  return lowestTrump(options);
}

/** Entame d'un défenseur : la plus petite carte de sa couleur la plus longue (le preneur devra couper). */
function defenceLead(options: readonly string[]): string {
  const suited = options.filter((id) => !isTrump(id));
  if (suited.length > 0) {
    const groups = SUIT_IDS.map((suit) => suited.filter((id) => familyOf(id) === suit)).filter((g) => g.length > 0);
    groups.sort((a, b) => b.length - a.length);
    const longest = groups[0]!;
    const small = longest.filter((id) => !isKing(id));
    return lowest(small.length > 0 ? small : longest);
  }
  return lowestTrump(options);
}

function lowestTrump(options: readonly string[]): string {
  const trumps = [...options].sort((a, b) => cardStrength(a) - cardStrength(b));
  return trumps.find((id) => id !== PETIT) ?? trumps[0]!;
}

/**
 * Carte jouée par un robot : toujours une carte permise. Il gagne à moindre frais un pli
 * qui rapporte, charge le pli de son camp quand il est assuré, et ne gâche pas le Petit.
 */
export function botPlay(view: BotView): string {
  const { hand, trick, me, taker, order } = view;
  const cards = trick.map((p) => p.cardId);
  const legal = legalCards(hand, cards);
  if (legal.length === 1) return legal[0]!;
  // Au dernier pli, l'Excuse irait au camp gagnant : on la joue avant.
  if (legal.includes(EXCUSE) && hand.length <= 2) return EXCUSE;
  const options = legal.filter((id) => id !== EXCUSE);
  const isTaker = me === taker;
  if (ledFamily(cards) === null) return isTaker ? takerLead(view, options) : defenceLead(options);

  const sideOf = (id: string) => (id === taker ? 'attack' : 'defence');
  const best = trickWinner(cards);
  const partnerWins = best >= 0 && sideOf(trick[best]!.playerId) === sideOf(me);
  // Adversaires qui joueront encore dans ce pli.
  const after = order.filter((id) => id !== me && !trick.some((p) => p.playerId === id));
  const opponentsAfter = after.filter((id) => sideOf(id) !== sideOf(me));

  if (partnerWins) {
    if (opponentsAfter.length > 0) return lowest(options);
    // Le pli est acquis à notre camp : sauver le Petit, sinon donner des points.
    if (options.includes(PETIT)) return PETIT;
    const suited = options.filter((id) => !isTrump(id));
    return suited.length > 0 ? richest(suited) : lowest(options);
  }

  const carriesPoints = cards.some((id) => cardHalfPoints(id) > 1);
  const outstanding = outstandingTrumps(view);
  const winners = options
    .filter((id) => trickWinner([...cards, id]) === cards.length)
    // Le Petit ne gagne sans risque que si plus aucun adversaire ne joue après.
    .filter((id) => id !== PETIT || opponentsAfter.length === 0)
    .sort((a, b) => cardStrength(a) - cardStrength(b));
  if (winners.length > 0) {
    const cheapest = winners[0]!;
    const safe =
      opponentsAfter.length === 0 || (isTrump(cheapest) && outstanding.every((rank) => rank < rankOf(cheapest)));
    if (carriesPoints || safe || isKing(cheapest)) return cheapest;
  }

  const dump = lowest(options);
  // Plutôt l'Excuse que de donner une grosse carte (roi, dame, Petit…) à l'adversaire.
  if (legal.includes(EXCUSE) && cardHalfPoints(dump) >= 5) return EXCUSE;
  return dump;
}
