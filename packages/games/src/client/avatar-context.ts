import { createContext } from 'react';

/** Avatar d'un joueur tel que la salle le transmet : emoji sur une teinte, photo si autorisée. */
export interface AvatarData {
  hue: number;
  emoji: string;
  imageUrl: string | null;
}

/**
 * Avatars de la salle, indexés par pseudo (unique dans une salle). Fourni par l'écran TV
 * et par le téléphone, consommé par `Avatar` : les jeux n'ont rien à transmettre de plus.
 */
export const AvatarsContext = createContext<Record<string, AvatarData>>({});
