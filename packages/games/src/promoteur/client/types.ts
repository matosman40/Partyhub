import type { RankRow } from '../../client/ui.js';
import type { Group } from '../board.js';

/** Vue publique du Promoteur, telle que l’envoie le serveur. */
export interface PlayerPub {
  id: string;
  name: string;
  cash: number;
  pos: number;
  jailed: boolean;
  bankrupt: boolean;
  worth: number;
}

export interface TilePub {
  index: number;
  kind: string;
  name: string;
  group?: Group;
  price?: number;
  owner: string | null;
  houses: number;
}

export interface PromoteurPub {
  phase: 'ready' | 'roll' | 'decide' | 'final';
  round: number;
  rounds: number;
  current: string | null;
  currentName: string | null;
  players: PlayerPub[];
  board: TilePub[];
  dice: [number, number] | null;
  pending: { index: number; name: string; price: number } | null;
  lastEvent: string;
  endsAt: number;
  durationMs: number;
  ranking: RankRow[];
}
