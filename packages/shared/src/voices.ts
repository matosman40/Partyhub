import { z } from 'zod';

/**
 * Voix de profil : de courts sons enregistrés par un joueur (5 au maximum), nommés par lui.
 * Pendant la partie, il les déclenche depuis son téléphone ; l'écran principal les joue.
 */

export const VOICE_MAX_PER_PROFILE = 5;
/** Durée d'un enregistrement : il s'arrête tout seul à cette limite. */
export const VOICE_MAX_SECONDS = 5;
/** Taille maximale d'une voix une fois enregistrée (5 secondes tiennent largement). */
export const VOICE_MAX_BYTES = 300 * 1024;
export const VOICE_NAME_MAX = 30;

/** Voix telle que le joueur la voit dans son profil : sans le son lui-même. */
export interface VoiceClip {
  id: string;
  name: string;
  createdAt: string;
}

/** Nom saisi par le joueur : texte court, sans caractères de contrôle. */
export const voiceNameSchema = z
  .string()
  .trim()
  .min(1, 'Donnez un nom à cette voix.')
  .max(VOICE_NAME_MAX, `Nom trop long (${VOICE_NAME_MAX} caractères maximum).`)
  .refine((name) => !/\p{Cc}/u.test(name), 'Nom invalide.');

export const voicePlaySchema = z.object({
  id: z.string().min(1).max(64),
});

/**
 * Reconnaît le format d'un son à ses premiers octets (jamais à l'extension ou au type déclaré).
 * Retourne le type MIME à servir, ou null si le fichier n'est pas un son connu.
 */
export function sniffAudioMime(bytes: Uint8Array): string | null {
  const at = (i: number) => bytes[i] ?? -1;
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length < 12) return null;
  // WebM / Matroska (EBML)
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return 'audio/webm';
  if (text(0, 4) === 'OggS') return 'audio/ogg';
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') return 'audio/wav';
  // MP4 / M4A : la boîte « ftyp » suit la taille, en position 4.
  if (text(4, 4) === 'ftyp') return 'audio/mp4';
  // MP3 : étiquette ID3 en tête, ou trame MPEG (11 bits de synchronisation à 1).
  if (text(0, 3) === 'ID3') return 'audio/mpeg';
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}
