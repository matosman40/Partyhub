import type { z } from 'zod';
import type { EpilogueDraft, NpcDraft, WorldDraft, sceneDraftSchema } from './schemas.js';

/**
 * Forme d’une intrigue de secours écrite à la main. Une scène est donnée avant normalisation : `kind`, `heal`,
 * `risk` et `bond` peuvent être omis, le schéma les complète (voir `fallbackScene`).
 */
export type SceneSeed = z.input<typeof sceneDraftSchema>;

export interface FallbackArc {
  world: WorldDraft;
  npcs: NpcDraft[];
  /** Six scènes dans l’ordre de l’intrigue. Une partie courte en joue un sous-ensemble. */
  scenes: SceneSeed[];
  victory: EpilogueDraft;
  defeat: EpilogueDraft;
}
