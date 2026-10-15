import { useEffect, useState } from 'react';
import type { LobbyMood, LobbyMoodEvent } from '@partyhub/shared';
import type { AppSocket } from '../realtime.js';

/** Une émotion reste affichée quelques secondes, puis le personnage revient au repos. */
export const LOBBY_MOOD_MS = 2600;

/** Émotions en cours, par identifiant de joueur. Rien n'est gardé au-delà de LOBBY_MOOD_MS. */
export function useLobbyMoods(socket: AppSocket | null): Record<string, LobbyMood> {
  const [moods, setMoods] = useState<Record<string, LobbyMood>>({});

  useEffect(() => {
    if (!socket) return;
    const timers = new Map<string, number>();
    const onMood = (e: LobbyMoodEvent) => {
      setMoods((prev) => ({ ...prev, [e.playerId]: e.mood }));
      window.clearTimeout(timers.get(e.playerId));
      timers.set(
        e.playerId,
        window.setTimeout(() => {
          timers.delete(e.playerId);
          setMoods((prev) => {
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

  return moods;
}
