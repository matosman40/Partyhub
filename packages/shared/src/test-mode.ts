import { z } from 'zod';

/**
 * Mode test : un curseur de cadence règle combien d'émotions et de voix un joueur peut envoyer dans le même
 * laps de temps. Hors mode test, la cadence normale s'applique. Réservé à l'administration.
 */
export const TEST_MODE_FACTORS = [1, 2, 4, 10] as const;
export type TestModeFactor = (typeof TEST_MODE_FACTORS)[number];

export const testModeSchema = z
  .object({
    enabled: z.boolean(),
    factor: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(10)]),
  })
  .strict();

export type TestMode = z.infer<typeof testModeSchema>;

export const DEFAULT_TEST_MODE: TestMode = { enabled: false, factor: 1 };

/** Cadence réellement appliquée : 1 (réglage normal) tant que le mode test est éteint. */
export function appliedCadence(mode: TestMode): number {
  return mode.enabled ? mode.factor : 1;
}

/** Libellé du curseur : « Normal », puis « ×2 », « ×4 », « ×10 ». */
export function testModeLabel(factor: TestModeFactor): string {
  return factor === 1 ? 'Normal' : `×${factor}`;
}
