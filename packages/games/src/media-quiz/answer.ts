/**
 * Comparaison des réponses tapées par les joueurs. Insensible à la casse, aux accents,
 * à la ponctuation et aux articles en tête (« Le Parrain » = « parrain »), et tolérante
 * aux petites fautes de frappe sur les titres assez longs.
 */

const LEADING_ARTICLES = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'the', 'a', 'an']);

export function normalizeAnswer(text: string): string {
  const folded = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const words = folded.split(' ').filter(Boolean);
  while (words.length > 1 && LEADING_ARTICLES.has(words[0]!)) words.shift();
  return words.join(' ');
}

/** Distance de Levenshtein (nombre de modifications pour passer de a à b). */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** Nombre de fautes tolérées selon la longueur de la réponse attendue. */
export function allowedTypos(length: number): number {
  if (length >= 12) return 2;
  if (length >= 6) return 1;
  return 0;
}

/** Vrai si la saisie correspond à une formulation donnée. */
export function matchesCandidate(input: string, candidate: string): boolean {
  const typed = normalizeAnswer(input);
  const expected = normalizeAnswer(candidate);
  if (!typed || !expected) return false;
  if (typed === expected) return true;
  // « Star Wars » et « StarWars » : on ignore les espaces pour la comparaison souple.
  const typedCompact = typed.replace(/ /g, '');
  const expectedCompact = expected.replace(/ /g, '');
  if (typedCompact === expectedCompact) return true;
  const tolerance = allowedTypos(expectedCompact.length);
  return tolerance > 0 && editDistance(typedCompact, expectedCompact) <= tolerance;
}

/** Vrai si la saisie correspond à la réponse ou à l'une de ses formulations acceptées. */
export function matchAnswer(input: string, item: { answer: string; aliases: string[] }): boolean {
  return [item.answer, ...item.aliases].some((candidate) => matchesCandidate(input, candidate));
}
