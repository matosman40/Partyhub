import { allGames, sourceOf, type CustomSource } from './games-registry.js';
import type { CatalogGame, GameInfo, GameModule, GameOrigin } from '@partyhub/shared';
import type { Store } from './db/store.js';
import { defaultDetails, detailsOverride, settingsOverride, withOverrides } from './game-details.js';

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

const ORIGIN_OF_SOURCE: Record<CustomSource | 'builtin', GameOrigin> = {
  builtin: 'builtin',
  cards: 'cards',
  media: 'media',
  boards: 'board',
  packages: 'package',
};

/** Origine d'un jeu, lue dans la table qui le porte (code, cartes, médias, plateau ou paquet). */
export function originOf(id: string): GameOrigin {
  return ORIGIN_OF_SOURCE[sourceOf(id) ?? 'builtin'];
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
        settings: module.defaultSettings as Record<string, unknown>,
        defaultSettings: original.defaultSettings as Record<string, unknown>,
        customSettings: settingsOverride(store, original) !== undefined,
        enabled: store.isGameEnabled(original.manifest.id),
      };
    })
    .filter((g) => includeDisabled || g.enabled);
}
