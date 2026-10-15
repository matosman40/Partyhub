import { MEDIA_MAX_CHARS } from '../module.js';

/**
 * Préparation des réponses sur le téléphone. Une photo est réduite jusqu'à passer sous la limite d'envoi
 * (une action Socket.IO fait au plus 64 Ko). Un son est enregistré à faible débit, pour rester petit.
 */

/** Réductions essayées dans l'ordre : la première qui tient sous la limite est gardée. */
const ATTEMPTS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: 480, quality: 0.7 },
  { side: 400, quality: 0.6 },
  { side: 320, quality: 0.5 },
  { side: 240, quality: 0.45 },
];

export const CLIP_MS = 3000;

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('lecture impossible'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Cette image ne peut pas être lue.'));
    img.src = src;
  });
}

/** Dessine une source (image ou vidéo) réduite en JPEG, sous la limite d'envoi. Renvoie null si impossible. */
export function encodeSource(source: CanvasImageSource, width: number, height: number): string | null {
  if (width <= 0 || height <= 0) return null;
  for (const attempt of ATTEMPTS) {
    const scale = Math.min(1, attempt.side / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', attempt.quality);
    if (url.length <= MEDIA_MAX_CHARS) return url;
  }
  return null;
}

/** Photo choisie dans la galerie du téléphone. */
export async function photoFromFile(file: File): Promise<string> {
  const img = await loadImage(await readAsDataUrl(file));
  const url = encodeSource(img, img.naturalWidth, img.naturalHeight);
  if (!url) throw new Error('Cette photo est trop lourde. Choisissez-en une autre.');
  return url;
}

/** Image prise avec la caméra, à l'instant où elle est affichée dans la vidéo. */
export function photoFromVideo(video: HTMLVideoElement): string {
  const url = encodeSource(video, video.videoWidth, video.videoHeight);
  if (!url) throw new Error('La caméra ne renvoie pas encore d’image. Réessayez dans un instant.');
  return url;
}

function audioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

/** Enregistre `ms` millisecondes du flux micro, à faible débit, et renvoie le son en data URL. */
export function recordClip(stream: MediaStream, ms: number = CLIP_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const mime = audioMime();
    const recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: 24_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error('L’enregistrement a été interrompu. Réessayez.'));
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      readAsDataUrl(blob).then((url) => {
        if (url.length <= MEDIA_MAX_CHARS) resolve(url);
        else reject(new Error('L’enregistrement est trop lourd. Réessayez.'));
      }, reject);
    };
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, ms);
  });
}
