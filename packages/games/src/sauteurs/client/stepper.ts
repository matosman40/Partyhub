/** Pas fixe de 1/60 s alimenté par des durées d'image variables. */
export const STEP_MS = 1000 / 60;
/** Au plus ce nombre de pas par image : après un onglet en veille, on ne rattrape pas des secondes d'un coup. */
export const MAX_STEPS_PER_FRAME = 5;
/** Plus longue durée d'image prise en compte (ms). */
export const MAX_FRAME_MS = 250;

export class FixedStepper {
  private acc = 0;
  /** Ajoute le temps écoulé et renvoie le nombre de pas à simuler (le reste est gardé pour l'image suivante). */
  push(dtMs: number): number {
    this.acc += Math.min(MAX_FRAME_MS, Math.max(0, dtMs));
    let n = 0;
    while (this.acc >= STEP_MS && n < MAX_STEPS_PER_FRAME) {
      this.acc -= STEP_MS;
      n++;
    }
    // Retard qu'on n'arrivera pas à rattraper : on l'abandonne plutôt que de s'y enfoncer.
    if (n === MAX_STEPS_PER_FRAME && this.acc > STEP_MS) this.acc = this.acc % STEP_MS;
    return n;
  }
  /** Part d'un pas déjà écoulée, de 0 à 1 (pour interpoler l'affichage). */
  get alpha(): number {
    return this.acc / STEP_MS;
  }
  reset(initialMs = 0): void {
    this.acc = Math.min(initialMs, MAX_FRAME_MS);
  }
}
