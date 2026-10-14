import type { RankRow } from '../../client/ui.js';
import type { MusicMood } from '../../client/audio.js';

/** Vue publique du poker, telle qu'émise par le serveur (jamais les cartes privées avant l'abattage). */
export interface PokerPub {
  phase: 'play' | 'hand-over' | 'final';
  started: boolean;
  settings: {
    startingChips: number;
    smallBlind: number;
    bigBlind: number;
    turnSeconds: number;
    hands: number;
    seats: number;
    theme: 'arcade' | 'coco' | 'nuit' | 'classique';
    ambiance: 'casino' | 'nuit' | 'bar' | 'tournoi';
  };
  order: string[];
  spectators: string[];
  names: Record<string, string>;
  stacks: Record<string, number>;
  dealer: string | null;
  handNumber: number;
  street: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  board: string[];
  bets: Record<string, number>;
  pot: number;
  folded: string[];
  allIn: string[];
  inHand: string[];
  current: string | null;
  currentBet: number;
  minRaiseTo: number;
  winners: { id: string; name: string; amount: number; hand: string | null }[];
  revealed: Record<string, string[]>;
  lastEvent: string;
  turnEndsAt: number | null;
}

/** Vue privée d'un joueur : ses deux cartes et les mises qu'il peut faire. */
export interface PokerMe {
  hole: { uid: string; entry: string }[];
  stack: number;
  bet: number;
  folded: boolean;
  seated: boolean;
  spectator: boolean;
  isMyTurn: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  canAllIn: boolean;
  canSit: boolean;
}

export const STREET_LABEL: Record<PokerPub['street'], string> = {
  preflop: 'Avant le flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Abattage',
};

/** Nombre lisible à la française : 12 500. */
export function fmt(n: number): string {
  return n.toLocaleString('fr-FR');
}

/** Classement par jetons, rangs partagés en cas d'égalité. */
export function chipsRanking(pub: PokerPub): RankRow[] {
  const rows = pub.order.map((id) => ({ playerId: id, name: pub.names[id] ?? '?', points: pub.stacks[id] ?? 0 }));
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fr'));
  return rows.map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.points > r.points).length }));
}

/** Musique de fond par ambiance : tempo (BPM) et timbre de la basse. */
export const AMBIANCE_MUSIC: Record<PokerPub['settings']['ambiance'], MusicMood> = {
  casino: { bpm: 128, bass: 'triangle' },
  nuit: { bpm: 96, bass: 'sine' },
  bar: { bpm: 110, bass: 'triangle' },
  tournoi: { bpm: 150, bass: 'triangle' },
};
