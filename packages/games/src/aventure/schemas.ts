import { z } from 'zod';
import { GAME_IMAGE_ID } from '@partyhub/shared';
import { THEME_IDS } from './themes.js';

/**
 * Formes attendues de l'IA (ou de l'histoire de secours), réglages de l'aventure, et personnages gardés
 * d'une partie à l'autre. Tout ce qui vient d'un modèle de langage ou d'un profil passe par ces schémas.
 */

export const STATS = ['force', 'ruse', 'esprit', 'charme'] as const;
export type StatKey = (typeof STATS)[number];

export const STAT_LABELS: Record<StatKey, string> = {
  force: 'Force',
  ruse: 'Ruse',
  esprit: 'Esprit',
  charme: 'Charme',
};

export const TONES = ['aventure', 'humour', 'mystere', 'fantastique', 'absurde'] as const;
export type Tone = (typeof TONES)[number];

export const TONE_LABELS: Record<Tone, string> = {
  aventure: 'Aventure épique',
  humour: 'Humour et décalage',
  mystere: 'Mystère et intrigue',
  fantastique: 'Féerique et fantastique',
  absurde: 'Absurde et loufoque',
};

/** Difficulté au salon : décale les difficultés des jets et les points de vie des ennemis. */
export const DIFFICULTIES = ['facile', 'normal', 'difficile'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  facile: 'Facile',
  normal: 'Normale',
  difficile: 'Difficile',
};

export const DIFFICULTY_SHIFT: Record<Difficulty, { difficulty: number; hp: number }> = {
  facile: { difficulty: -2, hp: -2 },
  normal: { difficulty: 0, hp: 0 },
  difficile: { difficulty: 2, hp: 3 },
};

/** Types de scènes. Un affrontement (`combat`) se reconnaît à son ennemi, pas à ce champ. */
export const SCENE_KINDS = ['choix', 'dialogue', 'enigme', 'halte', 'combat'] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

export const KIND_LABELS: Record<SceneKind, string> = {
  choix: 'Rencontre',
  dialogue: 'Dialogue',
  enigme: 'Énigme',
  halte: 'Halte',
  combat: 'Combat',
};

/** Parties courtes : trois à six scènes, un vote court, une difficulté et un thème. */
export const aventureSettingsSchema = z.object({
  scenes: z.number().int().min(3).max(6).default(4),
  /** `auto` : un thème au hasard parmi ceux du catalogue ; `libre` : seul le texte compte. */
  themeId: z.enum(['auto', 'libre', ...THEME_IDS]).default('auto'),
  theme: z.string().trim().max(120).default(''),
  tone: z.enum(TONES).default('aventure'),
  voteSeconds: z.number().int().min(15).max(120).default(30),
  difficulte: z.enum(DIFFICULTIES).default('normal'),
});

export type AventureSettings = z.infer<typeof aventureSettingsSchema>;

/** Actions de combat : chacune s'appuie sur une stat, et son effet est fixé par le moteur (pas par l'IA). */
export const COMBAT_ACTIONS = ['frapper', 'feinter', 'soigner', 'parlementer'] as const;
export type CombatActionId = (typeof COMBAT_ACTIONS)[number];

export const COMBAT_ACTION_INFO: Record<CombatActionId, { label: string; stat: StatKey; effect: string }> = {
  frapper: { label: 'Frapper', stat: 'force', effect: 'Inflige 2 dégâts si le coup porte.' },
  feinter: { label: 'Feinter', stat: 'ruse', effect: 'Inflige 1 dégât et empêche la riposte.' },
  soigner: { label: 'Soigner', stat: 'esprit', effect: 'Rend 2 PV au plus blessé de l’équipe.' },
  parlementer: { label: 'Parlementer', stat: 'charme', effect: 'Si ça marche, l’ennemi ne riposte pas.' },
};

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
  /** Apparence en une phrase concrète (couleurs, vêtements, objet) : sert à dessiner le portrait. */
  look: z.string().trim().min(1).max(200).optional(),
});

/** Monde et fil conducteur : l'objectif et le secret donnent du sens à chaque scène. */
export const worldSchema = z.object({
  title: z.string().trim().min(1).max(60),
  intro: z.string().trim().min(1).max(500),
  goal: z.string().trim().min(1).max(160),
  secret: z.string().trim().min(1).max(200),
});

/** Personnage secondaire, rencontré au fil de l'histoire. Il est dessiné à partir de son nom. */
export const npcDraftSchema = z.object({
  name: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8),
  attitude: z.string().trim().min(1).max(160),
});

export const rosterDraftSchema = z.object({
  world: worldSchema,
  characters: z.array(characterDraftSchema).min(6),
  npcs: z.array(npcDraftSchema).max(4).default([]),
});

/**
 * Chaque choix dit ce qui arrive dans les deux cas : le résultat du jet ne fait que trancher.
 * Les effets (objet, soin, risque, lien avec le personnage de la scène) sont tous facultatifs.
 */
