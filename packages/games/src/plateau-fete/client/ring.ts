import { KINDS, type CellKind } from '../rules.js';

/**
 * Géométrie du plateau sur l’écran principal. Les positions sont en pourcentage de la boîte du plateau : l’anneau
 * est une ellipse, centrée, plus large que haute, et le centre reste libre pour les annonces.
 */

/** Rayons de l’anneau, en pourcentage de la largeur (x) et de la hauteur (y). */
export const RING_RX = 44;
export const RING_RY = 40;

/** Position d’une case de l’anneau. La case 0 (départ) est en bas, et l’anneau tourne dans le sens des aiguilles. */
export function ringPoint(cell: number, ring: number): { x: number; y: number } {
  const angle = Math.PI / 2 + (2 * Math.PI * cell) / ring;
  return { x: 50 + RING_RX * Math.cos(angle), y: 50 + RING_RY * Math.sin(angle) };
}

/** Icône et libellé de chaque sorte de case, pour le plateau et sa légende. */
export const KIND_LOOK: Record<CellKind, { icon: string; label: string }> = {
  depart: { icon: '🏁', label: 'Départ : +2 pièces en passant' },
  pieces: { icon: '🪙', label: '+3 pièces' },
  perte: { icon: '💸', label: '−3 pièces' },
  event: { icon: '🎁', label: 'Événement' },
  avance: { icon: '⏩', label: 'Avance de 2 cases' },
  recule: { icon: '⏪', label: 'Recule de 2 cases' },
  normal: { icon: '', label: '' },
};

export function kindOf(cell: number, ring: number): CellKind {
  return KINDS[((cell % ring) + ring) % ring] ?? 'normal';
}

/**
 * Décalage horizontal de plusieurs pions sur une même case : ils se placent côte à côte, centrés sur la case.
 * `slot` est le rang du pion sur la case, et `count` le nombre de pions qui s’y trouvent.
 */
export function slotOffset(slot: number, count: number): number {
  return (slot - (count - 1) / 2) * 0.7;
}

/**
 * Échelle d’une case ou d’un pion selon sa place sur l’anneau : plus petit au fond du plateau, plus grand au premier
 * plan. Ça donne la profondeur sans rotation 3D, qui cachait les noms des pions.
 */
export function depthScale(y: number): number {
  const t = Math.min(1, Math.max(0, (y - (50 - RING_RY)) / (2 * RING_RY)));
  return 0.82 + 0.28 * t;
}
