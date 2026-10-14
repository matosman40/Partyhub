/** Paramètre du fragment d'adresse qui porte la place partagée (#place=JETON). */
export const SHARED_PLACE_PARAM = 'place';

/** Jeton de place présent dans un fragment d'adresse, ou null. Format : lettres, chiffres, _ et -. */
export function sharedPlaceToken(hash: string): string | null {
  const match = new RegExp(`[#&]${SHARED_PLACE_PARAM}=([A-Za-z0-9_-]{8,200})`).exec(hash);
  return match ? match[1]! : null;
}
