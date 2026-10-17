import { z } from 'zod';

/**
 * Réglages des fournisseurs d’IA saisis dans l’administration. Stockés dans la base (clé « ai_settings ») :
 * la clé d’API est chiffrée (voir secrets.ts), elle n’est jamais renvoyée au navigateur.
 */

export const AI_SETTINGS_KEY = 'ai_settings';

const providerSettingsSchema = z.object({
  keySealed: z.string().max(1000).optional(),
  model: z.string().max(120).optional(),
  baseUrl: z.string().max(300).optional(),
  enabled: z.boolean().optional(),
  maxCallsPerDay: z.number().int().min(1).max(1000000).optional(),
});

export type StoredProviderSettings = z.infer<typeof providerSettingsSchema>;
export type StoredAiSettings = Record<string, StoredProviderSettings>;

const storedSchema = z.record(z.string().max(32), providerSettingsSchema);

/** Lit les réglages stockés. Une valeur abîmée est ignorée : la configuration de l’environnement reste valable. */
export function readStoredAi(raw: string | undefined): StoredAiSettings {
  if (!raw) return {};
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Mise à jour partielle : une valeur `null` retire le réglage, une absente le laisse tel quel. */
export const aiProviderUpdateSchema = z.object({
  apiKey: z.string().max(300).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  baseUrl: z.string().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
  maxCallsPerDay: z.number().int().min(1).max(1000000).nullable().optional(),
});

export type AiProviderUpdate = z.infer<typeof aiProviderUpdateSchema>;
