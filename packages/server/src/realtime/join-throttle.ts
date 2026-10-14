/**
 * Ralentit les codes de salle inconnus, par adresse.
 *
 * Un code à 4 caractères laisse 810 000 combinaisons : sans frein, quelqu'un peut énumérer les
 * salles ouvertes. Le compteur ne retient que les codes DIFFÉRENTS d'une même adresse :
 * - jusqu'à `freeCodes` codes différents en `windowMs`, la réponse est immédiate ;
 * - au-delà, les codes inconnus reçoivent leur réponse à un rythme fixe, un créneau toutes les
 *   `intervalMs`, quel que soit le nombre de connexions ouvertes en parallèle ;
 * - si l'attente dépasse `maxWaitMs`, la tentative est refusée tout de suite.
 *
 * Les connexions réussies ne sont jamais ralenties. Une adresse partagée (réseau d'une salle,
 * passerelle Docker) ne peut donc pas empêcher les autres joueurs d'entrer : seuls les codes
 * inconnus sont freinés.
 */

export interface JoinThrottleOptions {
  /** Codes différents acceptés sans attente, par adresse et par fenêtre. */
  freeCodes: number;
  windowMs: number;
  /** Intervalle entre deux réponses aux codes inconnus, au-delà de la franchise. */
  intervalMs: number;
  /** Attente maximale ; au-delà, la tentative est refusée sans attendre. */
  maxWaitMs: number;
  /** Nombre maximal d'adresses suivies à la fois (protège la mémoire). */
  maxKeys: number;
  now?: () => number;
}

export const JOIN_THROTTLE_DEFAULTS: Omit<JoinThrottleOptions, 'now'> = {
  freeCodes: 50,
  windowMs: 10 * 60_000,
  intervalMs: 2_000,
  maxWaitMs: 30_000,
  maxKeys: 10_000,
};

/** Réponse à une tentative : immédiate, après `wait` ms, ou refusée. */
export type Reservation = { wait: number } | { refused: true };

interface Entry {
  windowStart: number;
  /** Au plus `freeCodes` codes mémorisés : la mémoire reste bornée. */
  seen: Set<string>;
  /** Prochain créneau libre pour une réponse retardée. */
  nextSlot: number;
}

export class JoinThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly options: Required<Omit<JoinThrottleOptions, 'now'>>;
  private readonly now: () => number;

  constructor(options: JoinThrottleOptions) {
    this.options = {
      freeCodes: options.freeCodes,
      windowMs: options.windowMs,
      intervalMs: options.intervalMs,
      maxWaitMs: options.maxWaitMs,
      maxKeys: options.maxKeys,
    };
    this.now = options.now ?? Date.now;
  }

  /** Nombre d'adresses suivies en ce moment (borné par `maxKeys`). */
  get trackedKeys(): number {
    return this.entries.size;
  }

  /** Réserve la réponse à une tentative avec un code inconnu venant de cette adresse. */
  reserve(key: string, code: string): Reservation {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || now - entry.windowStart >= this.options.windowMs) {
      if (!entry) this.makeRoom(now);
      entry = { windowStart: now, seen: new Set(), nextSlot: now };
      this.entries.set(key, entry);
    }

    // Un code déjà vu ne compte pas à nouveau : une salle fermée affichée sur plusieurs téléphones
    // ne ralentit personne.
    if (entry.seen.has(code)) return { wait: 0 };
    if (entry.seen.size < this.options.freeCodes) {
      entry.seen.add(code);
      return { wait: 0 };
    }

    // Au-delà de la franchise : un créneau par intervalle, réservé dans l'ordre d'arrivée.
    const slot = Math.max(now, entry.nextSlot);
    const wait = slot - now;
    if (wait > this.options.maxWaitMs) return { refused: true };
    entry.nextSlot = slot + this.options.intervalMs;
    return { wait };
  }

  /** Libère la place : d'abord les entrées périmées, puis les plus anciennes. */
  private makeRoom(now: number): void {
    if (this.entries.size < this.options.maxKeys) return;
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStart >= this.options.windowMs && entry.nextSlot <= now) {
        this.entries.delete(key);
      }
    }
    while (this.entries.size >= this.options.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
