/** Versions X.Y.Z strictes, sans préfixe ni suffixe. */
const VERSION = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;

export function isValidVersion(value: string): boolean {
  return VERSION.test(value);
}

/** Compare deux versions X.Y.Z. Retourne un nombre négatif, nul ou positif. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
