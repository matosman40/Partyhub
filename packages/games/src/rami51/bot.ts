import {
  SUITS,
  cardInfo,
  checkLayoff,
  checkMeld,
  isJoker,
  penaltyValue,
  type Meld,
  type RamiCard,
  type SuitId,
} from './rules.js';

/**
 * Décisions des robots du Rami 51. Tout passe par les mêmes fonctions de validation
 * que le serveur : un robot ne propose jamais un coup que les règles refuseraient.
 * Chaque coup posé retire au moins une carte de la main : un tour de robot finit toujours.
 */

interface Candidate {
  cards: RamiCard[];
  points: number;
  franche: boolean;
}

/** Sous-ensembles de `items` de taille `size` (petites listes : quatre couleurs au plus). */
function subsets<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...subsets(rest, size - 1).map((s) => [head, ...s]), ...subsets(rest, size)];
}

/**
 * Combinaisons possibles dans une main : brelans, carrés et suites naturels,
 * et, si `withJokers`, celles qu’un joker complète (deux vraies cartes au moins).
 */
export function meldCandidates(hand: readonly RamiCard[], withJokers: boolean): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const consider = (cards: RamiCard[]) => {
    const key = cards
      .map((c) => c.uid)
      .sort()
      .join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const check = checkMeld(cards);
    if (check.ok) out.push({ cards, points: check.points, franche: check.franche });
  };
  const jokers = withJokers ? hand.filter(isJoker) : [];

  // Brelans et carrés : une carte par couleur pour chaque rang.
  const byRank = new Map<number, Map<SuitId, RamiCard>>();
  for (const card of hand) {
    const info = cardInfo(card.entry);
    if (!info || info.joker) continue;
    const row = byRank.get(info.rank) ?? new Map<SuitId, RamiCard>();
    if (!row.has(info.suit!)) row.set(info.suit!, card);
    byRank.set(info.rank, row);
  }
  for (const row of byRank.values()) {
    const cards = [...row.values()];
    for (const size of [4, 3]) for (const s of subsets(cards, size)) consider(s);
    for (const joker of jokers) {
      for (const size of [3, 2]) for (const s of subsets(cards, size)) consider([...s, joker]);
    }
  }

  // Suites : une carte par place dans chaque couleur, l’as en bas (1) comme en haut (14).
  for (const suit of SUITS) {
    const at = new Map<number, RamiCard>();
    for (const card of hand) {
      const info = cardInfo(card.entry);
      if (!info || info.joker || info.suit !== suit.id) continue;
      if (!at.has(info.rank)) at.set(info.rank, card);
      if (info.rank === 1 && !at.has(14)) at.set(14, card);
    }
    if (at.size < 2) continue;
    for (let start = 1; start <= 12; start++) {
      for (let end = start + 2; end <= Math.min(14, start + 12); end++) {
        const present: RamiCard[] = [];
        let missing = 0;
        for (let p = start; p <= end; p++) {
          const card = at.get(p);
          if (card) present.push(card);
          else missing += 1;
        }
        if (missing === 0) consider(present);
        else if (missing === 1 && present.length >= 2) for (const joker of jokers) consider([...present, joker]);
        else if (missing > 1) break;
      }
    }
  }
  return out;
}

/** Meilleur choix de combinaisons disjointes : le plus de cartes posées, puis le plus de points. */
function bestCombination(
  candidates: Candidate[],
  maxCards: number,
  accept: (points: number, franche: boolean) => boolean,
): Candidate[] | null {
  const sorted = [...candidates].sort((a, b) => b.cards.length - a.cards.length || b.points - a.points);
  let best: { combo: Candidate[]; cards: number; points: number } | null = null;
  let budget = 20000;
  const used = new Set<string>();
  const chosen: Candidate[] = [];

  const visit = (from: number, cards: number, points: number, franche: boolean) => {
    if (--budget < 0) return;
    if (chosen.length > 0 && accept(points, franche)) {
      if (!best || cards > best.cards || (cards === best.cards && points > best.points)) {
        best = { combo: [...chosen], cards, points };
      }
    }
    for (let i = from; i < sorted.length; i++) {
      const c = sorted[i]!;
      if (cards + c.cards.length > maxCards) continue;
      if (c.cards.some((card) => used.has(card.uid))) continue;
      for (const card of c.cards) used.add(card.uid);
      chosen.push(c);
      visit(i + 1, cards + c.cards.length, points + c.points, franche || c.franche);
      chosen.pop();
      for (const card of c.cards) used.delete(card.uid);
    }
  };
  visit(0, 0, 0, false);
  return (best as { combo: Candidate[] } | null)?.combo ?? null;
}

