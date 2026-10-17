import type { VoiceEvent } from '@partyhub/shared';

/** Voix qui peuvent attendre leur tour sur l’écran. Au-delà, la nouvelle voix est écartée. */
export const VOICE_QUEUE_MAX = 4;
/** Silence entre deux voix, pour qu’elles ne se chevauchent pas. */
export const VOICE_GAP_MS = 300;
/** Quand le son est coupé sur l’écran, le bandeau reste ce temps (la voix n’est pas jouée). */
export const VOICE_MUTED_HOLD_MS = 2500;

export function enqueueVoice(queue: readonly VoiceEvent[], voice: VoiceEvent, max = VOICE_QUEUE_MAX): VoiceEvent[] {
  return queue.length >= max ? [...queue] : [...queue, voice];
}

/** Adresse publique du son d’une voix (identifiant aléatoire, sans compte). */
export function voiceUrl(voiceId: string): string {
  return `/api/voices/${encodeURIComponent(voiceId)}`;
}
