import { normalizeText, shuffle } from '../common/engine.js';
import { BLANK } from './rules.js';

/**
 * Phrases de secours : utilisées quand l’IA n’est pas configurée, injoignable ou répond hors format. Chaque phrase a
 * un seul trou et une réponse. Les cartes de leurre ne complètent pas bien les trous : elles font rire quand on les
 * pose. Les mots-clés ne sont pas utilisés ici, mais le jeu le dit à l’écran principal.
 */

export interface PhraseRound {
  sentence: string;
  answer: string;
}

/** Nombre minimal de cartes différentes pour distribuer des mains sans tout répéter. */
export const CURATED_CARDS_MIN = 8;

export interface PhraseContent {
  rounds: PhraseRound[];
  /** Toutes les cartes du jeu : les réponses et les leurres, sans doublon. */
  pool: string[];
}

const CURATED: PhraseRound[] = [
  { sentence: `Au petit-déjeuner, le chat a renversé son bol de ${BLANK}.`, answer: 'lait' },
  { sentence: `Pour réussir le gâteau, il ne faut pas oublier la pincée de ${BLANK}.`, answer: 'sel' },
  { sentence: `Le détective a trouvé une empreinte de ${BLANK} sur la scène du crime.`, answer: 'botte' },
  { sentence: `Dans l’espace, l’astronaute a planté un drapeau sur la ${BLANK}.`, answer: 'Lune' },
  { sentence: `Le volcan s’est réveillé et a craché de la ${BLANK}.`, answer: 'lave' },
  { sentence: `Pour éloigner les moustiques, rien ne vaut un peu de ${BLANK}.`, answer: 'citronnelle' },
  { sentence: `Le maître-nageur a sifflé : « Pas de ${BLANK} au bord du bassin ! »`, answer: 'course' },
  { sentence: `Le pirate a enterré son trésor au pied d’un ${BLANK}.`, answer: 'palmier' },
  { sentence: `Pour le dîner, grand-mère a préparé un ${BLANK} de légumes.`, answer: 'gratin' },
  { sentence: `Le facteur est arrivé en ${BLANK} sur son vélo.`, answer: 'retard' },
  { sentence: `La météo annonce de la neige sur les ${BLANK}.`, answer: 'Alpes' },
  { sentence: `Au zoo, le gardien nourrit les ${BLANK} à midi pile.`, answer: 'otaries' },
];

const DECOYS = [
  'pantoufle',
  'saxophone',
  'crocodile',
  'cornichon',
  'parapluie',
  'brocoli',
  'tuba',
  'chaussette',
  'ananas',
  'trompette',
  'kangourou',
  'soupe',
  'yaourt',
  'casserole',
  'moustache',
  'fromage',
];

/** Dédoublonne en gardant la première forme, sans tenir compte de la casse ni des accents. */
export function uniqueCards(cards: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of cards) {
    const key = normalizeText(card);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

/** Contenu de secours : tirage au hasard parmi les phrases écrites à l’avance, avec des leurres. */
export function curatedContent(count: number, random: () => number): PhraseContent {
  const rounds = shuffle(CURATED, random).slice(0, Math.min(count, CURATED.length));
  const decoys = shuffle(DECOYS, random).slice(0, 12);
  return { rounds, pool: uniqueCards([...rounds.map((r) => r.answer), ...decoys]) };
}

/** Leurres écrits à l’avance qui ne figurent pas encore dans `have`, pour compléter un paquet trop mince. */
export function spareDecoys(have: string[]): string[] {
  const taken = new Set(have.map(normalizeText));
  return DECOYS.filter((card) => !taken.has(normalizeText(card)));
}

/** Phrases de secours non encore utilisées, pour compléter une réponse de l’IA trop courte. */
export function spareCurated(used: PhraseRound[], count: number): PhraseRound[] {
  const usedKeys = new Set(used.map((r) => normalizeText(r.sentence)));
  return CURATED.filter((r) => !usedKeys.has(normalizeText(r.sentence))).slice(0, count);
}
