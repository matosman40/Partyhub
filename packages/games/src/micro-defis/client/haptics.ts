/**
 * Vibration du téléphone (API Vibration). Elle n’existe pas partout : sur iPhone, Safari ne la propose pas, et le
 * défi affiche alors le même motif à l’écran. Sans effet, sans erreur, quand elle est absente.
 */

/** Vrai si ce navigateur sait faire vibrer le téléphone. */
export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Fait vibrer le téléphone `ms` millisecondes. Ne fait rien si la vibration n’est pas disponible. */
export function vibrate(ms: number): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Certains navigateurs refusent la vibration hors geste de l’utilisateur : le défi continue sans elle.
  }
}
