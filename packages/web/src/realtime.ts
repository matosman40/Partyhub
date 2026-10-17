import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@partyhub/shared';
import { logClient } from './log/clientLog.js';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let shared: AppSocket | null = null;

/**
 * Journalise les coupures réelles (refus du serveur, réseau, transport). Les déconnexions voulues
 * (fermeture de l'onglet, changement de page) ne sont pas des erreurs.
 */
function watch(socket: AppSocket): AppSocket {
  socket.on('connect_error', (err) => {
    logClient('warn', 'socket', `Connexion temps réel refusée ou interrompue : ${err.message}`);
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect' || reason === 'transport error' || reason === 'ping timeout') {
      logClient('warn', 'socket', `Connexion temps réel perdue : ${reason}`);
    }
  });
  return socket;
}

/**
 * Reconnexion : la première tentative part au bout de 0,5 s, puis l'attente croît sans dépasser 1,5 s. Au-delà,
 * un téléphone revenu sur le réseau restait jusqu'à 4 s sans répondre (mesuré : 3,4 s après le rétablissement).
 */
function options(autoConnect: boolean) {
  return {
    autoConnect,
    transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 1500,
  };
}

/** Connexion partagée de la page (écran principal ou page d'accueil). */
export function getSocket(): AppSocket {
  if (!shared) shared = watch(io(options(true)));
  return shared;
}

/**
 * Connexion dédiée à un siège. Un même appareil peut tenir plusieurs joueurs
 * (chacun a son propre socket, donc son propre jeton et sa propre place).
 * La connexion n'est ouverte qu'à l'appel de `connect()`.
 */
export function createSocket(): AppSocket {
  return watch(io(options(false)));
}
