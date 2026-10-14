/**
 * Préférence « plateau en 3D » et détection WebGL.
 * Le choix est mémorisé dans cet navigateur seulement ; sans stockage, on garde la 3D par défaut.
 */

const KEY = 'ph:board3d';

let webgl: boolean | null = null;

/** Vrai si le navigateur peut créer un contexte WebGL (calculé une seule fois). */
export function supportsWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const canvas = document.createElement('canvas');
    webgl = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    webgl = false;
  }
  return webgl;
}

export function read3DPreference(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function write3DPreference(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Stockage indisponible (navigation privée, données bloquées) : le choix vaut pour cette page seulement.
  }
}
