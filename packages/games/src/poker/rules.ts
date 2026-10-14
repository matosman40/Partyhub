import type { CardGameDefinition } from '@partyhub/shared';

/**
 * Règles pures du poker (Texas hold'em) : cartes, évaluation des mains,
 * pots principal et secondaires. Aucune dépendance au réseau ni à l'horloge.
 *
 * Une carte est identifiée par deux caractères : son rang (« 2 » à « 9 », « T »,
 * « J », « Q », « K », « A ») puis sa couleur (« s », « h », « d », « c »).
 * Exemple : « As » = as de pique, « Th » = dix de cœur.
 */

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc';

export interface Card {
  /** 2 à 14 (valet 11, dame 12, roi 13, as 14). */
  rank: number;
  /** 0 pique, 1 cœur, 2 carreau, 3 trèfle. */
  suit: number;
}

export function parseCard(id: string): Card {
  return { rank: RANK_CHARS.indexOf(id[0]!) + 2, suit: SUIT_CHARS.indexOf(id[1]!) };
}

const SUITS = [
  { id: 's', label: 'Pique', glyph: '♠', color: '#16162e' },
  { id: 'h', label: 'Cœur', glyph: '♥', color: '#d6293a' },
  { id: 'd', label: 'Carreau', glyph: '♦', color: '#d6293a' },
  { id: 'c', label: 'Trèfle', glyph: '♣', color: '#16162e' },
] as const;

const DISPLAY: Record<string, string> = { T: '10', J: 'V', Q: 'D', K: 'R', A: 'A' };

/** Définition du paquet de 52 cartes, au format commun au rendu des cartes. */
export const POKER_DEFINITION: CardGameDefinition = {
  name: 'Poker',
  description: 'Texas hold’em : mises, bluff et meilleure main de cinq cartes.',
  icon: '♠️',
  theme: 'classique',
  families: SUITS.map((s) => ({ id: s.id, label: s.label, color: s.color })),
  cards: SUITS.flatMap((suit) =>
    RANK_CHARS.split('').map((rank) => {
      const display = DISPLAY[rank] ?? rank;
      return {
        id: `${rank}${suit.id}`,
        label: display,
        symbol: `${display}${suit.glyph}`,
        family: suit.id,
        effect: 'none' as const,
        count: 1,
        points: 0,
      };
    }),
  ),
  rules: { minPlayers: 2, maxPlayers: 8, handSize: 2, matchOn: 'family', targetScore: 0, turnSeconds: 25 },
  notice: {
    goal: 'Rester le dernier joueur avec des jetons, en gagnant les mains.',
    steps: [
      'Chacun reçoit deux cartes privées. Le croupier et les blindes ouvrent la donne.',
      'Mise à tour de rôle : se coucher, suivre, relancer ou tapir (tous ses jetons).',
      'Trois cartes communes (le flop), puis une (le turn), puis une (la river).',
      'À la fin des mises, la meilleure main de cinq cartes parmi les sept remporte le pot.',
      'Un joueur sans jetons est éliminé. La partie s’arrête quand il ne reste qu’un joueur.',
    ],
    tips: [
      'Une relance doit être au moins égale à la dernière hausse.',
      'Quand plusieurs joueurs tapissent, des pots secondaires se forment : chacun ne peut gagner que ce qu’il a misé.',
    ],
  },
};

/** Valeur d'une main de cinq cartes : catégorie, puis départages dans l'ordre. */
export interface HandValue {
  category: number;
  ranks: number[];
  name: string;
}

const CATEGORY_NAMES = [
  'Carte haute',
  'Paire',
  'Double paire',
  'Brelan',
  'Quinte',
  'Couleur',
  'Full',
  'Carré',
  'Quinte flush',
];

function make(category: number, ranks: number[]): HandValue {
  const name = category === 8 && ranks[0] === 14 ? 'Quinte flush royale' : CATEGORY_NAMES[category]!;
  return { category, ranks, name };
}

