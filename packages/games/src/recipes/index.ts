import type { GameModule, RecipeDefinition } from '@partyhub/shared';
import { createVoteSurConsigne, type RecipeState, type VoteSettings } from './vote-sur-consigne.js';

/**
 * Crée le jeu d'un paquet « recette » (format 3) à partir de sa définition validée. Le moteur de chaque
 * recette est écrit ici, une fois, et reste identique pour tous les paquets qui la demandent.
 */
export function createRecipeGame(
  definition: RecipeDefinition,
  options: { id: string },
): GameModule<RecipeState, VoteSettings> {
  switch (definition.recipe) {
    case 'vote-sur-consigne':
      return createVoteSurConsigne(definition, options);
  }
}

export { createVoteSurConsigne } from './vote-sur-consigne.js';
export type { RecipeState } from './vote-sur-consigne.js';
