import { api } from '../api.js';
import { rememberRecent } from './recentGames.js';

/**
 * Crée une salle pour ce jeu (ou une partie d’essai seul), note le jeu comme joué récemment
 * et renvoie le code de la salle. Utilisé par l’accueil et par la fiche du jeu.
 */
export async function launchGame(gameId: string, practice: boolean): Promise<string> {
  const room = await api<{ code: string; hostToken: string }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ gameId, practice }),
  });
  // Le jeton d’hôte reste dans cet onglet : il n’est jamais transmis aux joueurs.
  sessionStorage.setItem(`ph:host:${room.code}`, room.hostToken);
  rememberRecent(gameId);
  return room.code;
}
