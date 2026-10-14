import { createBoardGame, createCardGame, createMediaGame } from '@partyhub/games';
import type { GameModule } from '@partyhub/shared';
import { packageGameId, type ValidatedPackage } from './format.js';

/** Crée le jeu du registre correspondant à un paquet validé, selon son module. */
export function createPackageGame(pkg: ValidatedPackage): GameModule {
  const id = packageGameId(pkg.manifest.id, pkg.module);
  switch (pkg.module) {
    case 'cards':
      return createCardGame(pkg.definition, { id });
    case 'board':
      return createBoardGame(pkg.definition, { id });
    case 'quiz':
      return createMediaGame(pkg.definition, { id });
  }
}
