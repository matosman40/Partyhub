/**
 * Photo de profil : carré centré (jusqu’à 256 px), encodé en JPEG assez léger pour le serveur
 * (60 000 caractères au plus). Vient d’un fichier choisi ou d’une image de la webcam.
 */
const MAX_CHARS = 60_000;

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

/**
 * Encode une source d’image (photo ou image vidéo) en data URL de profil. `mirror` retourne l’image
 * comme dans un miroir : la photo prise à la webcam ressemble à ce que la personne voyait.
 */
export function sourceToAvatarDataUrl(
  source: CanvasImageSource,
  width: number,
  height: number,
  options: { mirror?: boolean } = {},
): string {
  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = (height - side) / 2;

  for (const size of [256, 192, 128, 96]) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossible de préparer l’image sur cet appareil.');
    if (options.mirror) {
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
    for (const quality of [0.85, 0.7, 0.55]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_CHARS) return url;
    }
  }
  throw new Error('Cette image reste trop lourde. Essayez une photo plus petite.');
}

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez un fichier image.');
  const img = await loadImage(file);
  return sourceToAvatarDataUrl(img, img.naturalWidth, img.naturalHeight);
}
