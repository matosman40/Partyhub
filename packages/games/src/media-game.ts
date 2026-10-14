import type { GameModule, MediaQuizDefinition } from '@partyhub/shared';
import { createCaptionGame } from './captions/module.js';
import { createMediaQuiz } from './media-quiz/module.js';

/**
 * Crée le jeu correspondant à une définition de médias, selon son mode :
 * « devine » (on tape le titre) ou « sous-titres » (on écrit la réplique).
 */
export function createMediaGame(
  definition: MediaQuizDefinition,
  options: { id: string },
): GameModule {
  return definition.mode === 'sous-titres'
    ? createCaptionGame(definition, options)
    : createMediaQuiz(definition, options);
}
