import { useEffect, useState } from 'react';
import type { LobbyPosition, LobbyPositionEvent } from '@partyhub/shared';
import type { AppSocket } from '../realtime.js';

/**
 * Dernière place connue de chaque personnage du salon, par identifiant. Le serveur la diffuse seule à
 * chaque pas : elle complète la vue de la salle, qui ne la renvoie qu’aux changements de joueurs.
 */
export function useLobbyPositions(socket: AppSocket | null): Record<string, LobbyPosition> {
  const [positions, setPositions] = useState<Record<string, LobbyPosition>>({});

  useEffect(() => {
    if (!socket) return;
    const onPosition = (e: LobbyPositionEvent) => {
      setPositions((prev) => ({ ...prev, [e.playerId]: e.position }));
    };
    socket.on('room:lobby-position', onPosition);
    return () => {
      socket.off('room:lobby-position', onPosition);
    };
  }, [socket]);

  return positions;
}
