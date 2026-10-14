import { z } from 'zod';
import { hashText } from './avatars.js';

/**
 * Personnage de joueur : un petit dessin articulé, choisi dans des listes fermées.
 * Tout est stocké par index : une valeur hors liste est refusée, rien de libre n'entre en base.
 */
export const CHARACTER_BODY_COLORS = [
  '#ff7a8f',
  '#3ff5e0',
  '#8b5cff',
  '#ffc83d',
  '#7ee787',
  '#ff9f43',
  '#2f5dd6',
  '#f7f4ff',
] as const;

export const CHARACTER_SKIN_TONES = ['#ffe0bd', '#f6c7a1', '#e9a77a', '#c98b62', '#8d5a3b'] as const;

export const CHARACTER_HAIR_STYLES = ['none', 'short', 'bob', 'spiky', 'bun', 'curly'] as const;

export const CHARACTER_HAIR_COLORS = ['#1b1040', '#7a4a2a', '#ff9f43', '#ff5d8f', '#5b3cc4', '#f1e3c8'] as const;

export const CHARACTER_ACCESSORIES = [
  'none',
  'party',
  'crown',
  'cap',
  'glasses',
  'headphones',
  'bow',
  'flower',
] as const;

/** Attitudes du personnage : chacune correspond à un moment de la partie (voir CharacterMood). */
export const CHARACTER_MOODS = ['idle', 'joy', 'sad', 'wave', 'dance'] as const;

export type HairStyle = (typeof CHARACTER_HAIR_STYLES)[number];
export type CharacterAccessory = (typeof CHARACTER_ACCESSORIES)[number];
export type CharacterMood = (typeof CHARACTER_MOODS)[number];

export interface CharacterSpec {
  body: number;
  skin: number;
  hair: number;
  hairColor: number;
  accessory: number;
}

const index = (max: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(max - 1);

export const characterSchema = z.object({
  body: index(CHARACTER_BODY_COLORS.length),
  skin: index(CHARACTER_SKIN_TONES.length),
  hair: index(CHARACTER_HAIR_STYLES.length),
  hairColor: index(CHARACTER_HAIR_COLORS.length),
  accessory: index(CHARACTER_ACCESSORIES.length),
});

/** Personnage généré pour un texte donné (pseudo) : même pseudo, même personnage partout. */
export function defaultCharacterFor(seed: string): CharacterSpec {
  const h = hashText(seed);
  return {
    body: h % CHARACTER_BODY_COLORS.length,
    skin: (h >>> 3) % CHARACTER_SKIN_TONES.length,
    hair: (h >>> 6) % CHARACTER_HAIR_STYLES.length,
    hairColor: (h >>> 9) % CHARACTER_HAIR_COLORS.length,
    accessory: (h >>> 12) % CHARACTER_ACCESSORIES.length,
  };
}

/** Couleurs réelles d'un personnage (les index sont déjà validés). */
export function characterColors(spec: CharacterSpec) {
  return {
    body: CHARACTER_BODY_COLORS[spec.body] ?? CHARACTER_BODY_COLORS[0],
    skin: CHARACTER_SKIN_TONES[spec.skin] ?? CHARACTER_SKIN_TONES[0],
    hair: CHARACTER_HAIR_COLORS[spec.hairColor] ?? CHARACTER_HAIR_COLORS[0],
    hairStyle: CHARACTER_HAIR_STYLES[spec.hair] ?? 'none',
    accessory: CHARACTER_ACCESSORIES[spec.accessory] ?? 'none',
  };
}
