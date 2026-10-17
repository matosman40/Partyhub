/** Borne une valeur saisie dans un champ numérique : un champ vide ou invalide revient au minimum. */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
