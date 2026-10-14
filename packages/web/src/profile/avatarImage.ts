/**
 * Redimensionne une photo choisie sur l'appareil en carré (jusqu'à 256 px) et
 * l'encode en data URL assez légère pour le serveur (60 000 caractères au plus).
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

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez un fichier image.');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;

  for (const size of [256, 192, 128, 96]) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Impossible de préparer l’image sur cet appareil.');
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    for (const quality of [0.85, 0.7, 0.55]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length <= MAX_CHARS) return url;
    }
  }
  throw new Error('Cette image reste trop lourde. Essayez une photo plus petite.');
}
