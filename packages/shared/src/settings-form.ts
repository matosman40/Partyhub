import { z } from 'zod';

/** Bornes d’un réglage numérique, telles que le serveur les valide. */
export interface SettingBounds {
  min: number;
  max: number;
}

/** Bornes des réglages numériques d’un jeu, par nom de réglage. */
export type SettingsBounds = Record<string, SettingBounds>;

/** Retire les enveloppes (valeur par défaut, optionnel, nul) pour atteindre le type réel. */
function unwrap(field: z.ZodTypeAny): z.ZodTypeAny {
  let current = field;
  for (;;) {
    if (current instanceof z.ZodDefault) current = current.removeDefault() as z.ZodTypeAny;
    else if (current instanceof z.ZodOptional || current instanceof z.ZodNullable)
      current = current.unwrap() as z.ZodTypeAny;
    else return current;
  }
}

function isRealBound(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER;
}

/**
 * Bornes des réglages numériques d’un schéma d’objet. Le formulaire les affiche telles quelles :
 * une valeur valide n’est jamais ramenée d’office à une borne différente.
 */
export function settingsBounds(schema: z.ZodTypeAny): SettingsBounds {
  if (!(schema instanceof z.ZodObject)) return {};
  const bounds: SettingsBounds = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    const inner = unwrap(field);
    if (!(inner instanceof z.ZodNumber)) continue;
    const min = inner.minValue;
    const max = inner.maxValue;
    // zod 4 signale une borne absente par une valeur sentinelle : seule une borne réelle compte.
    if (isRealBound(min) && isRealBound(max)) bounds[key] = { min, max };
  }
  return bounds;
}

/** Message en français pour la première erreur de réglage, avec le nom du réglage concerné. */
export function settingsIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Réglages invalides.';
  const key = issue.path.length > 0 ? String(issue.path[0]) : '';
  const label = key ? `Réglage « ${key} » : ` : '';
  if (issue.code === 'too_small') return `${label}au moins ${String(issue.minimum)} attendu.`;
  if (issue.code === 'too_big') return `${label}au plus ${String(issue.maximum)} attendu.`;
  if (issue.code === 'invalid_type') return `${label}valeur de type incorrect.`;
  if (issue.code === 'invalid_value' || issue.code === 'invalid_union') return `${label}choix non reconnu.`;
  return key ? `${label}valeur invalide.` : 'Réglages invalides.';
}
