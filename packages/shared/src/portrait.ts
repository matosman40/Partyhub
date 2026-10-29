import { z } from 'zod';
import {
  CHARACTER_ACCESSORIES,
  CHARACTER_EXPRESSIONS,
  CHARACTER_HAIR_STYLES,
  defaultCharacterFor,
  type CharacterSpec,
} from './characters.js';

/**
 * Création d’un personnage à partir d’une photo de portrait.
 *
 * Le navigateur envoie la photo (réduite) au serveur, qui la fait analyser par un modèle de vision. Le modèle ne
 * répond que par des choix dans les listes ci-dessous : rien de libre n’en sort. Seul le personnage obtenu est gardé,
 * jamais la photo. Ce fichier est le contrat commun au serveur et à l’interface.
 */

/** Formats acceptés pour la photo (vérifiés par leur signature côté serveur). */
export const PORTRAIT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Taille maximale de la photo, une fois décodée. Le navigateur la réduit bien en dessous. */
export const PORTRAIT_MAX_BYTES = 1_500_000;
/** Côté le plus long de la photo envoyée par le navigateur (pixels). */
export const PORTRAIT_SEND_SIZE = 768;

export const PORTRAIT_SKIN_VALUES = ['very_light', 'light', 'medium', 'tan', 'dark'] as const;
export const PORTRAIT_HAIR_COLOR_VALUES = ['black', 'brown', 'orange', 'pink', 'blue_purple', 'blond_white'] as const;

/** Ce que le modèle de vision a le droit de répondre. Toute autre valeur, ou toute clé en plus, est refusée. */
export const portraitTraitsSchema = z
  .object({
    /** Nombre de visages humains visibles : un seul est accepté. */
    faces: z.number().int().min(0).max(20),
    skin: z.enum(PORTRAIT_SKIN_VALUES),
    hair_style: z.enum(CHARACTER_HAIR_STYLES),
    hair_color: z.enum(PORTRAIT_HAIR_COLOR_VALUES),
    accessory: z.enum(CHARACTER_ACCESSORIES),
    expression: z.enum(CHARACTER_EXPRESSIONS),
  })
  .strict();
export type PortraitTraits = z.infer<typeof portraitTraitsSchema>;

/**
 * Demande du navigateur : la photo en « data URL » (image/jpeg, image/png ou image/webp en base64) et le
 * consentement explicite, qui doit valoir exactement `true`.
 */
export const portraitRequestSchema = z
  .object({
    image: z
      .string()
      .min(100)
      .max(Math.ceil((PORTRAIT_MAX_BYTES * 4) / 3) + 200),
    consent: z.literal(true),
  })
  .strict();
export type PortraitRequest = z.infer<typeof portraitRequestSchema>;

/** Réponse en cas de succès : le personnage, prêt à être affiché dans l’éditeur puis enregistré. */
export interface PortraitCharacterResponse {
  character: CharacterSpec;
}

export type PortraitErrorCode =
  | 'consent_required'
  | 'unauthorized'
  | 'too_large'
  | 'bad_type'
  | 'no_face'
  | 'several_faces'
  | 'rate_limited'
  | 'unavailable'
  | 'provider_error';

export interface PortraitErrorResponse {
  error: string;
  code: PortraitErrorCode;
}

/**
 * Personnage correspondant aux traits reconnus. La couleur du corps et le reste du personnage actuel (`current`)
 * sont conservés : la photo ne dit rien de la tenue. Aucun pack de sprites n’est utilisé.
 */
export function traitsToCharacter(traits: PortraitTraits, current?: CharacterSpec | null): CharacterSpec {
  const base = current ?? defaultCharacterFor('portrait');
  return {
    body: base.body,
    skin: PORTRAIT_SKIN_VALUES.indexOf(traits.skin),
    hair: CHARACTER_HAIR_STYLES.indexOf(traits.hair_style),
    hairColor: PORTRAIT_HAIR_COLOR_VALUES.indexOf(traits.hair_color),
    accessory: CHARACTER_ACCESSORIES.indexOf(traits.accessory),
    expression: CHARACTER_EXPRESSIONS.indexOf(traits.expression),
    pack: null,
  };
}
