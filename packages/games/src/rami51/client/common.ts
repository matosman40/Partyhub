import type { RankRow } from '../../client/ui.js';
import type { CardEntry } from '@partyhub/shared';
import { RAMI_DEFINITION, type Meld, type RamiCard } from '../rules.js';
import type { RamiRoundResult } from '../module.js';

/** Vue publique du Rami 51, telle qu'émise par le serveur (jamais une main avant la fin de la manche). */
export interface RamiPub {
  phase: 'play' | 'round-over' | 'final';
  started: boolean;
  settings: { targetScore: number; openingPoints: number; turnSeconds: number };
  round: number;
  order: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  dealer: string | null;
  current: string | null;
  drawn: 'deck' | 'discard' | null;
  counts: Record<string, number>;
  opened: Record<string, boolean>;
  melds: Meld[];
  discardTop: { uid: string; entry: string } | null;
  discardCount: number;
  drawCount: number;
  roundWinner: string | null;
  ramiSec: boolean;
  result: RamiRoundResult | null;
  lastEvent: string;
  turnEndsAt: number | null;
}

/** Vue privée d'un joueur : sa main et ce qu'il peut faire maintenant. */
export interface RamiMe {
  hand: RamiCard[];
  spectator: boolean;
  isMyTurn: boolean;
  hasDrawn: boolean;
  drewFrom: 'deck' | 'discard' | null;
  canTakeDiscard: boolean;
  canUndo: boolean;
  opened: boolean;
  mustUse: string[];
  openingPoints: number;
}

const ENTRIES = new Map<string, CardEntry>(RAMI_DEFINITION.cards.map((c) => [c.id, c]));

export function ramiEntry(id: string): CardEntry | undefined {
  return ENTRIES.get(id);
}

/** Classement croissant : le plus petit total est premier, rangs partagés en cas d'égalité. */
export function ramiRanking(pub: RamiPub): RankRow[] {
  const rows = pub.order.map((id) => ({ playerId: id, name: pub.names[id] ?? '?', points: pub.scores[id] ?? 0 }));
  rows.sort((a, b) => a.points - b.points || a.name.localeCompare(b.name, 'fr'));
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.points < r.points).length }));
}
