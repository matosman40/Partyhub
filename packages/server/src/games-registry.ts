import { findGame, gameRegistry } from '@partyhub/games';
import type { GameModule } from '@partyhub/shared';

/**
 * Registre complet du serveur : jeux intégrés (code) et jeux créés dans l'administration
 * (base de données) : jeux de cartes et jeux de questions médias. Chaque source remplace
 * ses jeux en bloc à chaque modification via `setCustomGames`.
 */
export type CustomSource = 'cards' | 'media' | 'packages' | 'boards';

const customBySource = new Map<CustomSource, Map<string, GameModule>>();

export function setCustomGames(source: CustomSource, modules: GameModule[]): void {
  customBySource.set(source, new Map(modules.map((m) => [m.manifest.id, m])));
}

function customGames(): GameModule[] {
  return [...customBySource.values()].flatMap((games) => [...games.values()]);
}

export function resolveGame(id: string): GameModule | undefined {
  if (findGame(id)) return findGame(id);
  for (const games of customBySource.values()) {
    const found = games.get(id);
    if (found) return found;
  }
  return undefined;
}

/** Table qui porte un jeu : code de l'application (« builtin ») ou source administrée. */
export function sourceOf(id: string): CustomSource | 'builtin' | undefined {
  if (findGame(id)) return 'builtin';
  for (const [source, games] of customBySource) {
    if (games.has(id)) return source;
  }
  return undefined;
}

export function allGames(): GameModule[] {
  return [...gameRegistry, ...customGames()];
}
