import { useEffect, useState } from 'react';
import type { CharacterExpression, CharacterMood, LobbyMood, LobbyMoodEvent } from '@partyhub/shared';
import type { AppSocket } from '../realtime.js';

/** Une émotion reste affichée quelques secondes, puis le personnage revient au repos. */
export const LOBBY_MOOD_MS = 2600;

/** Émotion en cours d’un joueur. L’identifiant change à chaque envoi, même pour une émotion répétée. */
export interface LobbyEmote {
  id: string;
  /** Attitude du corps, ou null quand seul le visage change. */
  mood: LobbyMood | null;
  /** Visage montré pendant quelques secondes, ou null. */
  face: CharacterExpression | null;
}

/** Attitude à jouer pour une émotion : le repos quand seul le visage change. */
export function poseOf(emote: Pick<LobbyEmote, 'mood'>): CharacterMood {
  return emote.mood ?? 'idle';
}

/** Émotions en cours, par identifiant de joueur. Rien n’est gardé au-delà de LOBBY_MOOD_MS. */
export function useLobbyMoods(socket: AppSocket | null): Record<string, LobbyEmote> {
  const [emotes, setEmotes] = useState<Record<string, LobbyEmote>>({});

  useEffect(() => {
    if (!socket) return;
    const timers = new Map<string, number>();
    const onMood = (e: LobbyMoodEvent) => {
      setEmotes((prev) => ({ ...prev, [e.playerId]: { id: e.id, mood: e.mood, face: e.face } }));
      window.clearTimeout(timers.get(e.playerId));
      timers.set(
        e.playerId,
        window.setTimeout(() => {
          timers.delete(e.playerId);
          setEmotes((prev) => {
            const next = { ...prev };
            delete next[e.playerId];
            return next;
          });
        }, LOBBY_MOOD_MS),
      );
    };
    socket.on('room:lobby-mood', onMood);
    return () => {
      socket.off('room:lobby-mood', onMood);
      for (const t of timers.values()) window.clearTimeout(t);
    };
  }, [socket]);

  return emotes;
}
