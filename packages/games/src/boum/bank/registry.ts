import type { BankType, Level } from './types.js';

/**
 * Instantané des entrées validées, lu par le moteur à la création de chaque salle. Le serveur le
 * remplace à chaque modification de la banque : une salle déjà ouverte garde le contenu qu’elle a lu.
 */

export interface BankSnapshotEntry {
  id: string;
  type: BankType;
  level: Level;
  text: string;
  answer: string | null;
}

export interface BankSnapshot {
  entries: readonly BankSnapshotEntry[];
}

let current: BankSnapshot = { entries: [] };

export function setBoumBank(snapshot: BankSnapshot): void {
  current = snapshot;
}

export function currentBoumBank(): BankSnapshot {
  return current;
}
