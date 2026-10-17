import type { GameContext } from '@partyhub/shared';

/**
 * Lecture des réponses JSON de l'IA, partagée par les jeux qui génèrent du contenu (Aventure, Quiz à thème,
 * Phrases à trous). Les messages d'erreur ne reprennent jamais le contenu renvoyé par le modèle.
 */

/**
 * Extrait l'objet JSON d'une réponse, même entourée de texte ou de balises.
 */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Réponse sans objet JSON.');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Réponse JSON illisible.');
  }
}

/**
 * Demande une réponse JSON au client d'IA de la salle. Renvoie null quand aucun fournisseur n'est configuré :
 * le jeu prend alors son contenu de secours, sans erreur. Une réponse hors format lève une erreur.
 */
export async function askAiJson(
  ctx: GameContext,
  request: { system: string; user: string; maxTokens: number },
  signal: AbortSignal,
): Promise<unknown | null> {
  if (!ctx.ai || (ctx.ai.available && !ctx.ai.available())) return null;
  const text = await ctx.ai.complete({ ...request, signal });
  return parseJsonObject(text);
}
