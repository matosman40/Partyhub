/**
 * Générateur pseudo-aléatoire à graine (mulberry32). Une même graine donne toujours la
 * même suite : tous les joueurs d'une salle reçoivent donc la même grille, et les tests
 * sont reproductibles.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mélange de Fisher-Yates à partir d'un générateur (nouveau tableau). */
export function shuffleWith<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Graine entière tirée depuis le générateur du jeu. */
export function seedFrom(random: () => number): number {
  return Math.floor(random() * 2_147_483_647) + 1;
}
