import type { RankRow } from '../../client/ui.js';
import type { GagId, GagInput } from '../gags.js';

/** Gag tel que la vue publique le décrit (sans la réponse attendue). */
export interface GagView {
  id: GagId;
  name: string;
  icon: string;
  instruction: string;
  hint: string;
  flavor: string;
  quips: { win: string; lose: string };
  durationMs: number;
  input: GagInput;
  /** Graine du gag : la mouche s’en sert pour bouger de la même façon sur tous les écrans. */
  seed: number;
}

export interface GagsPub {
  phase: 'ready' | 'intro' | 'play' | 'reveal' | 'final';
  round: number;
  rounds: number;
  microgame: GagView | null;
  introEndsAt: number;
  startedAt: number;
  endsAt: number;
  revealEndsAt: number;
  players: { id: string; name: string }[];
  submitted: string[];
  results: { playerId: string; name: string; success: boolean; points: number }[] | null;
  ranking: RankRow[];
}

export interface GagsMine {
  submitted: boolean;
  mine: { success: boolean; points: number } | null;
  points: number;
}
