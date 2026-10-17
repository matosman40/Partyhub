import { VOICE_MAX_BYTES, VOICE_MAX_PER_PROFILE, VOICE_MAX_SECONDS, type VoiceClip } from '@partyhub/shared';

/** Formats d’enregistrement préférés, dans l’ordre. Le navigateur choisit le premier qu’il sait faire. */
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** Premier format d’enregistrement accepté par le navigateur, ou '' (il choisira lui-même). */
export function pickRecordingType(isSupported: (type: string) => boolean): string {
  return RECORDING_TYPES.find((type) => isSupported(type)) ?? '';
}

/** Premier nom « Voix n » encore libre (1 à 5). */
export function defaultVoiceName(existing: readonly VoiceClip[]): string {
  const names = new Set(existing.map((v) => v.name));
  for (let n = 1; n <= VOICE_MAX_PER_PROFILE; n++) {
    if (!names.has(`Voix ${n}`)) return `Voix ${n}`;
  }
  return 'Voix';
}

/**
 * Contrôle d’un fichier choisi avant envoi. La durée est inconnue (Infinity) pour certains
 * enregistrements : on ne refuse alors que sur la taille.
 */
export function checkVoiceFile(size: number, durationSeconds: number): string | null {
  if (size > VOICE_MAX_BYTES) return 'Fichier trop lourd : 300 Ko maximum.';
  if (Number.isFinite(durationSeconds) && durationSeconds > VOICE_MAX_SECONDS + 0.5) {
    return `Trop long (${Math.round(durationSeconds)} s) : ${VOICE_MAX_SECONDS} secondes maximum.`;
  }
  return null;
}
