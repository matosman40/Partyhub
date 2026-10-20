/**
 * Gestes tactiles des défis : glisser, pincer et lancer. Ces fonctions sont pures : elles ne touchent ni à l’écran
 * ni au DOM, donc elles se testent sans navigateur. Les composants (`phone-games-touch.tsx`) les appellent à chaque
 * événement de pointeur.
 */

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/** Distance minimale, en pixels, pour qu’un mouvement compte comme un glissé. */
export const SWIPE_MIN_PX = 40;

/** Direction dominante d’un glissé de (dx, dy) pixels, ou null si le mouvement est trop court. */
export function swipeDirection(dx: number, dy: number, minPx = SWIPE_MIN_PX): SwipeDirection | null {
  if (Math.hypot(dx, dy) < minPx) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export interface Point {
  x: number;
  y: number;
}

/** Écart entre deux doigts, en pixels. */
export function pinchGap(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Taille du pincement : son écart rapporté à un écart de référence (1 = la taille de départ). */
export function pinchScale(gap: number, reference: number): number {
  return reference > 0 ? gap / reference : 0;
}

/** Vrai si la taille est à moins de `tolerance` (en proportion de la cible) de la taille demandée. */
export function atScale(scale: number, target: number, tolerance = 0.08): boolean {
  return Math.abs(scale - target) <= tolerance * target;
}

export interface TimedPoint extends Point {
  /** Instant de la mesure, en millisecondes (horloge croissante). */
  t: number;
}

/**
 * Vitesse verticale vers le haut du dernier mouvement, en hauteurs d’écran par seconde. Seuls les points des
 * `windowMs` précédant le relâchement comptent. Un doigt qui descend, ou qui ne bouge pas, donne zéro ou moins.
 */
export function flickSpeed(points: readonly TimedPoint[], height: number, windowMs = 120): number {
  if (points.length < 2 || height <= 0) return 0;
  const last = points[points.length - 1]!;
  let first = last;
  for (let i = points.length - 2; i >= 0; i--) {
    const candidate = points[i]!;
    if (last.t - candidate.t > windowMs) break;
    first = candidate;
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return ((first.y - last.y) / height) * (1000 / dt);
}
