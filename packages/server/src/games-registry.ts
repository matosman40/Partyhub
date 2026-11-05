import { findGame, gameRegistry } from '@partyhub/games';
import type { GameModule } from '@partyhub/shared';

/**
 * Registre complet du serveur : jeux intégrés (code) et jeux créés dans l’administration
 * (base de données) : jeux de cartes et jeux de questions médias. Chaque source remplace
 * ses jeux en bloc à chaque modification via `setCustomGames`.
 */
export type CustomSource = 'cards' | 'media' | 'packages' | 'boards' | 'code';

const customBySource = new Map<CustomSource, Map<string, GameModule>>();

export function setCustomGames(source: CustomSource, modules: GameModule[]): void {
  customBySource.set(source, new Map(modules.map((m) => [m.manifest.id, m])));
}

function customGames(): GameModule[] {
  return [...customBySource.values()].flatMap((games) => [...games.values()]);
}

/**
 * Jeux intégrés dont un paquet de code prend la place (migration vers le magasin). Pour ces identifiants, le paquet
 * actif remplace le jeu intégré : il est résolu d'abord, et le jeu intégré revient quand le paquet est retiré.
 * Chaque étape de la migration ajoute ici ses jeux. Liste vide : rien ne remplace rien.
 */
export const MIGRATED_BUILTIN_IDS: ReadonlySet<string> = new Set(['plus-ou-moins']);

/** Identifiants des jeux de code actifs qui remplacent un jeu intégré. */
function replacedIds(): Set<string> {
  const code = customBySource.get('code');
  return new Set([...(code?.keys() ?? [])].filter((id) => findGame(id)));
}

export function resolveGame(id: string): GameModule | undefined {
  // Un paquet de code actif passe avant le jeu intégré du même identifiant.
  const replaced = customBySource.get('code')?.get(id);
  if (replaced) return replaced;
  if (findGame(id)) return findGame(id);
  for (const games of customBySource.values()) {
    const found = games.get(id);
    if (found) return found;
  }
  return undefined;
}

/** Table qui porte un jeu : code de l’application (« builtin ») ou source administrée. */
export function sourceOf(id: string): CustomSource | 'builtin' | undefined {
  if (customBySource.get('code')?.has(id)) return 'code';
  if (findGame(id)) return 'builtin';
  for (const [source, games] of customBySource) {
    if (games.has(id)) return source;
  }
  return undefined;
}

export function allGames(): GameModule[] {
  const replaced = replacedIds();
  return [...gameRegistry.filter((game) => !replaced.has(game.manifest.id)), ...customGames()];
}
