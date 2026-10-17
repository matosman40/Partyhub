import type { GameContext, GameJob, JobOutcome, RecipeDefinition } from '@partyhub/shared';
import { askAiJson } from '../common/ai-json.js';
import { shuffle } from '../common/engine.js';
import { isAcceptableConsigne } from './moderation.js';

/**
 * Consignes écrites par l'IA pour une recette. Le texte du paquet et le thème sont des données : ils
 * entrent dans la consigne utilisateur, jamais dans les instructions du modèle. La réponse est validée
 * consigne par consigne ; sans assez de consignes valides, le jeu prend celles du paquet.
 */

export const RECIPE_JOB_KIND = 'recette-consignes';

/** Consigne par défaut, quand le paquet n'en donne pas. */
export const DEFAULT_CONSIGNE_TEMPLATE =
  'Thème : {{theme}}. Écris {{nombre}} consignes différentes, drôles et courtes, qui tiennent sur un écran de téléphone.';

const SYSTEM_PROMPT = [
  'Tu écris des consignes pour un jeu de soirée entre amis, en français.',
  'Chaque consigne fait au plus 90 caractères, sans numéro, sans guillemets, sans HTML, sans lien.',
  'Réponds uniquement par un objet JSON de la forme {"consignes": ["…", "…"]}, sans autre texte.',
].join(' ');

export interface RecipeJobInput {
  theme: string;
  nombre: number;
  consigne: string;
}

/** Texte de la demande utilisateur, avec le thème et le nombre remplacés. */
export function buildConsigneRequest(input: RecipeJobInput): string {
  return input.consigne.replaceAll('{{theme}}', input.theme).replaceAll('{{nombre}}', String(input.nombre));
}

/**
 * Lit la réponse de l'IA : une liste de consignes propres (longueur, doublons, retours à la ligne),
 * limitée au nombre demandé. Renvoie une liste vide quand il en manque trop pour être utile.
 */
export function validateConsignes(raw: unknown, nombre: number): string[] {
  const list = (raw as { consignes?: unknown } | null)?.consignes;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (text.length < 3 || text.length > 90 || /[\r\n]/.test(text)) continue;
    if (!isAcceptableConsigne(text)) continue;
    const key = text.toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(text);
    if (valid.length === nombre) break;
  }
  // Au moins la moitié des consignes demandées, sinon le repli du paquet vaut mieux.
  return valid.length * 2 >= nombre ? valid : [];
}

/** Travail exécuté hors du moteur : une demande à l'IA. Null quand aucun fournisseur n'est configuré. */
export async function runConsignesJob(job: GameJob, ctx: GameContext, signal: AbortSignal): Promise<string[] | null> {
  const input = job.input as RecipeJobInput;
  const raw = await askAiJson(
    ctx,
    { system: SYSTEM_PROMPT, user: buildConsigneRequest(input), maxTokens: 700 },
    signal,
  );
  if (raw === null) return null;
  return validateConsignes(raw, input.nombre);
}

/** Choix des consignes d'après le résultat du travail : IA, ou repli du paquet, avec la raison affichée. */
export function consignesFromOutcome(
  outcome: JobOutcome,
  fallback: string[],
  random: () => number,
  nombre: number,
): { consignes: string[]; notice: string | null } {
  const generated = outcome.ok ? (outcome.value as string[] | null) : null;
  if (generated && generated.length > 0) {
    return { consignes: shuffle(generated, random).slice(0, nombre), notice: null };
  }
  const notice =
    outcome.ok && outcome.value === null
      ? 'IA non configurée : consignes du paquet.'
      : 'L’IA n’a pas pu écrire les consignes : consignes du paquet.';
  return { consignes: fallback, notice };
}

/** Travail demandé à la salle pour un paquet dont l'IA est configurée. */
export function consigneJob(id: string, definition: RecipeDefinition): GameJob | null {
  if (!definition.ai) return null;
  return {
    id,
    kind: RECIPE_JOB_KIND,
    input: {
      theme: definition.ai.theme,
      nombre: definition.ai.nombre,
      consigne: definition.ai.consigne ?? DEFAULT_CONSIGNE_TEMPLATE,
    } satisfies RecipeJobInput,
  };
}
