import { z } from 'zod';
import { CHARACTER_EXPRESSIONS, type CharacterExpression, type CharacterMood } from './characters.js';

/**
 * Présence dans le salon : chaque personnage peut être déplacé et prendre une émotion.
 * Rien n’est enregistré en base : les positions vivent le temps de la salle, les émotions sont
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

/**
 * Visages que le joueur peut montrer dans le salon : ceux de son profil, pendant quelques secondes.
 * Une attitude (saluer, danser…) change le corps ; un visage change seulement l’expression.
 */
export const LOBBY_FACES = CHARACTER_EXPRESSIONS;

export const LOBBY_FACE_INFO: Record<CharacterExpression, { label: string; emoji: string }> = {
  calme: { label: 'Calme', emoji: '😌' },
  souriant: { label: 'Souriant', emoji: '🙂' },
  rieur: { label: 'Rire', emoji: '😂' },
  clin: { label: 'Clin d’œil', emoji: '😉' },
  triste: { label: 'Chagrin', emoji: '😞' },
  etonne: { label: 'Étonné', emoji: '😲' },
};

/** Un choix envoyé par le téléphone : une attitude, ou un visage (jamais les deux). */
export type LobbyMoodChoice = { mood: LobbyMood } | { face: CharacterExpression };

/** Identifiant du jeu « plateau de test » : une salle où l’on essaie les déplacements, sans partie. */
export const PLATEAU_TEST_ID = 'plateau-test';

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

export const lobbyMoodSchema = z.union([
  z.object({ mood: z.enum(LOBBY_MOODS) }).strict(),
  z.object({ face: z.enum(LOBBY_FACES) }).strict(),
]);

/** Nouvelle place d’un personnage, diffusée seule à la salle (sans renvoyer toute la vue). */
export interface LobbyPositionEvent {
  playerId: string;
  position: LobbyPosition;
}

/** Émotion diffusée à toute la salle : une attitude, un visage, ou les deux champs à null pour rien. */
export interface LobbyMoodEvent {
  id: string;
  playerId: string;
  /** Attitude du corps, ou null quand seul le visage change. */
  mood: LobbyMood | null;
  /** Visage montré pendant quelques secondes, ou null (le visage habituel reste). */
  face: CharacterExpression | null;
}

/** Emoji de la bulle au-dessus d’un personnage : celui du visage, sinon celui de l’attitude. */
export function lobbyEmoteEmoji(e: { mood: LobbyMood | null; face: CharacterExpression | null }): string {
  if (e.face) return LOBBY_FACE_INFO[e.face].emoji;
  return e.mood ? LOBBY_MOOD_INFO[e.mood].emoji : '';
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
