import { useEffect, useRef } from 'react';
import type { RoomStatus, SfxName } from '@partyhub/shared';
import { playSfx } from '@partyhub/games/client';

/**
 * Bruitages de l'écran principal, sans rien demander aux jeux : le lancement de la partie, chaque bilan,
 * et la fin. Les jeux annoncent leur étape dans leur état public (`phase`) : un changement d'étape
 * fait un clic, un bilan (manche, pli, niveau révélé) un bruit de jetons, la fin une fanfare.
 *
 * Le premier état reçu ne joue rien : une reprise d'écran (rechargement en pleine partie) ne doit pas
 * faire de bruit. Deux bruitages ne se suivent pas de moins d'une demi-seconde, et un même bruitage
 * (la fin de partie arrive parfois en deux messages) ne se répète pas avant trois secondes.
 */

/** Étapes qui révèlent un bilan : la manche, le pli, le niveau ou la donne sont terminés. */
const REVEAL_PHASES: ReadonlySet<string> = new Set(['reveal', 'round-over', 'level-over', 'trick-over', 'hand-over']);
/** Étape de fin de partie, dans les jeux qui la nomment ainsi. */
const FINAL_PHASE = 'final';

const MIN_GAP_MS = 500;
const SAME_GAP_MS = 3000;

export interface CueState {
  status: RoomStatus | null;
  phase: string | null;
}

/** Étape annoncée par l'état public d'un jeu, ou null quand le jeu n'en annonce pas. */
export function phaseOf(publicState: unknown): string | null {
  if (!publicState || typeof publicState !== 'object') return null;
  const phase = (publicState as { phase?: unknown }).phase;
  return typeof phase === 'string' ? phase : null;
}

/** Bruitage à jouer pour passer de `prev` à `next`, ou null. Fonction pure, sans navigateur. */
export function cueFor(prev: CueState | null, next: CueState): SfxName | null {
  if (!prev) return null;
  if (next.status === 'ended' && prev.status !== 'ended') return 'final';
  if (next.status === 'in_game' && prev.status !== 'in_game') return 'start';
  if (next.status !== 'in_game' || next.phase === null || prev.phase === next.phase) return null;
  if (next.phase === FINAL_PHASE) return 'final';
  if (REVEAL_PHASES.has(next.phase)) return 'chip';
  return 'click';
}

export interface LastCue {
  name: SfxName;
  at: number;
}

/** Vrai quand le bruitage peut sonner maintenant, compte tenu du dernier joué. Fonction pure. */
export function allowCue(last: LastCue | null, name: SfxName, now: number): boolean {
  if (!last) return true;
  const gap = now - last.at;
  if (gap < MIN_GAP_MS) return false;
  return !(last.name === name && gap < SAME_GAP_MS);
}

/** Joue le bruitage qui correspond au changement de statut ou d'étape de la salle. */
export function useGameCues(status: RoomStatus | null, phase: string | null): void {
  const prev = useRef<CueState | null>(null);
  const last = useRef<LastCue | null>(null);

  useEffect(() => {
    const next: CueState = { status, phase };
    const cue = cueFor(prev.current, next);
    prev.current = next;
    if (!cue) return;
    const now = performance.now();
    if (!allowCue(last.current, cue, now)) return;
    last.current = { name: cue, at: now };
    playSfx(cue);
  }, [status, phase]);
}
