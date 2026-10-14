import { allGames } from './games-registry.js';
import type { CatalogGame, GameInfo, GameModule, GameOrigin } from '@partyhub/shared';
import type { Store } from './db/store.js';
import { CUSTOM_GAME_PREFIX } from './cards/service.js';
import { MEDIA_GAME_PREFIX } from './media/service.js';
import { defaultDetails, detailsOverride, effectiveNotice, withOverrides } from './game-details.js';

export { effectiveNotice } from './game-details.js';

export function gameInfo(module: GameModule): GameInfo {
  const m = module.manifest;
  return {
    id: m.id,
    category: m.category,
    name: m.name,
    description: m.description,
    icon: m.icon,
    version: m.version,
    minPlayers: m.minPlayers,
    maxPlayers: m.maxPlayers,
    durationMin: m.durationMin,
    notice: m.notice,
  };
}

/** Origine d'un jeu, déduite de son identifiant (les jeux créés dans l'administration ont un préfixe). */
export function originOf(id: string): GameOrigin {
  if (id.startsWith(CUSTOM_GAME_PREFIX)) return 'cards';
  if (id.startsWith(MEDIA_GAME_PREFIX)) return 'media';
  return 'builtin';
}

/** Catalogue public (jeux activés) ou complet pour l'administration. */
export function catalog(store: Store, includeDisabled: boolean): CatalogGame[] {
  return allGames()
    .map((original) => {
      const module = withOverrides(original, store);
      const notice = module.manifest.notice;
      return {
        ...gameInfo(module),
        origin: originOf(original.manifest.id),
        notice,
        defaultNotice: original.manifest.notice,
        customNotice: notice !== original.manifest.notice,
        defaultDetails: defaultDetails(original),
        customDetails: detailsOverride(store, original.manifest.id) !== undefined,
        enabled: store.isGameEnabled(original.manifest.id),
      };
    })
    .filter((g) => includeDisabled || g.enabled);
}
