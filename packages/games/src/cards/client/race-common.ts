import type { CardGameDefinition } from '@partyhub/shared';

/** État public de la ressemblance, tel que produit par getPublicState (voir cards/race.ts). */
export interface RacePublic {
  kind: 'race';
  phase: 'play' | 'round-over' | 'final';
  started: boolean;
  def: CardGameDefinition;
  settings: { targetScore: number; turnSeconds: number };
  order: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  round: number;
  roundWinner: string | null;
  /** Carte posée au centre : son identifiant est public, ses cartes en main ne le sont jamais. */
  center: { uid: string; entry: string } | null;
  counts: Record<string, number>;
  pileCount: number;
  /** Joueur → instant serveur (ms) jusqu’auquel ses touches sont bloquées. */
  locked: Record<string, number>;
  lastEvent: string;
  turnEndsAt: number | null;
}

/** Vue d’un joueur : sa main et son verrou éventuel. */
export interface RacePlayerState {
  spectator: boolean;
  hand: { uid: string; entry: string }[];
  lockedUntil: number;
  canTap: boolean;
}
