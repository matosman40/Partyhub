import type { ProgressPoint } from '../engine.js';

export type { ProgressPoint };

/** Teinte d’un joueur : sa place dans la salle, sur les huit teintes de la palette (cyclique). */
export function seriesColor(index: number): string {
  return `var(--solo-s${(Math.max(0, index) % 8) + 1})`;
}

/** Avancement d’une courbe à un instant : le dernier palier atteint avant cet instant. */
export function valueAt(trail: ProgressPoint[], ms: number): number {
  let value = 0;
  for (const point of trail) {
    if (point.ms > ms) break;
    value = point.percent;
  }
  return value;
}

/** Instant (ms) où la courbe atteint un seuil, ou null si elle ne l’atteint pas. */
export function timeAtPercent(trail: ProgressPoint[], percent: number): number | null {
  const hit = trail.find((point) => point.percent >= percent);
  return hit ? hit.ms : null;
}

const STEPS_S = [15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/**
 * Échelle de temps de la courbe : au moins une minute, six graduations au plus, et une fin sur une
 * graduation. Le pas est le plus petit qui tient dans six graduations.
 */
export function axisScale(rawMs: number): { maxMs: number; stepMs: number } {
  const rawS = Math.max(60, rawMs / 1000);
  const stepS = STEPS_S.find((step) => rawS / step <= 6) ?? 3600;
  return { maxMs: Math.ceil(rawS / stepS) * stepS * 1000, stepMs: stepS * 1000 };
}

/** Temps d’une courbe ou d’un tableau : 02:05 (sans les millisecondes). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Temps d’une grille résolue : 2 min 05 s 310 ms → « 02:05.310 ». */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
