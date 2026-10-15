import { BASE_MODE_IDS, MODES, MODE_BY_ID, type Family, type ModeDef, type ModeId } from './modes.js';
import type { BankType, Level } from './bank/types.js';

/**
 * Tirage des manches de BOUM ! : éligibilité (salle, pack, banques), absence de répétition tant
 * que le pool n'est pas épuisé, et variété des familles. Pur : le hasard est injecté.
 */

export interface RoomRules {
  players: number;
  /** Pack Humour noir activé pour la salle. */
  pack: boolean;
  /** Niveau corsé autorisé (en plus du doux). */
  corse: boolean;
}

/** Niveaux d'entrées utilisables dans une salle. `limite` n'existe que avec le pack. */
export function allowedLevels(rules: RoomRules): Level[] {
  const levels: Level[] = ['doux'];
  if (rules.corse) levels.push('corse');
  if (rules.pack) levels.push('limite');
  return levels;
}

/** Nombre d'entrées validées d'un type, aux niveaux donnés. */
export type CountValid = (type: BankType, levels: readonly Level[]) => number;

/** Modes tirables dans cette salle, avec leur banque suffisante. */
export function eligibleModes(rules: RoomRules, countValid: CountValid): ModeDef[] {
  const levels = allowedLevels(rules);
  return MODES.filter((mode) => {
    if (mode.pack && !rules.pack) return false;
    if (rules.players < mode.minPlayers) return false;
    return mode.needs.every((need) => countValid(need.type, levels) >= need.minValid);
  });
}

/** Familles représentées parmi les modes tirables. */
export function familiesOf(modes: readonly ModeDef[]): Set<Family> {
  return new Set(modes.map((m) => m.family));
}

/**
 * Tire les modes d'une partie. Règles, dans l'ordre de priorité :
 * 1. pas de répétition tant que le pool éligible n'est pas épuisé (il se recharge ensuite) ;
 * 2. pas deux modes de la même famille de suite ;
 * 3. préférer une famille pas encore jouée.
 * Quand le pool ne contient pas assez de familles (phase 1 : texte et cartes seulement), les règles 2
 * et 3 sont relâchées : la partie continue, sans bloquer le tirage.
 */
export function drawModes(eligible: readonly ModeDef[], rounds: number, random: () => number): ModeId[] {
  if (eligible.length === 0 || rounds <= 0) return [];
  const families = familiesOf(eligible);
  const drawn: ModeId[] = [];
  const usedFamilies = new Set<Family>();
  let remaining: ModeDef[] = [];

  for (let round = 0; round < rounds; round++) {
    if (remaining.length === 0) remaining = shuffle(eligible, random);
    const previous = drawn.length > 0 ? MODE_BY_ID[drawn[drawn.length - 1]!] : undefined;

    let pool = remaining;
    if (previous && families.size > 1) {
      const differentFamily = pool.filter((m) => m.family !== previous.family);
      if (differentFamily.length > 0) pool = differentFamily;
    }
    const newFamily = pool.filter((m) => !usedFamilies.has(m.family));
    if (newFamily.length > 0 && families.size > usedFamilies.size) pool = newFamily;

    const pick = pool[Math.floor(random() * pool.length)]!;
    remaining = remaining.filter((m) => m.id !== pick.id);
    drawn.push(pick.id);
    usedFamilies.add(pick.family);
  }
  return drawn;
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Modes de base, pour les tests et la documentation. */
export const BASE_MODES: readonly ModeId[] = BASE_MODE_IDS;
