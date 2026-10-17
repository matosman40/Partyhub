/**
 * Contrôle des consignes écrites par l'IA, avant qu'elles n'atteignent les écrans des joueurs. Deux filtres :
 * - structurel : pas d'adresse web ni d'adresse e-mail, pas de balise ni de caractère de mise en forme ;
 * - lexical : une liste courte de termes refusés, comparée mot à mot, sans accents ni casse.
 *
 * La liste ci-dessous est un point de départ. Elle doit être relue par la personne qui publie avant une sortie
 * publique. Elle ne couvre pas les textes des joueurs, qui ne passent pas par l'IA (voir docs/PHGAME.md).
 */

/** Termes refusés, sous leur forme normalisée (minuscules, sans accents). */
const BLOCKED_WORDS: ReadonlySet<string> = new Set([
  // Insultes et injures
  'pute',
  'putes',
  'salope',
  'salopes',
  'connard',
  'connards',
  'connasse',
  'connasses',
  'encule',
  'encules',
  'enculer',
  'enculee',
  'enculees',
  'nique',
  'niquer',
  'niquez',
  'niquent',
  'bite',
  'bites',
  // Termes racistes et homophobes
  'negre',
  'negres',
  'negresse',
  'bougnoule',
  'bougnoules',
  'youpin',
  'youpins',
  'pede',
  'pedes',
  'pedale',
  'pedales',
  'nazi',
  'nazis',
  'nazie',
  'nazies',
  // Violence sexuelle, pornographie
  'viol',
  'viols',
  'violer',
  'violeur',
  'violeurs',
  'violee',
  'violees',
  'porno',
  'pornos',
  'pornographie',
  // Suicide et automutilation : jamais un sujet de consigne
  'suicide',
  'suicider',
  'suicidaire',
]);

/** Adresses web, adresses e-mail, balises et caractères de mise en forme. */
const STRUCTURE = /https?:\/\/|www\.|@|[<>{}[\]`\\]|\b[a-z0-9-]+\.(fr|com|net|org|io|be|ch|ca|info)\b/i;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Vrai quand la consigne peut être montrée aux joueurs. */
export function isAcceptableConsigne(text: string): boolean {
  if (STRUCTURE.test(text)) return false;
  return !normalize(text)
    .split(/[^a-z0-9]+/)
    .some((word) => BLOCKED_WORDS.has(word));
}
