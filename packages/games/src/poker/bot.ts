import { evaluateHand, type PokerCard } from './rules.js';

/**
 * Force d’une main entre 0 et 1, pour les robots. Avant le flop, elle vient des deux cartes privées ; après,
 * de la meilleure combinaison, pondérée par la catégorie (une paire vaut plus qu’une carte haute, etc.).
 */

/** Force de base par catégorie (carte haute à quinte flush). */
const CATEGORY_STRENGTH = [0.12, 0.38, 0.55, 0.68, 0.78, 0.84, 0.91, 0.96, 1];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function handStrength(holes: PokerCard[], board: PokerCard[]): number {
  if (holes.length < 2) return 0;
  const [a, b] = holes as [PokerCard, PokerCard];
  if (board.length === 0) {
    const hi = Math.max(a.rank, b.rank);
    const lo = Math.min(a.rank, b.rank);
    if (a.rank === b.rank) return clamp(0.55 + a.rank / 40);
    let value = (hi + lo) / 28;
    if (a.suit === b.suit) value += 0.06;
    if (hi - lo <= 2) value += 0.03;
    return clamp(value);
  }
  const hand = evaluateHand([...holes, ...board]);
  const base = CATEGORY_STRENGTH[hand.category] ?? 0.1;
  return clamp(base + ((hand.score[1] ?? 0) / 14) * 0.05);
}