/** Évalue exactement cinq cartes. */
export function evaluateFive(cards: Card[]): HandValue {
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const flush = sorted.every((c) => c.suit === sorted[0]!.suit);
  const unique = [...new Set(sorted.map((c) => c.rank))];

  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0]! - unique[4]! === 4) straightHigh = unique[0]!;
    else if (unique.join(',') === '14,5,4,3,2') straightHigh = 5; // As bas : la suite est 5-4-3-2-A.
  }

  const counts = new Map<number, number>();
  for (const c of sorted) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  // Groupes triés par nombre de cartes, puis par rang décroissant.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byRank = groups.map((g) => g[0]);
  const top = groups[0]![1];
  const second = groups[1]?.[1] ?? 0;

  if (straightHigh && flush) return make(8, [straightHigh]);
  if (top === 4) return make(7, [byRank[0]!, byRank[1]!]);
  if (top === 3 && second === 2) return make(6, [byRank[0]!, byRank[1]!]);
  if (flush)
    return make(
      5,
      sorted.map((c) => c.rank),
    );
  if (straightHigh) return make(4, [straightHigh]);
  if (top === 3) return make(3, byRank);
  if (top === 2 && second === 2) return make(2, byRank);
  if (top === 2) return make(1, byRank);
  return make(0, byRank);
}

/** Meilleure main de cinq cartes parmi cinq à sept cartes (identifiants de carte). */
export function evaluateBest(cardIds: string[]): HandValue {
  const cards = cardIds.map(parseCard);
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const value = evaluateFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || compareHands(value, best) > 0) best = value;
          }
  if (!best) throw new Error('Au moins cinq cartes sont nécessaires.');
  return best;
}

/** Positif si `a` bat `b`, négatif si `b` bat `a`, zéro en cas d'égalité. */
export function compareHands(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface PotPlan {
  amount: number;
  /** Joueurs qui peuvent gagner ce pot (non couchés, ayant misé au moins ce niveau). */
  eligible: string[];
}

/**
 * Découpe les mises en pots. Chaque niveau de mise crée un pot : un joueur tapi
 * avec peu de jetons ne peut gagner que les pots auxquels il a contribué.
 * `totals` contient la mise cumulée de chaque joueur pour la main, couchés compris.
 */
export function buildPots(totals: Record<string, number>, folded: string[]): PotPlan[] {
  const levels = [...new Set(Object.values(totals).filter((v) => v > 0))].sort((a, b) => a - b);
  const pots: PotPlan[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const total of Object.values(totals)) {
      amount += Math.min(total, level) - Math.min(total, previous);
    }
    const eligible = Object.keys(totals).filter((id) => !folded.includes(id) && (totals[id] ?? 0) >= level);
    if (amount > 0) {
      if (eligible.length > 0) pots.push({ amount, eligible });
      else if (pots.length > 0) pots[pots.length - 1]!.amount += amount;
    }
    previous = level;
  }
  return pots;
}

export interface PotResult {
  /** Gains par joueur. */
  awards: Record<string, number>;
  /** Meilleure main de chaque joueur gagnant, pour l'affichage. */
  hands: Record<string, string>;
}

/**
 * Attribue chaque pot à la meilleure main parmi ses ayants droit. Les ex æquo se
 * partagent le pot ; le reste indivisible va au premier joueur après le croupier.
 * `afterDealer` liste les joueurs dans l'ordre de jeu, en commençant après le croupier.
 */
export function resolvePots(pots: PotPlan[], values: Record<string, HandValue>, afterDealer: string[]): PotResult {
  const awards: Record<string, number> = {};
  const hands: Record<string, string> = {};
  for (const pot of pots) {
    let best: HandValue | null = null;
    let winners: string[] = [];
    for (const id of pot.eligible) {
      const value = values[id];
      if (!value) continue;
      if (!best) {
        best = value;
        winners = [id];
        continue;
      }
      const cmp = compareHands(value, best);
      if (cmp > 0) {
        best = value;
        winners = [id];
      } else if (cmp === 0) {
        winners.push(id);
      }
    }
    if (winners.length === 0) winners = [...pot.eligible];
    winners.sort((a, b) => afterDealer.indexOf(a) - afterDealer.indexOf(b));
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const id of winners) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      awards[id] = (awards[id] ?? 0) + share + extra;
      if (values[id]) hands[id] = values[id]!.name;
    }
  }
  return { awards, hands };
}
