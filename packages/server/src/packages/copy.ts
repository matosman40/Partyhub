import type { BoardGameService } from '../boards/service.js';
import type { CardGameService } from '../cards/service.js';
import type { MediaQuizService } from '../media/service.js';
import type { PackageModule } from './format.js';
import type { PackageService } from './service.js';

const COPY_SUFFIX = ' (copie)';

/** Nom d'une copie : « … (copie) », tronqué pour rester dans la limite de 40 caractères. */
export function copyNameOf(name: string): string {
  return `${name.slice(0, 40 - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

export interface CopyServices {
  packages: PackageService;
  cardGames: CardGameService;
  boardGames: BoardGameService;
  mediaGames: MediaQuizService;
}

export type CopyResult =
  | { ok: true; id: string; module: PackageModule; name: string }
  | { ok: false; error: string };

/**
 * Crée un jeu modifiable à partir d'un paquet actif : même définition, enregistrée dans le
 * service de l'administration correspondant au module (cartes, plateau ou questions). Le
 * paquet reste installé et inchangé ; la copie ne reçoit pas ses mises à jour.
 */
export function copyPackageToEditable(packageId: string, services: CopyServices): CopyResult {
  const read = services.packages.readActive(packageId);
  if (!read.ok) return read;
  const { pkg } = read;
  const name = copyNameOf(pkg.definition.name);
  let saved: { ok: true; id: string } | { ok: false; error: string };
  switch (pkg.module) {
    case 'cards':
      saved = services.cardGames.save(null, { ...pkg.definition, name });
      break;
    case 'board':
      saved = services.boardGames.save(null, { ...pkg.definition, name });
      break;
    case 'quiz':
      saved = services.mediaGames.save(null, { ...pkg.definition, name });
      break;
  }
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, id: saved.id, module: pkg.module, name };
}
