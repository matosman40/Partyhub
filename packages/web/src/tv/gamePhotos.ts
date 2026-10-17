/**
 * Captures de la première partie d’un jeu, prises sur l’écran de la salle puis envoyées au serveur.
 * Le partage d’écran demande l’accord de l’hôte (un clic, un choix d’onglet) ; ensuite, les captures se prennent seules.
 */

/** Format de la fiche : toutes les captures ont le même cadrage 16:9. */
export const CAPTURE_WIDTH = 1280;
export const CAPTURE_HEIGHT = 720;
export const CAPTURE_QUALITY = 0.72;
/** Taille maximale acceptée par le serveur. */
export const CAPTURE_MAX_BYTES = 400 * 1024;
/** Moments de capture pendant la partie, en millisecondes après son lancement. */
export const CAPTURE_DELAYS_MS = [15_000, 45_000];
/** Capture de l’écran des résultats : laissé le temps de s’afficher après la fin de la partie. */
export const FINAL_CAPTURE_DELAY_MS = 2_500;

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Recadrage centré à la proportion de destination : l’image ne se déforme jamais. */
export function coverCrop(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number = CAPTURE_WIDTH,
  dstHeight: number = CAPTURE_HEIGHT,
): CropRect {
  const dstRatio = dstWidth / dstHeight;
  if (srcWidth / srcHeight > dstRatio) {
    const sw = srcHeight * dstRatio;
    return { sx: (srcWidth - sw) / 2, sy: 0, sw, sh: srcHeight };
  }
  const sh = srcWidth / dstRatio;
  return { sx: 0, sy: (srcHeight - sh) / 2, sw: srcWidth, sh };
}

/** Une image prise sur l’écran, en JPEG au format de la fiche. Null si l’écran n’a pas encore d’image. */
export function grabFrame(video: HTMLVideoElement): Promise<Blob | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  const crop = coverCrop(video.videoWidth, video.videoHeight);
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', CAPTURE_QUALITY));
}

export type UploadOutcome =
  /** Capture gardée. */
  | 'saved'
  /** Le serveur ne veut plus de captures pour cette salle (jeu déjà photographié, partie terminée). */
  | 'closed'
  /** Échec ponctuel (réseau, image refusée) : on réessaiera au moment suivant. */
  | 'failed';

/** Envoie une capture avec le jeton d’hôte de la salle. */
export async function uploadGamePhoto(
  code: string,
  hostToken: string,
  blob: Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadOutcome> {
  try {
    const res = await fetchImpl(`/api/rooms/${encodeURIComponent(code)}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'X-Host-Token': hostToken },
      body: blob,
    });
    if (res.status === 201) return 'saved';
    if (res.status === 409) return 'closed';
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** Le partage d’écran doit être celui de cet onglet, pas de tout l’écran ni d’une autre fenêtre. */
export function isThisTab(settings: MediaTrackSettings): boolean {
  return (settings as { displaySurface?: string }).displaySurface === 'browser';
}
