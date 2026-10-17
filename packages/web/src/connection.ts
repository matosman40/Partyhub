import { useEffect, useState } from 'react';
import type { AppSocket } from './realtime.js';

/** Délai maximal d'attente d'une réponse du salon, en millisecondes : au-delà, le bouton redevient utilisable. */
export const ACK_TIMEOUT_MS = 8000;

/** Message quand une action ne peut pas partir : la connexion est coupée, rien n'est gardé en attente. */
export const OFFLINE_ACTION_ERROR =
  'Connexion perdue : votre choix n’a pas été envoyé. Réessayez dès que la connexion revient.';

/** Message quand le salon ne répond pas dans le délai. */
export const NO_ANSWER_ERROR = 'Pas de réponse du salon. Réessayez.';

/**
 * Une commande de l'utilisateur ne part qu'en ligne. Hors connexion, socket.io la garderait pour la rejouer à la
 * reconnexion, avant que le salon ne reconnaisse l'écran : elle serait refusée, ou perdue sans message. Renvoie
 * `false` et affiche le message « connexion perdue » à la place.
 */
export function canSend(socket: { connected: boolean }, show: (message: string) => void): boolean {
  if (socket.connected) return true;
  show(OFFLINE_ACTION_ERROR);
  return false;
}

/**
 * État de la connexion temps réel. `connected` dit si une action peut partir maintenant ; `lost` dit qu'une
 * connexion établie a été perdue (l'interface l'annonce, le temps que la reconnexion aboutisse).
 */
export function useConnection(socket: AppSocket): { connected: boolean; lost: boolean } {
  const [connected, setConnected] = useState(socket.connected);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const up = () => {
      setConnected(true);
      setLost(false);
    };
    const down = () => {
      setConnected(false);
      setLost(true);
    };
    setConnected(socket.connected);
    socket.on('connect', up);
    socket.on('disconnect', down);
    return () => {
      socket.off('connect', up);
      socket.off('disconnect', down);
    };
  }, [socket]);

  return { connected, lost };
}
