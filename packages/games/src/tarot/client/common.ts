import type { RankRow } from '../../client/ui.js';
import { EXCUSE, isTrump, type Contract, type Side } from '../rules.js';
import type { TarotSummary } from '../module.js';

/** Vue publique du tarot, telle qu’émise par le serveur (jamais une main, ni le chien tant qu’il est caché). */
export interface TarotPub {
  phase: 'bidding' | 'ecart' | 'play' | 'round-over' | 'final';
  started: boolean;
  settings: { rounds: number; turnSeconds: number };
  round: number;
  rounds: number;
  order: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  dealer: string | null;
  dealCount: number;
  bids: { playerId: string; contract: Contract | null }[];
  highest: Contract | null;
  current: string | null;
  taker: string | null;
  contract: Contract | null;
  /** Le chien, seulement quand il est visible de tous (écart en Petite ou Garde, fin de donne). */
  chien: string[] | null;
  ecartAtouts: string[];
  trick: { playerId: string; cardId: string }[];
  leader: string | null;
  lastTrick: { cards: { playerId: string; cardId: string }[]; winner: string } | null;
  trickCount: number;
  tricks: Record<Side, number>;
  counts: Record<string, number>;
  summary: TarotSummary | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

/** Vue privée d’un joueur : sa main triée, les cartes jouables et ce qu’il peut faire maintenant. */
export interface TarotMe {
  hand: { uid: string; entry: string }[];
  playable: string[];
  isMyTurn: boolean;
  bidOptions: Contract[];
  canPass: boolean;
  mustEcart: boolean;
  side: Side | null;
  spectator: boolean;
}

/** Places autour de la table, dans l’ordre de jeu (sens inverse des aiguilles d’une montre, comme au tarot). */
export type SeatPos = 'bottom' | 'right' | 'top' | 'left';
export const SEAT_POS: readonly SeatPos[] = ['bottom', 'right', 'top', 'left'];

export function seatPos(pub: TarotPub, id: string): SeatPos {
  return SEAT_POS[Math.max(0, pub.order.indexOf(id)) % SEAT_POS.length]!;
}

/** Classement par points, rangs partagés en cas d’égalité. */
export function tarotRanking(pub: TarotPub): RankRow[] {
  const rows = pub.order.map((id) => ({ playerId: id, name: pub.names[id] ?? '?', points: pub.scores[id] ?? 0 }));
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fr'));
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.points > r.points).length }));
}

/** Nombre signé avec un vrai signe moins : « +72 », « −36 », « 0 ». */
export function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
}

/** Demi-points signés : « +4,5 », « −0,5 ». */
export function signedHalf(half: number): string {
  const abs = Math.abs(half);
  return `${half > 0 ? '+' : half < 0 ? '−' : ''}${Math.floor(abs / 2)}${abs % 2 === 1 ? ',5' : ''}`;
}

/** Au plus ce nombre de cartes par rangée sur le téléphone : au-delà, la rangée est coupée en deux. */
const MAX_PER_ROW = 11;

/**
 * Rangées de la main : les atouts (avec l’Excuse) d’un côté, les couleurs de l’autre, chacune coupée
 * en parts égales si elle est trop longue. Une main de 18 à 24 cartes reste ainsi lisible sur 360 px.
 */
export function handRows(ids: readonly string[]): string[][] {
  const rows: string[][] = [];
  const groups = [ids.filter((id) => isTrump(id) || id === EXCUSE), ids.filter((id) => !isTrump(id) && id !== EXCUSE)];
  for (const group of groups) {
    if (group.length === 0) continue;
    const size = Math.ceil(group.length / Math.ceil(group.length / MAX_PER_ROW));
    for (let i = 0; i < group.length; i += size) rows.push(group.slice(i, i + size));
  }
  return rows;
}
