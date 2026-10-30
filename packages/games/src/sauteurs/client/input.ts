import type { SensorSample } from '@partyhub/shared';
import type { PlayerInput } from '../engine.js';

/**
 * Codage des commandes sur le canal capteurs : `x` = axe horizontal (-1, 0, 1), `y` réservé (0),
 * `energy` = 1 si le saut est maintenu. Un échantillon plus vieux que `SENSOR_FRESH_MS` est ignoré :
 * un téléphone qui se tait ne laisse pas son coureur courir seul.
 */
export const SENSOR_FRESH_MS = 450;
/** Seuil de l'axe au-delà duquel on court. */
export const AXIS_THRESHOLD = 0.5;
/** Seuil d'énergie au-delà duquel le saut est maintenu (spécification : > 0,5). */
export const JUMP_THRESHOLD = 0.5;

export const NO_INPUT: Readonly<PlayerInput> = Object.freeze({ left: false, right: false, jump: false });

export interface TimedSample extends SensorSample {
  /** Instant de réception (performance.now). */
  at: number;
}

/** Échantillon capteur -> commandes du moteur. Absent ou périmé : repos. */
export function sampleToInput(sample: TimedSample | undefined, now: number, out?: PlayerInput): PlayerInput {
  const o = out ?? { left: false, right: false, jump: false };
  if (!sample || now - sample.at > SENSOR_FRESH_MS) {
    o.left = false;
    o.right = false;
    o.jump = false;
    return o;
  }
  o.left = sample.x < -AXIS_THRESHOLD;
  o.right = sample.x > AXIS_THRESHOLD;
  o.jump = sample.energy > JUMP_THRESHOLD;
  return o;
}

/** Boutons tenus sur le téléphone -> échantillon à envoyer. */
export function controlsToSample(held: { left: boolean; right: boolean; jump: boolean }): SensorSample {
  const x = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  return { x, y: 0, energy: held.jump ? 1 : 0 };
}

export function sameSample(a: SensorSample | null, b: SensorSample): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.energy === b.energy;
}

/** Fusionne deux sources de commandes (téléphone et clavier) : un bouton tenu par l'une suffit. */
export function mergeInputs(a: PlayerInput, b: PlayerInput, out: PlayerInput): PlayerInput {
  out.left = a.left || b.left;
  out.right = a.right || b.right;
  out.jump = a.jump || b.jump;
  if (out.left && out.right) {
    out.left = false;
    out.right = false;
  }
  return out;
}

/** Touches du repli clavier : flèches ou WASD (ZQSD) pour courir, espace (ou haut / W / Z) pour sauter. */
export function keyRole(code: string): 'left' | 'right' | 'jump' | null {
  switch (code) {
    case 'ArrowLeft':
    case 'KeyA':
    case 'KeyQ':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
    case 'Space':
    case 'ArrowUp':
    case 'KeyW':
    case 'KeyZ':
      return 'jump';
    default:
      return null;
  }
}

/** Touches tenues, mises à jour par les événements clavier. */
export class KeyboardState {
  readonly held = { left: false, right: false, jump: false };
  /** Renvoie vrai si la touche est l'une des commandes (pour empêcher le défilement de la page). */
  set(code: string, down: boolean): boolean {
    const role = keyRole(code);
    if (!role) return false;
    this.held[role] = down;
    return true;
  }
  reset(): void {
    this.held.left = this.held.right = this.held.jump = false;
  }
  read(out: PlayerInput): PlayerInput {
    out.left = this.held.left && !this.held.right;
    out.right = this.held.right && !this.held.left;
    out.jump = this.held.jump;
    return out;
  }
}