/**
 * Ouverture d’un robot : combinaisons disjointes (sans joker d’abord, puis avec)
 * qui atteignent le seuil avec une tierce franche, en gardant une carte pour la défausse.
 */
export function planOpening(hand: readonly RamiCard[], threshold: number): RamiCard[][] | null {
  const maxCards = hand.length - 1;
  if (maxCards < 3) return null;
  for (const withJokers of [false, true]) {
    if (withJokers && !hand.some(isJoker)) break;
    const combo = bestCombination(
      meldCandidates(hand, withJokers),
      maxCards,
      (points, franche) => franche && points >= threshold,
    );
    if (combo) return combo.map((c) => c.cards);
  }
  return null;
}

/** Après l’ouverture : la plus grande combinaison à poser (naturelle d’abord), en gardant une carte. */
export function planMeld(hand: readonly RamiCard[]): RamiCard[] | null {
  for (const withJokers of [false, true]) {
    if (withJokers && !hand.some(isJoker)) break;
    const options = meldCandidates(hand, withJokers)
      .filter((c) => c.cards.length <= hand.length - 1)
      .sort((a, b) => b.cards.length - a.cards.length || b.points - a.points);
    if (options[0]) return options[0].cards;
  }
  return null;
}

/**
 * Une carte à ajouter sur la table (la plus chère d’abord). Le joker n’est placé
 * que pour finir une petite main, où il coûterait 20 points.
 */
export function planLayoff(
  hand: readonly RamiCard[],
  melds: readonly Meld[],
): { meldId: string; cardIds: string[] } | null {
  if (hand.length <= 1) return null;
  const naturals = hand.filter((c) => !isJoker(c)).sort((a, b) => penaltyValue(b.entry) - penaltyValue(a.entry));
  const order = hand.length <= 4 ? [...naturals, ...hand.filter(isJoker)] : naturals;
  for (const card of order) {
    for (const meld of melds) {
      if (checkLayoff(meld, [card]).ok) return { meldId: meld.id, cardIds: [card.uid] };
    }
  }
  return null;
}

/** Deux cartes qui peuvent finir dans une même combinaison (paire ou cartes proches de même couleur). */
function near(a: RamiCard, b: RamiCard): boolean {
  const x = cardInfo(a.entry);
  const y = cardInfo(b.entry);
  if (!x || !y || x.joker || y.joker) return false;
  if (x.rank === y.rank) return x.suit !== y.suit;
  if (x.suit !== y.suit) return false;
  const dist = (r: number, s: number) => Math.abs(r - s);
  const high = (r: number) => (r === 1 ? 14 : r);
  const d = Math.min(dist(x.rank, y.rank), dist(high(x.rank), high(y.rank)));
  return d >= 1 && d <= 2;
}

/**
 * Défausse d’un robot : la carte la plus chère qui n’appartient à aucune ébauche de combinaison.
 * Si toutes les cartes sont liées, on lâche la moins liée et la moins chère : garder les grosses
 * cartes permet d’atteindre le seuil d’ouverture au lieu d’amasser des petites cartes.
 */
export function planDiscard(hand: readonly RamiCard[]): RamiCard {
  const naturals = hand.filter((c) => !isJoker(c));
  if (naturals.length === 0) return hand[0]!;
  const links = (c: RamiCard) => naturals.filter((d) => d.uid !== c.uid && near(c, d)).length;
  const loose = naturals.filter((c) => links(c) === 0);
  if (loose.length > 0) {
    return [...loose].sort((a, b) => penaltyValue(b.entry) - penaltyValue(a.entry) || a.uid.localeCompare(b.uid))[0]!;
  }
  return [...naturals].sort(
    (a, b) => links(a) - links(b) || penaltyValue(a.entry) - penaltyValue(b.entry) || a.uid.localeCompare(b.uid),
  )[0]!;
}
