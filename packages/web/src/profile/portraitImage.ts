import { PORTRAIT_MAX_BYTES, PORTRAIT_SEND_SIZE } from '@partyhub/shared';

/**
 * Réduction de la photo de portrait avant envoi : côté le plus long limité, image redessinée dans un canvas
 * puis exportée en JPEG. Le redessin supprime les métadonnées (EXIF, position GPS…).
 */

/** Dimensions après réduction : le côté le plus long vaut au plus `max`, jamais d’agrandissement. */
export function fitDimensions(
  width: number,
  height: number,
  max: number = PORTRAIT_SEND_SIZE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const ratio = max / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** Taille décodée (en octets) d’une data URL en base64. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export const PORTRAIT_TOO_HEAVY = 'Cette photo reste trop lourde. Essayez une photo plus petite.';

/** Redessine une source d’image réduite et l’exporte en JPEG (qualité 0,85, moins si la photo reste lourde). */
export function sourceToPortraitDataUrl(source: CanvasImageSource, width: number, height: number): string {
  const size = fitDimensions(width, height);
  if (size.width === 0) throw new Error('Cette image ne peut pas être lue. Essayez un autre fichier.');
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Impossible de préparer l’image sur cet appareil.');
  // Fond blanc : un PNG transparent ne devient pas noir en JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(source, 0, 0, size.width, size.height);
  for (const quality of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(url) <= PORTRAIT_MAX_BYTES) return url;
  }
  throw new Error(PORTRAIT_TOO_HEAVY);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Cette image ne peut pas être lue. Essayez un autre fichier.'));
    };
    img.src = url;
  });
}

/** Photo choisie → data URL JPEG réduite, prête à être envoyée. */
export async function fileToPortraitDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez un fichier image.');
  const img = await loadImage(file);
  return sourceToPortraitDataUrl(img, img.naturalWidth, img.naturalHeight);
}
