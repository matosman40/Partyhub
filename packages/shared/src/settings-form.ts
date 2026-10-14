import { z } from 'zod';

/** Bornes d'un réglage numérique, telles que le serveur les valide. */
export interface SettingBounds {
  min: number;
  max: number;
}

/** Bornes des réglages numériques d'un jeu, par nom de réglage. */
export type SettingsBounds = Record<string, SettingBounds>;

type Def = { typeName?: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny; shape?: () => Record<string, z.ZodTypeAny>; checks?: { kind: string; value?: number }[] };

/** Retire les enveloppes (valeur par défaut, optionnel, transformation) pour atteindre le type réel. */
function unwrap(field: z.ZodTypeAny): z.ZodTypeAny {
  let current = field;
  for (;;) {
    const def = current._def as Def;
    if ((def.typeName === 'ZodDefault' || def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable') && def.innerType) {
      current = def.innerType;
    } else if (def.typeName === 'ZodEffects' && def.schema) {
      current = def.schema;
    } else {
      return current;
    }
  }
}

/**
 * Bornes des réglages numériques d'un schéma d'objet. Le formulaire les affiche telles quelles :
 * une valeur valide n'est jamais ramenée d'office à une borne différente.
 */
export function settingsBounds(schema: z.ZodTypeAny): SettingsBounds {
  const def = schema._def as Def;
  if (def.typeName !== 'ZodObject' || !def.shape) return {};
  const bounds: SettingsBounds = {};
  for (const [key, field] of Object.entries(def.shape())) {
    const inner = unwrap(field);
    const innerDef = inner._def as Def;
    if (innerDef.typeName !== 'ZodNumber') continue;
    let min = -Infinity;
    let max = Infinity;
    for (const check of innerDef.checks ?? []) {
      if (check.kind === 'min' && check.value !== undefined) min = Math.max(min, check.value);
      if (check.kind === 'max' && check.value !== undefined) max = Math.min(max, check.value);
    }
    if (Number.isFinite(min) && Number.isFinite(max)) bounds[key] = { min, max };
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
  if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_union') return `${label}choix non reconnu.`;
  return key ? `${label}valeur invalide.` : 'Réglages invalides.';
}
