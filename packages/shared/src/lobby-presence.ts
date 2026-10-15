import { z } from 'zod';
import type { CharacterMood } from './characters.js';

/**
 * Présence dans le salon : chaque personnage peut être déplacé et prendre une émotion.
 * Rien n'est enregistré en base : les positions vivent le temps de la salle, les émotions sont
 * diffusées une fois puis oubliées.
 */

/** Émotions proposées dans le salon : les attitudes du personnage, sauf la posture de repos. */
export const LOBBY_MOODS = ['wave', 'joy', 'dance', 'sad'] as const satisfies readonly CharacterMood[];
export type LobbyMood = (typeof LOBBY_MOODS)[number];

/** Libellé et emoji de chaque émotion : le bouton, puis la bulle au-dessus du personnage. */
export const LOBBY_MOOD_INFO: Record<LobbyMood, { label: string; emoji: string }> = {
  wave: { label: 'Saluer', emoji: '👋' },
  joy: { label: 'Joie', emoji: '🎉' },
  dance: { label: 'Danser', emoji: '💃' },
  sad: { label: 'Triste', emoji: '😢' },
};

/** Position relative (0 à 1) dans la zone du salon. */
export interface LobbyPosition {
  x: number;
  y: number;
}

/** Marge gardée autour du bord : le personnage reste entièrement visible. */
export const LOBBY_MARGIN = { x: 0.06, y: 0.14 } as const;

export const lobbyPositionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const lobbyMoodSchema = z.object({ mood: z.enum(LOBBY_MOODS) });

/** Émotion diffusée à toute la salle. */
export interface LobbyMoodEvent {
  id: string;
  playerId: string;
  mood: LobbyMood;
}

/** Ramène une position dans la zone utile, marges comprises. */
export function clampLobbyPosition(p: LobbyPosition): LobbyPosition {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  return {
    x: clamp(p.x, LOBBY_MARGIN.x, 1 - LOBBY_MARGIN.x),
    y: clamp(p.y, LOBBY_MARGIN.y, 1 - LOBBY_MARGIN.y),
  };
}

/** Position de départ : tous les personnages sur une même ligne, répartis régulièrement. */
export function defaultLobbyPosition(index: number, count: number): LobbyPosition {
  return clampLobbyPosition({ x: (index + 1) / (count + 1), y: 0.62 });
}
