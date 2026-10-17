import type { GameContext, GameImage } from '@partyhub/shared';
import type { CharacterDraft, RosterDraft } from './schemas.js';

/**
 * Illustrations de l'Aventure IA : un portrait par personnage et un fond par monde. Elles sont demandées pendant le
 * travail de génération (hors moteur), à la bibliothèque d'images partagée (`ctx.images`). Chaque image est
 * optionnelle : sans fournisseur, ou en cas d'échec, le personnage reste dessiné à partir de son nom.
 */

/** Temps maximal pour toutes les illustrations d'une aventure. Au-delà, on continue sans les images manquantes. */
export const ROSTER_IMAGE_BUDGET_MS = 90_000;
/** Illustrations demandées en même temps. */
const CONCURRENCY = 3;

/** Identifiants d'image du monde et des personnages, dans l'ordre de la fiche (null : pas d'image). */
export interface RosterImages {
  backgroundId: string | null;
  portraitIds: (string | null)[];
}

/** Style commun : une illustration de livre d'images, lisible sur un écran partagé, sans texte. */
const STYLE = 'colorful storybook illustration, clean composition, no text, no watermark';

/** Description du portrait d'un personnage : son apparence, à défaut son histoire. */
export function portraitPrompt(character: CharacterDraft, theme: string): string {
  const look = character.look ?? character.backstory;
  return `Bust portrait of a fantasy adventure character named ${character.name}, ${character.title}. Appearance: ${look}. Setting: ${theme}. Single character, centered, plain background, ${STYLE}.`;
}

/** Description du décor d'un monde : sans personnage, pour servir de fond à toutes les scènes. */
export function backgroundPrompt(world: RosterDraft['world'], theme: string): string {
  return `Wide scenic background for an adventure game: ${world.title}. ${world.intro} Mood: ${theme}. No characters, atmospheric, ${STYLE}.`;
}

/** Choisit au hasard dans une liste, avec le générateur du jeu. */
function pickRandom<T>(items: readonly T[], random: () => number): T | null {
  if (items.length === 0) return null;
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))] ?? null;
}

/** Applique `task` à chaque élément, avec au plus `limit` tâches en cours. Garde l'ordre des résultats. */
async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Illustre une aventure. Le fond : une nouvelle image s'ajoute à la bibliothèque du thème tant qu'elle n'est pas pleine ;
 * le monde en prend une, au hasard parmi celles du thème. Les portraits sont générés en parallèle, par petits lots.
 * Renvoie null sans fournisseur d'images. Ne lève pas d'erreur : une image manquante reste null.
 */
export async function generateRosterImages(
  draft: RosterDraft,
  tag: string,
  themeText: string,
  ctx: GameContext,
  signal: AbortSignal,
): Promise<RosterImages | null> {
  const images = ctx.images;
  if (!images || !images.available()) return null;
  const scope = AbortSignal.any([signal, AbortSignal.timeout(ROSTER_IMAGE_BUDGET_MS)]);
  const existing = images.list('fond', tag);

  const backgroundTask = (async (): Promise<GameImage | null> => {
    const created = await images.generate({
      kind: 'fond',
      prompt: backgroundPrompt(draft.world, themeText),
      tag,
      signal: scope,
    });
    return created ?? pickRandom(existing, ctx.random);
  })();
  const portraitTask = mapLimit(draft.characters, CONCURRENCY, (character) =>
    images.generate({
      kind: 'portrait',
      prompt: portraitPrompt(character, themeText),
      tag,
      signal: scope,
    }),
  );

  const [background, portraits] = await Promise.all([backgroundTask, portraitTask]);
  return {
    backgroundId: background?.id ?? null,
    portraitIds: portraits.map((image) => image?.id ?? null),
  };
}
