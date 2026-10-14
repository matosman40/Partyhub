import { createContext } from 'react';
import type { CharacterMood, CharacterSpec } from '@partyhub/shared';

/** Avatar d'un joueur tel que la salle le transmet : personnage, photo si autorisée, sinon emoji sur une teinte. */
export interface AvatarData {
  hue: number;
  emoji: string;
  imageUrl: string | null;
  character?: CharacterSpec | null;
}

/**
 * Avatars de la salle, indexés par pseudo (unique dans une salle). Fourni par l'écran TV
 * et par le téléphone, consommé par `Avatar` : les jeux n'ont rien à transmettre de plus.
 */
export const AvatarsContext = createContext<Record<string, AvatarData>>({});

/**
 * Humeur du personnage de chaque joueur, indexée par pseudo. Le jeu la fournit selon ce qui
 * se passe (bonne réponse, réponse donnée, classement) ; absent, le personnage est au repos.
 */
export const MoodsContext = createContext<Record<string, CharacterMood>>({});
