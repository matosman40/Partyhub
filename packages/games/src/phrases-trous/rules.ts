import { normalizeText } from '../common/engine.js';

/**
 * Règles pures des phrases à trous : remplir le trou, distribuer les mains, comparer une carte à la réponse.
 * Aucune horloge ni aléatoire réel ici : le générateur est toujours injecté.
 */

export const BLANK = '___';

/** Phrase avec sa carte posée à la place du trou. */
export function fillSentence(sentence: string, card: string): string {
  return sentence.split(BLANK).join(card);
}

/** Vrai quand une carte complète le trou, sans tenir compte de la casse, des accents ni de la ponctuation. */
export function completesHole(card: string, answer: string): boolean {
  const a = normalizeText(answer);
  return a !== '' && normalizeText(card) === a;
}

/**
 * Complète la main d'un joueur jusqu'à `size` cartes, en évitant les doublons tant que le paquet le permet.
 * Les cartes déjà en main sont conservées : seules les cartes manquantes sont piochées.
 */
export function dealHand(pool: string[], size: number, random: () => number, hand: string[] = []): string[] {
  const out = [...hand];
  while (out.length < size && pool.length > 0) {
    const free = pool.filter((card) => !out.includes(card));
    const source = free.length > 0 ? free : pool;
    out.push(source[Math.floor(random() * source.length)]!);
  }
  return out;
}

/** Retire une occurrence de la carte jouée. Renvoie la main sans modifier l'original. */
export function removeCard(hand: string[], card: string): string[] {
  const index = hand.indexOf(card);
  if (index < 0) return hand;
  return [...hand.slice(0, index), ...hand.slice(index + 1)];
}
