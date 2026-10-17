import type { CardGameDefinition } from '@partyhub/shared';

/** Carte posée sur la table : qui l’a jouée, et son identifiant de carte (visible par tous). */
export interface TrickPlayPublic {
  pid: string;
  entry: string;
}

/** État public du pli, tel que produit par getPublicState (voir cards/trick.ts). */
export interface TrickPublic {
  kind: 'trick';
  phase: 'play' | 'trick-over' | 'round-over' | 'final';
  started: boolean;
  def: CardGameDefinition;
  settings: { targetScore: number; turnSeconds: number };
  order: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  round: number;
  tricksWon: Record<string, number>;
  current: string | null;
  table: TrickPlayPublic[];
  ledFamily: string | null;
  trump: string | null;
  counts: Record<string, number>;
  lastTrick: { winner: string; points: number; cards: TrickPlayPublic[] } | null;
  roundWinner: string | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

/** Vue d’un joueur : sa main et les cartes qu’il peut jouer maintenant. */
export interface TrickPlayerState {
  spectator: boolean;
  hand: { uid: string; entry: string }[];
  isMyTurn: boolean;
  playable: string[];
}

/** Nom affiché d’une famille, ou null. */
export function familyName(def: CardGameDefinition, id: string | null): string | null {
  if (!id) return null;
  return def.families.find((f) => f.id === id)?.label ?? id;
}
