import type { CardGameDefinition } from '@partyhub/shared';

/**
 * Règles pures du Président : paquet de 52 cartes, valeurs, validation d'un pli.
 * Le serveur et le téléphone utilisent les mêmes fonctions : une carte refusée
 * sur le téléphone l'est aussi sur le serveur, et inversement.
 */

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = [
  { id: 's', label: 'Pique', glyph: '♠', color: '#16162e' },
  { id: 'h', label: 'Cœur', glyph: '♥', color: '#d6293a' },
  { id: 'd', label: 'Carreau', glyph: '♦', color: '#d6293a' },
  { id: 'c', label: 'Trèfle', glyph: '♣', color: '#16162e' },
] as const;

/** Valeur de rang : 3 est la plus faible, 2 la plus forte. */
export function rankValue(rank: string): number {
  return RANKS.indexOf(rank as Rank) + 3;
}

/** Pour le Président, on lit le rang dans le libellé de la carte. */
export function rankOf(entry: { label: string }): number {
  return rankValue(entry.label);
}

/**
 * Main triée du plus faible au plus fort, pour l'affichage seulement : le jeu ne change pas.
 * À rang égal, l'ordre des couleurs du paquet.
 */
export function sortHandByRank<T extends { entry: string }>(hand: readonly T[]): T[] {
  const deck = new Map(PRESIDENT_DEFINITION.cards.map((c, order) => [c.id, { rank: rankOf(c), order }]));
  const at = (card: T) => deck.get(card.entry) ?? { rank: Number.MAX_SAFE_INTEGER, order: 0 };
  return [...hand].sort((a, b) => at(a).rank - at(b).rank || at(a).order - at(b).order);
}

/** Définition du paquet, au format commun aux jeux de cartes (rendu SVG partagé). */
export const PRESIDENT_DEFINITION: CardGameDefinition = {
  name: 'Président',
  description: 'Le classique des soirées : montez en grade, de Trou du cul à Président.',
  icon: '👑',
  theme: 'classique',
  families: SUITS.map((s) => ({ id: s.id, label: s.label, color: s.color })),
  cards: SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${rank.toLowerCase()}${suit.id}`,
      label: rank,
      symbol: `${rank}${suit.glyph}`,
      family: suit.id,
      effect: 'none' as const,
      count: 1,
      points: rankValue(rank),
    })),
  ),
  rules: { minPlayers: 3, maxPlayers: 6, handSize: 13, matchOn: 'family', targetScore: 0, turnSeconds: 25 },
  notice: {
    goal: 'Être le premier à vider sa main, et devenir Président de la partie.',
    steps: [
      'Les cartes sont réparties entre tous les joueurs.',
      'À votre tour, posez une ou plusieurs cartes de même rang, plus fortes que le pli en cours.',
      'Le 2 est la carte la plus forte, le 3 la plus faible.',
      'Un 10 ou un carré (quatre cartes identiques) brûle le pli : il est retiré et vous rejouez.',
      'Si vous ne pouvez pas jouer, passez. Quand tous les autres ont passé, le pli se termine.',
      'Chaque manche, le Trou du cul donne ses deux meilleures cartes au Président, qui lui rend ses deux plus faibles.',
    ],
    tips: [
      'Gardez un 2 pour finir un pli au bon moment.',
      'Un carré ou un 10 est votre meilleure arme pour reprendre la main.',
    ],
  },
};

/**
 * Vrai si `cards` forment un coup valable sur le pli en cours :
 * même rang, nombre égal au pli, rang supérieur — ou coup de brûlage (10 ou carré).
 * Sur une table vide, n'importe quel groupe de même rang est valable.
 */
export function validatePlay(
  pileRank: number,
  pileCount: number,
  cards: { label: string }[],
): { ok: true; burns: boolean } | { ok: false; error: string } {
  if (cards.length === 0) return { ok: false, error: 'Choisissez au moins une carte.' };
  const rank = rankOf(cards[0]!);
  if (cards.some((c) => rankOf(c) !== rank)) {
    return { ok: false, error: 'Les cartes jouées doivent avoir le même rang.' };
  }
  const burns = rank === rankValue('10') || cards.length === 4;
  if (pileCount === 0) return { ok: true, burns };
  if (cards.length !== pileCount) {
    return { ok: false, error: `Il faut jouer ${pileCount} carte(s), comme le pli.` };
  }
  if (burns || rank > pileRank) return { ok: true, burns };
  return { ok: false, error: 'Cette combinaison ne bat pas le pli.' };
}
