import { STATS, STAT_LABELS, type StatKey } from './schemas.js';
import type { Character } from './types.js';

/**
 * Progression des personnages : niveaux, expérience, objets, soins, blessures et liens avec les personnages
 * secondaires. Fonctions pures : elles renvoient le personnage mis à jour et les lignes à afficher.
 */

export const MAX_LEVEL = 5;
/** Expérience totale nécessaire pour atteindre chaque niveau (l'index est le niveau). */
export const LEVEL_XP: readonly number[] = [0, 0, 15, 40, 75, 120];
export const MAX_BAG = 4;
const MAX_PV_MAX = 14;
const MAX_STAT = 6;
const LEVEL_HEAL = 2;
const BOND_MIN = -3;
const BOND_MAX = 3;
const DIFFICULTY_MIN = 6;
const DIFFICULTY_MAX = 18;

export interface Progressed<T> {
  character: T;
  lines: string[];
}

export function levelOf(xp: number): number {
  let level = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) if (xp >= LEVEL_XP[l]!) level = l;
  return level;
}

/** Expérience totale du niveau suivant, ou null au niveau maximum. */
export function nextLevelXp(level: number): number | null {
  return level >= MAX_LEVEL ? null : LEVEL_XP[level + 1]!;
}

/** Stat la plus basse qui peut encore monter (ex æquo : ordre de STATS), ou null. */
function lowestStat(stats: Record<StatKey, number>): StatKey | null {
  const candidates = STATS.filter((k) => stats[k] < MAX_STAT);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, k) => (stats[k] < stats[best] ? k : best));
}

/**
 * Applique les niveaux gagnés depuis le dernier calcul. Chaque niveau : +1 PV max, +2 PV (sans relever un personnage
 * à terre), +1 à la stat la plus basse. Idempotent : sans nouvel XP, il ne change rien.
 */
export function syncLevel(c: Character): Progressed<Character> {
  let character = c;
  const lines: string[] = [];
  const target = levelOf(character.xp);
  while (character.level < target) {
    const level = character.level + 1;
    const stat = lowestStat(character.stats);
    const pvMax = Math.min(MAX_PV_MAX, character.pvMax + 1);
    const pv = character.pv > 0 ? Math.min(pvMax, character.pv + LEVEL_HEAL) : 0;
    character = {
      ...character,
      level,
      pvMax,
      pv,
      stats: stat ? { ...character.stats, [stat]: character.stats[stat] + 1 } : character.stats,
    };
    lines.push(`${character.name} passe au niveau ${level}${stat ? ` : +1 ${STAT_LABELS[stat]}` : ''}, +1 PV max.`);
  }
  return { character, lines };
}

/** Ajoute de l'expérience, puis applique les niveaux gagnés. */
export function gainXp(c: Character, amount: number): Progressed<Character> {
  if (amount <= 0) return { character: c, lines: [] };
  const grown = syncLevel({ ...c, xp: c.xp + amount });
  return { character: grown.character, lines: [`${c.name} gagne ${amount} d’expérience.`, ...grown.lines] };
}

/** Met un objet dans le sac. Le sac est plein : l'objet le plus ancien part. */
export function gainItem(c: Character, item: string): Progressed<Character> {
  const bag = [...c.bag, item].slice(-MAX_BAG);
  return { character: { ...c, bag }, lines: [`${c.name} trouve : ${item}.`] };
}

/** Rend des points de vie, sans relever un personnage à terre. */
export function heal(c: Character, amount: number): Progressed<Character> {
  if (amount <= 0 || c.pv === 0 || c.pv >= c.pvMax) return { character: c, lines: [] };
  const pv = Math.min(c.pvMax, c.pv + amount);
  return { character: { ...c, pv }, lines: [`${c.name} reprend des forces (${pv}/${c.pvMax} PV).`] };
}

/** Perd des points de vie. Une fois à zéro, le personnage est à terre. */
export function loseLife(c: Character, amount: number): Progressed<Character> {
  if (amount <= 0 || c.pv === 0) return { character: c, lines: [] };
  const pv = Math.max(0, c.pv - amount);
  const lines = pv === 0 ? [`${c.name} tombe à terre.`] : [`${c.name} perd ${c.pv - pv} PV (${pv}/${c.pvMax}).`];
  return { character: { ...c, pv }, lines };
}

export function relationOf(bond: number): string {
  if (bond <= -2) return 'hostile';
  if (bond === -1) return 'méfiant';
  if (bond === 0) return 'neutre';
  if (bond <= 2) return 'amical';
  return 'allié';
}

export function shiftBond(bond: number, delta: number): number {
  return Math.min(BOND_MAX, Math.max(BOND_MIN, bond + delta));
}

export function shiftDifficulty(value: number, shift: number): number {
  return Math.min(DIFFICULTY_MAX, Math.max(DIFFICULTY_MIN, value + shift));
}
