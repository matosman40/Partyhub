/**
 * Funambule : une ligne tendue au-dessus de la scène, un funambule par joueur. Le téléphone est le balancier :
 * il penche pour contrer le vent, et le personnage tombe quand il ne tient plus l’équilibre.
 *
 * Ce fichier est pur (ni DOM ni matériel) : le serveur, le téléphone et l’écran principal s’y réfèrent, et les
 * tests le vérifient sans navigateur. Le vent ne dépend que du temps écoulé depuis le début de la traversée et
 * d’une graine tirée par manche : le téléphone et l’écran principal calculent donc la même valeur.
 */

/** Durée d’une traversée, en millisecondes. */
export const WALK_MS = 12_000;
/** Marge après la fin de la traversée : une réponse peut arriver après l’horloge du serveur. */
export const GRACE_MS = 1500;
/** Délai pendant lequel le personnage doit rester hors d’équilibre avant de tomber (évite les faux départs). */
export const FALL_HOLD_MS = 350;
/** Tolérance réseau, comme pour les micro-défis. */
export const LATENCY_SLACK_MS = 400;
/** Points : proportionnels au temps tenu, plus une prime pour la traversée complète. */
export const WALK_POINTS = 100;
export const CROSSING_BONUS = 50;

const TAU = Math.PI * 2;
const frac = (x: number): number => x - Math.floor(x);

/**
 * Gain de l’inclinaison : le téléphone penché à fond (35°) compense un vent de 1,4 fois la limite de l’échelle.
 * Sans ce gain, une rafale plus forte que l’échelle ne pourrait jamais être contrée.
 */
export const TILT_GAIN = 1.4;

/**
 * Force du vent d’une manche (la crête du vent vaut environ 1,15 fois cette force).
 * La première manche est calme ; à partir de la quatrième, un personnage immobile tombe.
 */
export function windStrength(round: number): number {
  return Math.min(1.2, 0.75 + 0.1 * round);
}

/** Libellé court de la force du vent, pour l’écran principal et le téléphone. */
export function windLabel(strength: number): string {
  if (strength < 0.85) return 'Vent léger';
  if (strength < 1.05) return 'Vent soutenu';
  return 'Vent violent';
}

/**
 * Vent à l’instant `t` (ms depuis le début de la traversée), entre -1,25 et 1,25 (positif : vers la droite).
 * Deux vagues de périodes différentes : le vent ne se répète pas d’un coup, il faut anticiper.
 */
export function windAt(t: number, strength: number, seed: number): number {
  const p1 = TAU * seed;
  const p2 = TAU * frac(seed * 2.618);
  return strength * (0.7 * Math.sin((TAU * t) / 3200 + p1) + 0.45 * Math.sin((TAU * t) / 1700 + p2));
}

/**
 * Position du personnage : l’inclinaison du téléphone (de -1 à 1, multipliée par `TILT_GAIN`) plus le vent.
 * Au-delà de ±1, le personnage est hors d’équilibre. La valeur n’est pas bornée : l’affichage la borne à ±1.
 */
export function leanOf(tilt: number, wind: number): number {
  return tilt * TILT_GAIN + wind;
}

/**
 * Détecte la chute : le personnage doit rester hors d’équilibre pendant `FALL_HOLD_MS`. La chute est datée du
 * premier instant de déséquilibre, qui est le temps tenu sur le fil.
 */
export class FallDetector {
  private since: number | null = null;
  private fallenAt: number | null = null;

  /** Donne la position à l’instant `t` (ms depuis le début) ; renvoie le temps tenu une fois tombé, sinon null. */
  feed(lean: number, t: number): number | null {
    if (this.fallenAt !== null) return this.fallenAt;
    if (Math.abs(lean) < 1) {
      this.since = null;
      return null;
    }
    if (this.since === null) this.since = t;
    if (t - this.since >= FALL_HOLD_MS) this.fallenAt = this.since;
    return this.fallenAt;
  }

  get fallen(): boolean {
    return this.fallenAt !== null;
  }

  reset(): void {
    this.since = null;
    this.fallenAt = null;
  }
}

export interface WalkJudgement {
  /** Temps tenu sur le fil, en millisecondes, borné par la traversée et par le temps écoulé côté serveur. */
  survived: number;
  success: boolean;
  points: number;
}

/**
 * Juge le temps envoyé par le téléphone. `elapsedMs` est le temps écoulé côté serveur depuis le début de la
 * traversée, à la réception. Le temps tenu ne peut pas dépasser ce qui s’est réellement écoulé.
 */
export function judgeWalk(value: number, elapsedMs: number): WalkJudgement {
  const ceiling = Math.max(0, elapsedMs) + LATENCY_SLACK_MS;
  const survived = Math.max(0, Math.min(value, WALK_MS, ceiling));
  const success = survived >= WALK_MS;
  const points = Math.round((WALK_POINTS * survived) / WALK_MS) + (success ? CROSSING_BONUS : 0);
  return { survived: Math.round(survived), success, points };
}

/** Ramène une valeur dans [-1, 1] (l’échelle des capteurs). */
export function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Crête du vent d’une force donnée : le vent ne dépasse jamais cette valeur (voir `windAt`). */
export function windPeak(strength: number): number {
  return 1.15 * strength;
}
