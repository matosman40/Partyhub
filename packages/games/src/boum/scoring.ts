/**
 * Barèmes de BOUM ! (spécification, section 3). Fonctions pures, sans état.
 */

/** Points par vote reçu, pour les modes de vote qui écrivent (comme Sous-titres). */
export const VOTE_POINTS = 100;
/** Le plus probable : points par vote reçu. */
export const PROBABLE_POINTS = 50;
/** Réponse rapide : ordre d'arrivée des bonnes réponses. Les suivantes ne rapportent rien. */
export const QUICK_LADDER = [100, 70, 50, 30] as const;
/** Combien ? : points pour le plus proche, le second et le troisième. */
export const CLOSEST_LADDER = [100, 50, 25] as const;

/**
 * Réponse rapide : `orderOfCorrect` liste les joueurs qui ont trouvé, dans l'ordre d'arrivée.
 * Renvoie les points de chacun.
 */
export function quickPoints(orderOfCorrect: readonly string[]): Record<string, number> {
  const points: Record<string, number> = {};
  orderOfCorrect.forEach((id, index) => {
    points[id] = QUICK_LADDER[index] ?? 0;
  });
  return points;
}

/** Mime le métier : le mimeur gagne ce montant par joueur qui trouve (même barème que Devine la chanson). */
export const MIME_POINTS_PER_FINDER = 50;

/**
 * Combien ? : le plus proche de la réponse gagne 100, le second 50, le troisième 25.
 * Les égalités partagent les places occupées, et chacun reçoit le plus haut score de ces places.
 */
export function closestPoints(
  guesses: readonly { id: string; value: number }[],
  answer: number,
): Record<string, number> {
  const points: Record<string, number> = {};
  const sorted = guesses
    .map((g) => ({ id: g.id, distance: Math.abs(g.value - answer) }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));

  let start = 0;
  while (start < sorted.length) {
    const distance = sorted[start]!.distance;
    let end = start;
    while (end < sorted.length && sorted[end]!.distance === distance) end++;
    let best = 0;
    for (let place = start; place < end; place++) best = Math.max(best, CLOSEST_LADDER[place] ?? 0);
    for (let i = start; i < end; i++) points[sorted[i]!.id] = best;
    start = end;
  }
  return points;
}

/** Vote reçu sur un texte écrit : points à son auteur. */
export function voteReceivedPoints(votes: number, pointsPerVote = VOTE_POINTS): number {
  return votes * pointsPerVote;
}

/**
 * Détecteur de mauvaise foi : moyenne des notes (1 à 5 étoiles) × 20, arrondie.
 * Sans note, 0 point. Le plaideur ne se note jamais.
 */
export function detectorPoints(ratings: readonly number[]): number {
  const valid = ratings.filter((r) => Number.isInteger(r) && r >= 1 && r <= 5);
  if (valid.length === 0) return 0;
  const average = valid.reduce((sum, r) => sum + r, 0) / valid.length;
  return Math.round(average * 20);
}

export interface Standing {
  id: string;
  name: string;
  points: number;
  /** Nombre de 5 étoiles reçues pendant la partie : départage du Détecteur. */
  fiveStars: number;
}

/**
 * Classement : points décroissants. À égalité de points, le joueur qui a reçu le plus de 5 étoiles
 * passe devant, puis le nom (ordre français) pour un résultat stable.
 */
export function rankStandings(standings: readonly Standing[]): (Standing & { rank: number })[] {
  const sorted = [...standings].sort(
    (a, b) => b.points - a.points || b.fiveStars - a.fiveStars || a.name.localeCompare(b.name, 'fr'),
  );
  const ranked: (Standing & { rank: number })[] = [];
  sorted.forEach((entry, index) => {
    const previous = ranked[index - 1];
    const tied = previous && previous.points === entry.points && previous.fiveStars === entry.fiveStars;
    ranked.push({ ...entry, rank: tied ? previous.rank : index + 1 });
  });
  return ranked;
}
