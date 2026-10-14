import { gameDetailsSchema, type GameDetails, type GameModule, type GameNotice } from '@partyhub/shared';
import type { Store } from './db/store.js';

/**
 * Surcharges d'administration pour les jeux intégrés : nom, icône, description et notice.
 * Le code du jeu (règles, nombre de joueurs, réglages) ne change jamais ; seule la
 * présentation est modifiable. Une surcharge est appliquée au catalogue, au salon, à la
 * salle et aux titres affichés pendant la partie (les états de jeu gardent nom et icône).
 */

/** Notice effective : surcharge de l'administration si elle existe, sinon celle du code. */
export function effectiveNotice(store: Store, gameId: string, fallback: GameNotice): GameNotice {
  const raw = store.getNoticeOverride(gameId);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as GameNotice;
  } catch {
    return fallback;
  }
}

/** Présentation surchargée d'un jeu, ou undefined si l'on garde celle du code. */
export function detailsOverride(store: Store, gameId: string): GameDetails | undefined {
  const raw = store.getDetailsOverride(gameId);
  if (!raw) return undefined;
  try {
    const parsed = gameDetailsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Présentation par défaut, telle que définie dans le code du jeu. */
export function defaultDetails(module: GameModule): GameDetails {
  const m = module.manifest;
  return { name: m.name, icon: m.icon, description: m.description };
}

/**
 * Renvoie le jeu avec ses surcharges appliquées. Sans surcharge, renvoie le jeu d'origine.
 * Les états de jeu qui portent un nom et une icône (solo, sous-titres) reçoivent aussi
 * la présentation surchargée à la création de la salle.
 */
export function withOverrides(module: GameModule, store: Store): GameModule {
  const details = detailsOverride(store, module.manifest.id);
  const notice = effectiveNotice(store, module.manifest.id, module.manifest.notice);
  if (!details && notice === module.manifest.notice) return module;

  const name = details?.name ?? module.manifest.name;
  const icon = details?.icon ?? module.manifest.icon;
  const description = details?.description ?? module.manifest.description;
  const initialize = module.initialize;

  return {
    ...module,
    manifest: { ...module.manifest, name, icon, description, notice },
    initialize(settings, players, ctx) {
      const state = initialize.call(module, settings, players, ctx) as unknown;
      if (!details || !state || typeof state !== 'object') return state as ReturnType<typeof initialize>;
      const patch: Record<string, unknown> = {};
      if ('name' in state) patch.name = name;
      if ('icon' in state) patch.icon = icon;
      return { ...state, ...patch } as ReturnType<typeof initialize>;
    },
  };
}
