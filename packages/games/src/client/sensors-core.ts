/**
 * Détection des gestes à partir des capteurs du téléphone. Aucune fonction ici ne touche au matériel
 * ni au DOM : tout se teste sans navigateur. Les hooks qui branchent ces fonctions sur les événements
 * sont dans `sensors.ts`.
 */

/** Inclinaison (en degrés) qui correspond au bord de l’échelle : ±1. */
export const TILT_FULL_DEG = 35;

export interface Point {
  x: number;
  y: number;
}

export interface Neutral {
  beta: number;
  gamma: number;
}

const clampUnit = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * Inclinaison relative à la pose de départ (la « pose neutre »), de -1 à 1 sur chaque axe.
 * `gamma` : gauche / droite. `beta` : avant / arrière. Le téléphone est tenu comme au moment du calibrage.
 */
export function tiltFrom(beta: number, gamma: number, neutral: Neutral): Point {
  return {
    x: clampUnit((gamma - neutral.gamma) / TILT_FULL_DEG),
    y: clampUnit((beta - neutral.beta) / TILT_FULL_DEG),
  };
}

/** Distance angulaire signée entre deux angles (en degrés), ramenée dans [-180, 180[. */
export function angleDelta(prev: number, next: number): number {
  return ((((next - prev) % 360) + 540) % 360) - 180;
}

/**
 * Rotation du téléphone à plat (axe `alpha`, cap), mesurée comme une rotation nette : un tour complet se fait
 * dans un sens (ou dans l’autre), et un aller-retour revient à zéro. Les petits bruits (moins d’un degré) sont
 * ignorés. `feed` renvoie la valeur absolue de la rotation nette, en degrés.
 */
export class SpinTracker {
  private prev: number | null = null;
  private net = 0;

  feed(alpha: number): number {
    if (this.prev === null) {
      this.prev = alpha;
      return 0;
    }
    const step = angleDelta(this.prev, alpha);
    if (Math.abs(step) >= 1) {
      this.net += step;
      this.prev = alpha;
    }
    return Math.abs(this.net);
  }

  get degrees(): number {
    return Math.abs(this.net);
  }

  reset(): void {
    this.prev = null;
    this.net = 0;
  }
}

/**
 * Impulsions (secousses, tapotements) : chaque impulsion compte, après un délai minimal, et fait monter
 * une énergie qui retombe peu à peu. L’énergie sert à montrer l’effort en direct (de 0 à 1).
 */
export class Pulses {
  count = 0;
  energy = 0;
  private last = Number.NEGATIVE_INFINITY;
  private at = 0;

  constructor(
    private readonly cooldownMs: number,
    private readonly halfLifeMs = 450,
    private readonly gain = 0.25,
  ) {}

  /** Fait retomber l’énergie jusqu’à l’instant `t` (millisecondes, horloge quelconque mais croissante). */
  tick(t: number): void {
    const dt = Math.max(0, t - this.at);
    this.energy *= Math.pow(0.5, dt / this.halfLifeMs);
    this.at = t;
  }

  /** Enregistre une impulsion à l’instant `t`. Renvoie vrai si elle a été comptée. */
  hit(t: number): boolean {
    this.tick(t);
    if (t - this.last < this.cooldownMs) return false;
    this.last = t;
    this.count += 1;
    this.energy = Math.min(1, this.energy + this.gain);
    return true;
  }

  reset(): void {
    this.count = 0;
    this.energy = 0;
    this.last = Number.NEGATIVE_INFINITY;
    this.at = 0;
  }
}

/** Vrai si au moins une composante de la mesure est un nombre (certains navigateurs renvoient des `null`). */
function hasReading(a: { x: number | null; y: number | null; z: number | null } | null | undefined): a is {
  x: number | null;
  y: number | null;
  z: number | null;
} {
  return !!a && [a.x, a.y, a.z].some((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Intensité d’une accélération en trois axes (les composantes absentes comptent pour zéro). */
function magnitudeOf(a: { x: number | null; y: number | null; z: number | null }): number {
  const x = a.x ?? 0;
  const y = a.y ?? 0;
  const z = a.z ?? 0;
  return Math.sqrt(x * x + y * y + z * z);
}

/** Pesanteur terrestre, en m/s². */
export const GRAVITY = 9.81;

/**
 * Accélération linéaire (sans la pesanteur), en m/s². Quand le téléphone ne la donne pas (ou ne donne que des
 * valeurs vides), on retire la pesanteur à la mesure brute : le repos donne alors zéro, une secousse une valeur élevée.
 */
export function shakeMagnitude(e: {
  acceleration?: { x: number | null; y: number | null; z: number | null } | null;
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null;
}): number | null {
  if (hasReading(e.acceleration)) return magnitudeOf(e.acceleration);
  if (hasReading(e.accelerationIncludingGravity)) {
    return Math.abs(magnitudeOf(e.accelerationIncludingGravity) - GRAVITY);
  }
  return null;
}

/**
 * Secousses : une impulsion est comptée à chaque franchissement du seuil vers le haut
 * (accélération linéaire, sans la pesanteur, en m/s²).
 */
export class ShakeDetector {
  private above = false;
  readonly pulses: Pulses;

  constructor(
    private readonly threshold = 12,
    cooldownMs = 160,
  ) {
    this.pulses = new Pulses(cooldownMs);
  }

  feed(magnitude: number, t: number): boolean {
    this.pulses.tick(t);
    const over = magnitude >= this.threshold;
    let counted = false;
    if (over && !this.above) counted = this.pulses.hit(t);
    this.above = over;
    return counted;
  }

  reset(): void {
    this.above = false;
    this.pulses.reset();
  }
}

/**
 * Maintien : le temps passé sans interruption dans une zone. Sortir de la zone remet le compteur à zéro.
 */
export class HoldTimer {
  private since: number | null = null;
  private heldMs = 0;

  /** Donne l’état courant à l’instant `t` ; renvoie la durée maintenue (ms). */
  feed(inside: boolean, t: number): number {
    if (!inside) {
      this.since = null;
      this.heldMs = 0;
      return 0;
    }
    if (this.since === null) this.since = t;
    this.heldMs = t - this.since;
    return this.heldMs;
  }

  get held(): number {
    return this.heldMs;
  }

  reset(): void {
    this.since = null;
    this.heldMs = 0;
  }
}

/** Niveau sonore entre 0 et 1, à partir des échantillons d’un AnalyserNode (valeurs 0 à 255, centrées sur 128). */
export function levelFromBytes(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i]! - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * 3);
}

/**
 * Envoi limité en débit : `offer` renvoie vrai quand l’échantillon doit partir (au plus `hz` par seconde).
 * Le temps est passé en paramètre, donc le calcul reste testable.
 */
export class Throttle {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly hz: number) {}

  offer(t: number): boolean {
    if (t - this.last < 1000 / this.hz) return false;
    this.last = t;
    return true;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}
