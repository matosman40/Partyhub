import type { GameContext, GameResult, PlayerRef, ScoreEntry } from '@partyhub/shared';

/**
 * Outils partagés par les jeux : résultats, mélange, normalisation de texte,
 * classement et attente des joueurs connectés. Aucun de ces outils ne touche
 * au réseau ni à l'horloge réelle : tout passe par le contexte du jeu.
 */

export function ok<S>(state: S): GameResult<S> {
  return { ok: true, state };
}

export function fail<S>(error: string): GameResult<S> {
  return { ok: false, error };
}

/** Annuaire id -> pseudo, à partir de la liste des joueurs. */
export function directory(players: PlayerRef[]): Record<string, string> {
  return Object.fromEntries(players.map((p) => [p.id, p.name]));
}

/** Mélange de Fisher-Yates avec le générateur injecté (tests déterministes). */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Forme comparable d'un texte libre : sans casse, sans accents, sans ponctuation.
 * « Éléphant ! » et « elephant » donnent la même valeur.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Classement en « compétition » : deux ex æquo partagent le même rang. */
export function rankEntries(
  names: Record<string, string>,
  points: Record<string, number>,
): ScoreEntry[] {
  const entries = Object.keys(names).map((id) => ({
    playerId: id,
    name: names[id] ?? '?',
    points: points[id] ?? 0,
  }));
  entries.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'fr'));
  return entries.map((e) => ({
    ...e,
    rank: 1 + entries.filter((o) => o.points > e.points).length,
  }));
}

/** Ajoute des points à un joueur, sans modifier l'objet d'origine. */
export function addPoints(
  points: Record<string, number>,
  id: string,
  delta: number,
): Record<string, number> {
  return { ...points, [id]: (points[id] ?? 0) + delta };
}

/**
 * Vrai quand chaque joueur CONNECTÉ parmi `expected` a terminé son action.
 * Un joueur déconnecté ne bloque jamais la manche : le minuteur prend le relais.
 */
export function everyConnectedDone(
  ctx: GameContext,
  expected: string[],
  done: (id: string) => boolean,
): boolean {
  const waiting = ctx.connectedPlayerIds().filter((id) => expected.includes(id));
  return waiting.length > 0 && waiting.every(done);
}
