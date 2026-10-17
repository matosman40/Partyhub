import type { CardEntry, CardFamily, CardGameDefinition } from '@partyhub/shared';
import { WILD_FAMILY } from '@partyhub/shared';
import type { RankRow } from '../../client/ui.js';

/** Vue publique d'un jeu de cartes, telle qu'émise par le serveur. */
export interface CardsPublic {
  phase: 'play' | 'pick-family' | 'round-over' | 'final';
  started: boolean;
  def: CardGameDefinition;
  settings: { targetScore: number; turnSeconds: number };
  round: number;
  order: string[];
  names: Record<string, string>;
  scores: Record<string, number>;
  current: string | null;
  picker: string | null;
  family: string;
  direction: 1 | -1;
  drew: boolean;
  counts: Record<string, number>;
  drawCount: number;
  top: { uid: string; entry: string } | null;
  roundWinner: string | null;
  lastEvent: string;
  turnEndsAt: number | null;
  revealed: Record<string, { uid: string; entry: string }[]> | null;
}

export interface CardsPlayerState {
  hand: { uid: string; entry: string }[];
  playable: string[];
  spectator: boolean;
  isMyTurn: boolean;
  canDraw: boolean;
  canPass: boolean;
  mustPick: boolean;
}

export function entryOf(def: CardGameDefinition, id: string): CardEntry | undefined {
  return def.cards.find((c) => c.id === id);
}

export function familyOf(def: CardGameDefinition, id: string): CardFamily | undefined {
  return id === WILD_FAMILY ? undefined : def.families.find((f) => f.id === id);
}

/** Classement décroissant par points, rangs en compétition (ex æquo partagés). */
export function rankingOf(pub: Pick<CardsPublic, 'order' | 'names' | 'scores'>): RankRow[] {
  const rows = pub.order.map((id) => ({
    playerId: id,
    name: pub.names[id] ?? '?',
    points: pub.scores[id] ?? 0,
  }));
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fr'));
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.points > r.points).length }));
}

export function handPoints(def: CardGameDefinition, hand: { entry: string }[]): number {
  return hand.reduce((sum, c) => sum + (entryOf(def, c.entry)?.points ?? 0), 0);
}

/**
 * Main triée par grandeur, pour l'affichage : les cartes à chiffre d'abord, du plus petit au plus grand ;
 * les cartes sans chiffre (actions, jokers) ensuite, par points. À valeur égale : famille, puis ordre du paquet.
 */
export function sortHandByValue<T extends { entry: string }>(def: CardGameDefinition, hand: readonly T[]): T[] {
  const familyIndex = (family: string) => {
    const i = def.families.findIndex((f) => f.id === family);
    return i < 0 ? def.families.length : i;
  };
  const deckOrder = new Map(def.cards.map((c, i) => [c.id, i]));
  const keyed = hand.map((card) => {
    const entry = entryOf(def, card.entry);
    const symbol = entry?.symbol.trim() ?? '';
    const numeric = /^\d+$/.test(symbol);
    return {
      card,
      numeric,
      value: numeric ? Number(symbol) : 0,
      points: entry ? entry.points : Number.MAX_SAFE_INTEGER,
      family: entry ? familyIndex(entry.family) : def.families.length,
      order: deckOrder.get(card.entry) ?? Number.MAX_SAFE_INTEGER,
    };
  });
  keyed.sort((a, b) => {
    if (a.numeric !== b.numeric) return a.numeric ? -1 : 1;
    const first = a.numeric ? a.value - b.value : a.points - b.points;
    return first || a.family - b.family || a.order - b.order;
  });
  return keyed.map((k) => k.card);
}