export const choiceDraftSchema = z.object({
  label: z.string().trim().min(1).max(90),
  stat: z.enum(STATS),
  difficulty: z.number().int().min(8).max(16),
  onSuccess: z.string().trim().min(1).max(220),
  onFailure: z.string().trim().min(1).max(220),
  /** Objet gagné en cas de réussite (il rejoint le sac du personnage). */
  item: z.string().trim().min(1).max(40).nullable().optional(),
  /** Points de vie rendus au personnage en cas de réussite. */
  heal: z.number().int().min(0).max(2).default(0),
  /** Points de vie perdus en cas d'échec. */
  risk: z.number().int().min(0).max(3).default(2),
  /** Effet sur le lien avec le personnage de la scène : -1, 0 ou +1, quel que soit le jet. */
  bond: z.number().int().min(-1).max(1).default(0),
});

export const enemyDraftSchema = z.object({
  name: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8),
  intro: z.string().trim().min(1).max(240),
  hp: z.number().int().min(4).max(14),
  defense: z.number().int().min(9).max(14),
  damage: z.number().int().min(1).max(3),
  onVictory: z.string().trim().min(1).max(220),
  /** Objet trouvé sur l'ennemi après sa défaite. */
  loot: z.string().trim().min(1).max(40).nullable().optional(),
});

export const sceneNpcSchema = npcDraftSchema.extend({
  line: z.string().trim().min(1).max(160),
});

export const sceneDraftSchema = z
  .object({
    /** Facultatif : sans valeur, le moteur déduit le type (combat, dialogue ou rencontre). */
    kind: z.enum(SCENE_KINDS).optional(),
    title: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(700),
    /** Indice affiché à côté des choix (surtout pour une énigme). */
    hint: z.string().trim().min(1).max(160).nullable().optional(),
    npc: sceneNpcSchema.nullable().optional(),
    enemy: enemyDraftSchema.nullable().optional(),
    choices: z.array(choiceDraftSchema).max(3).default([]),
  })
  .superRefine((scene, ctx) => {
    if (!scene.enemy && scene.choices.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['choices'], message: 'Deux choix au moins, ou un affrontement.' });
    }
  });

export const epilogueDraftSchema = z.object({
  title: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(1000),
});

/** Personnage gardé pour un profil : ce qui survit d'une partie à l'autre. */
export const savedCharacterSchema = z.object({
  libraryId: z.string().regex(/^lib-[a-z0-9]{8}$/),
  name: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(40),
  emoji: z.string().trim().min(1).max(8),
  backstory: z.string().trim().min(1).max(240),
  stats: z.object({ force: statValue, ruse: statValue, esprit: statValue, charme: statValue }),
  pvMax: z.number().int().min(6).max(14),
  ability: z.object({ name: z.string().min(1).max(40), text: z.string().min(1).max(160) }),
  flaw: z.string().min(1).max(100),
  item: z.string().min(1).max(60),
  level: z.number().int().min(1).max(5),
  xp: z.number().int().min(0).max(100000),
  games: z.number().int().min(0).max(100000),
  victories: z.number().int().min(0).max(100000),
  /** Portrait généré (identifiant d'image de la bibliothèque), ou null : le personnage est alors dessiné. */
  portraitId: z.string().regex(GAME_IMAGE_ID).nullable().default(null),
  lastPlayed: z.number().finite(),
});

/** Personnages gardés par profil : les plus récents d'abord. */
export const LIBRARY_MAX = 40;

/** Contenu d'un profil pour ce jeu : une version, et au plus `LIBRARY_MAX` personnages. */
export const libraryDataSchema = z.object({
  version: z.literal(1),
  characters: z.array(savedCharacterSchema).max(LIBRARY_MAX),
});

export type CharacterDraft = z.infer<typeof characterDraftSchema>;
export type WorldDraft = z.infer<typeof worldSchema>;
export type NpcDraft = z.infer<typeof npcDraftSchema>;
export type RosterDraft = z.infer<typeof rosterDraftSchema>;
export type ChoiceDraft = z.infer<typeof choiceDraftSchema>;
export type EnemyDraft = z.infer<typeof enemyDraftSchema>;
export type SceneDraft = z.infer<typeof sceneDraftSchema>;
export type EpilogueDraft = z.infer<typeof epilogueDraftSchema>;
export type SavedCharacter = z.infer<typeof savedCharacterSchema>;

/** Actions des joueurs et de l'écran principal. */
export const pickSchema = z.object({ characterId: z.string().min(1).max(32) });
export const voteSchema = z.object({ choiceId: z.string().min(1).max(16) });
export const combatSchema = z.object({ action: z.enum(COMBAT_ACTIONS) });
export const regenerateSchema = z.object({});

export type PickPayload = z.infer<typeof pickSchema>;
export type VotePayload = z.infer<typeof voteSchema>;
export type CombatPayload = z.infer<typeof combatSchema>;
