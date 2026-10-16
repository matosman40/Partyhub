import { describe, expect, it } from 'vitest';
import {
  clampLobbyPosition,
  defaultLobbyPosition,
  LOBBY_FACE_INFO,
  LOBBY_FACES,
  LOBBY_MOOD_INFO,
  LOBBY_MOODS,
  lobbyEmoteEmoji,
  lobbyMoodSchema,
  lobbyPositionSchema,
} from '../lobby-presence.js';
import { CHARACTER_EXPRESSIONS } from '../characters.js';

describe('Présence dans le salon', () => {
  it('ramène une position dans les marges, sans la changer au centre', () => {
    expect(clampLobbyPosition({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
    expect(clampLobbyPosition({ x: -1, y: 2 })).toEqual({ x: 0.06, y: 0.86 });
  });

  it('répartit les personnages par défaut sur une même ligne, à l’intérieur des marges', () => {
    const three = [0, 1, 2].map((i) => defaultLobbyPosition(i, 3));
    expect(three.map((p) => p.x)).toEqual([0.25, 0.5, 0.75]);
    expect(new Set(three.map((p) => p.y)).size).toBe(1);
  });

  it('n’accepte que des positions entre 0 et 1, et que les émotions de la liste', () => {
    expect(lobbyPositionSchema.safeParse({ x: 0, y: 1 }).success).toBe(true);
    expect(lobbyPositionSchema.safeParse({ x: 1.2, y: 0.5 }).success).toBe(false);
    expect(lobbyMoodSchema.safeParse({ mood: 'joy' }).success).toBe(true);
    expect(lobbyMoodSchema.safeParse({ mood: 'idle' }).success).toBe(false);
  });

  it('accepte une attitude seule ou un visage seul, jamais les deux ni rien', () => {
    expect(lobbyMoodSchema.safeParse({ face: 'rieur' }).success).toBe(true);
    expect(lobbyMoodSchema.safeParse({ face: 'coucou' }).success).toBe(false);
    expect(lobbyMoodSchema.safeParse({ mood: 'joy', face: 'rieur' }).success).toBe(false);
    expect(lobbyMoodSchema.safeParse({}).success).toBe(false);
  });

  it('propose les six visages du profil, chacun avec un libellé et un emoji', () => {
    expect(LOBBY_FACES).toEqual(CHARACTER_EXPRESSIONS);
    for (const face of LOBBY_FACES) {
      expect(LOBBY_FACE_INFO[face].label.length).toBeGreaterThan(0);
      expect(lobbyEmoteEmoji({ mood: null, face })).toBe(LOBBY_FACE_INFO[face].emoji);
    }
  });

  it('propose quatre émotions, chacune avec un libellé et un emoji', () => {
    expect(LOBBY_MOODS).toEqual(['wave', 'joy', 'dance', 'sad']);
    for (const mood of LOBBY_MOODS) {
      expect(LOBBY_MOOD_INFO[mood].label.length).toBeGreaterThan(0);
      expect(LOBBY_MOOD_INFO[mood].emoji.length).toBeGreaterThan(0);
    }
  });
});
