/**
 * Fonctions pures de la page de test des appareils (micro, caméra, image).
 * Elles ne touchent ni au matériel ni au DOM, ce qui permet de les tester sans navigateur.
 */

/** Message en français pour une erreur de getUserMedia, selon son nom (DOMException). */
export function describeMediaError(err: unknown): string {
  const name =
    err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string'
      ? (err as { name: string }).name
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Accès refusé. Autorisez l’appareil dans les réglages du navigateur (cadenas à côté de l’adresse), puis réessayez.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Aucun appareil de ce type n’a été trouvé.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'L’appareil est utilisé par une autre application. Fermez-la, puis réessayez.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'Cet appareil ne propose pas le réglage demandé (par exemple la caméra arrière).';
    case 'SecurityError':
      return 'Le navigateur bloque l’accès : cette page doit être ouverte en HTTPS (ou sur localhost).';
    case 'AbortError':
      return 'La demande a été interrompue. Réessayez.';
    default:
      return 'Impossible d’accéder à l’appareil sur cette page.';
  }
}

/** Niveau sonore entre 0 et 1, à partir des échantillons d'un AnalyserNode (valeurs 0 à 255, centrées sur 128). */
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

/** Libellé français de l'état d'une autorisation (Permissions API). */
export function permissionLabel(state: string): string {
  switch (state) {
    case 'granted':
      return 'accordée';
    case 'denied':
      return 'refusée';
    case 'prompt':
      return 'à demander';
    default:
      return 'inconnue';
  }
}

/** Taille lisible d'un fichier, en Ko ou Mo. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Message quand le micro ou la caméra ne peuvent pas être demandés. Sur une adresse en HTTP (hors
 * localhost), le navigateur ne propose même pas l'API : le message doit donc dire pourquoi.
 */
export function unavailableMessage(kind: 'micro' | 'caméra', secureContext: boolean): string {
  if (!secureContext) {
    return `Le ${kind} est bloqué parce que la page n’est pas en HTTPS. Ouvrez PartyHub en HTTPS (ou sur localhost) pour l’utiliser.`;
  }
  return `Ce navigateur ne permet pas d’accéder au ${kind}.`;
}
