/**
 * Règles pures du poker Texas hold'em : paquet, valeur d'une main (meilleure combinaison parmi 7 cartes),
 * pots principal et latéraux, et répartition des pots entre les meilleures mains.
 */

export type Suit = 'c' | 'd' | 'h' | 's';

/** Carte : valeur de 2 (deux) à 14 (as). */
export interface PokerCard {
  rank: number;
  suit: Suit;
}

export const SUIT_SYMBOL: Record<Suit, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
export const RANK_LABEL: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'V',
  12: 'D',
  13: 'R',
  14: 'A',
};

/** Noms des combinaisons, par catégorie croissante. */
export const HAND_NAMES = [
  'Carte haute',
  'Paire',
  'Deux paires',
  'Brelan',
  'Quinte',
  'Couleur',
  'Full',
  'Carré',
  'Quinte flush',
] as const;

export function fullDeck(): PokerCard[] {
  const deck: PokerCard[] = [];
  for (const suit of ['c', 'd', 'h', 's'] as Suit[]) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit });
  }
  return deck;
}

export function cardLabel(card: PokerCard): string {
  return `${RANK_LABEL[card.rank] ?? '?'}${SUIT_SYMBOL[card.suit]}`;
}

export interface HandValue {
  /** Indice dans HAND_NAMES (0 = carte haute, 8 = quinte flush). */
  category: number;
  /** Valeurs de comparaison : la catégorie, puis les départages dans l'ordre. */
  score: number[];
  name: string;
}

/** Valeur d'une main de 5 cartes. Le tableau renvoyé se compare lexicographiquement. */
function scoreFive(cards: PokerCard[]): number[] {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);
  const unique = [...new Set(ranks)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0]! - unique[4]! === 4) straightHigh = unique[0]!;
    // La roue : as, 2, 3, 4, 5 vaut une quinte à la carte haute 5.
    else if (unique.join(',') === '14,5,4,3,2') straightHigh = 5;
  }

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Groupes triés : d'abord par nombre de cartes, puis par valeur.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byCount = groups.map((g) => g[0]);
  const shape = groups.map((g) => g[1]).join('');

  if (straightHigh && flush) return [8, straightHigh];
  if (shape === '41') return [7, byCount[0]!, byCount[1]!];
  if (shape === '32') return [6, byCount[0]!, byCount[1]!];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (shape === '311') return [3, byCount[0]!, byCount[1]!, byCount[2]!];
  if (shape === '221') return [2, byCount[0]!, byCount[1]!, byCount[2]!];
  if (shape === '2111') return [1, byCount[0]!, byCount[1]!, byCount[2]!, byCount[3]!];
  return [0, ...ranks];
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]!);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}

export function compareScores(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Meilleure main de 5 cartes parmi les cartes données (en pratique 7 : deux privées et cinq communes). */
export function evaluateHand(cards: PokerCard[]): HandValue {
  if (cards.length < 5) {
    const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
    return { category: 0, score: [0, ...ranks], name: HAND_NAMES[0] };
  }
  let best: number[] | null = null;
  for (const five of combinations(cards, 5)) {
    const score = scoreFive(five);
    if (best === null || compareScores(score, best) > 0) best = score;
  }
  const category = best![0]!;
  const royal = category === 8 && best![1] === 14;
  return {
    category,
    score: best!,
    name: royal ? 'Quinte flush royale' : HAND_NAMES[category]!,
  };
}

export interface Pot {
  amount: number;
  /** Joueurs qui peuvent gagner ce pot. */
  eligible: string[];
}

/**
 * Pots à partir des mises totales de chacun. Un pot par palier de mise : le pot principal contient ce que
 * chacun a mis jusqu'au plus petit tapis, les pots latéraux le reste. Un joueur ne gagne que les pots auxquels
 * il a contribué. Une mise non suivie (plus haute que tous les autres) revient à son auteur, car il est seul
 * éligible au palier qui la contient.
 */
export function buildPots(committed: Record<string, number>, live: string[]): Pot[] {
  const pids = Object.keys(committed);
  const levels = [...new Set(pids.map((p) => committed[p]!).filter((v) => v > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of pids) amount += Math.max(0, Math.min(committed[p]!, level) - previous);
    let eligible = pids.filter((p) => committed[p]! >= level && live.includes(p));
    if (eligible.length === 0) eligible = [...live];
    if (amount > 0) pots.push({ amount, eligible });
    previous = level;
  }
  return pots;
}

export interface PotAward {
  pid: string;
  amount: number;
  /** Nom de la meilleure main du gagnant, au showdown. */
  hand: string | null;
}

/**
 * Répartit chaque pot entre les meilleures mains de ses joueurs éligibles. Les égalités se partagent ; le
 * reliquat d'un pot (quand il ne se divise pas) va aux premiers gagnants à partir du bouton.
 */
export function settlePots(
  pots: Pot[],
  holes: Record<string, PokerCard[]>,
  board: PokerCard[],
  order: string[],
  dealer: number,
): { payouts: Record<string, number>; awards: PotAward[] } {
  const payouts: Record<string, number> = {};
  const hands: Record<string, HandValue> = {};
  const total: Record<string, number> = {};
  const n = order.length;

  for (const pot of pots) {
    const contenders = pot.eligible.filter((p) => (holes[p] ?? []).length === 2);
    if (contenders.length === 0) continue;
    for (const p of contenders) {
      if (!hands[p]) hands[p] = evaluateHand([...holes[p]!, ...board]);
    }
    let best = contenders[0]!;
    for (const p of contenders) {
      if (compareScores(hands[p]!.score, hands[best]!.score) > 0) best = p;
    }
    const winners = contenders.filter((p) => compareScores(hands[p]!.score, hands[best]!.score) === 0);
    // Ordre à partir du bouton, pour le reliquat.
    const ordered: string[] = [];
    for (let k = 1; k <= n; k++) {
      const pid = order[(((dealer + k) % n) + n) % n]!;
      if (winners.includes(pid)) ordered.push(pid);
    }
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;
    ordered.forEach((pid, i) => {
      const gain = share + (i < remainder ? 1 : 0);
      payouts[pid] = (payouts[pid] ?? 0) + gain;
      total[pid] = (total[pid] ?? 0) + gain;
    });
  }

  const awards = Object.keys(total).map((pid) => ({
    pid,
    amount: total[pid]!,
    hand: hands[pid]?.name ?? null,
  }));
  return { payouts, awards };
}
