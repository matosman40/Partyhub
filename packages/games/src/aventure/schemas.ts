import { z } from 'zod';

/**
 * Formes attendues de l'IA (ou de l'histoire de secours) et réglages de l'aventure.
 * Tout ce qui vient d'un modèle de langage passe par ces schémas avant d'entrer dans l'état du jeu.
 */

export const STATS = ['force', 'ruse', 'esprit', 'charme'] as const;
export type StatKey = (typeof STATS)[number];

export const STAT_LABELS: Record<StatKey, string> = {
  force: 'Force',
  ruse: 'Ruse',
  esprit: 'Esprit',
  charme: 'Charme',
};

export const TONES = ['aventure', 'humour', 'mystere', 'fantastique'] as const;
export type Tone = (typeof TONES)[number];

export const TONE_LABELS: Record<Tone, string> = {
  aventure: 'Aventure épique',
  humour: 'Humour et décalage',
  mystere: 'Mystère et intrigue',
  fantastique: 'Féerique et fantastique',
};

export const aventureSettingsSchema = z.object({
  scenes: z.number().int().min(3).max(10).default(6),
  theme: z.string().trim().max(120).default(''),
  tone: z.enum(TONES).default('aventure'),
  voteSeconds: z.number().int().min(15).max(180).default(45),
});

export type AventureSettings = z.infer<typeof aventureSettingsSchema>;

const statValue = z.number().int().min(1).max(6);

export const characterDraftSchema = z.object({
  name: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8),
  backstory: z.string().trim().min(1).max(240),
  stats: z.object({ force: statValue, ruse: statValue, esprit: statValue, charme: statValue }),
  pvMax: z.number().int().min(6).max(12),
  ability: z.object({
    name: z.string().trim().min(1).max(40),
    text: z.string().trim().min(1).max(160),
  }),
  flaw: z.string().trim().min(1).max(100),
  item: z.string().trim().min(1).max(60),
});

export const worldSchema = z.object({
  title: z.string().trim().min(1).max(60),
  intro: z.string().trim().min(1).max(700),
});

export const rosterDraftSchema = z.object({
  world: worldSchema,
  characters: z.array(characterDraftSchema).min(6),
});

export const choiceDraftSchema = z.object({
  label: z.string().trim().min(1).max(90),
  stat: z.enum(STATS),
  difficulty: z.number().int().min(8).max(16),
});

export const sceneDraftSchema = z.object({
  title: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(900),
  choices: z.array(choiceDraftSchema).min(2).max(3),
});

export const epilogueDraftSchema = z.object({
  title: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(1000),
});

export type CharacterDraft = z.infer<typeof characterDraftSchema>;
export type WorldDraft = z.infer<typeof worldSchema>;
export type RosterDraft = z.infer<typeof rosterDraftSchema>;
export type ChoiceDraft = z.infer<typeof choiceDraftSchema>;
export type SceneDraft = z.infer<typeof sceneDraftSchema>;
export type EpilogueDraft = z.infer<typeof epilogueDraftSchema>;

/** Actions des joueurs et de l'écran principal. */
export const pickSchema = z.object({ characterId: z.string().min(1).max(16) });
export const voteSchema = z.object({ choiceId: z.string().min(1).max(16) });
export const regenerateSchema = z.object({});

export type PickPayload = z.infer<typeof pickSchema>;
export type VotePayload = z.infer<typeof voteSchema>;
