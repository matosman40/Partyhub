import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@partyhub/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let shared: AppSocket | null = null;

function options(autoConnect: boolean) {
  return {
    autoConnect,
    transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  };
}

/** Connexion partagée de la page (écran principal ou page d'accueil). */
export function getSocket(): AppSocket {
  if (!shared) shared = io(options(true));
  return shared;
}

/**
 * Connexion dédiée à un siège. Un même appareil peut tenir plusieurs joueurs
 * (chacun a son propre socket, donc son propre jeton et sa propre place).
 * La connexion n'est ouverte qu'à l'appel de `connect()`.
 */
export function createSocket(): AppSocket {
  return io(options(false));
}
