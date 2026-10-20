import { useEffect, useRef, useState } from 'react';
import { canUseMedia, readMediaPrefs, requestCamera } from '../../client/media.js';

/**
 * Lumière de l’objectif arrière, mesurée sur une image de 16 × 16 pixels. Seule la moyenne de luminosité sort de
 * ce module : aucune image n’est gardée, ni envoyée. Le flux est arrêté dès que le défi se termine.
 */

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'denied' | 'unavailable' | 'insecure';

/** Côté de l’image échantillonnée. */
const SAMPLE_SIDE = 16;
/** Une mesure toutes les 100 ms : assez pour suivre un doigt qui se pose, sans charger le téléphone. */
const SAMPLE_MS = 100;

/** Luminosité moyenne (0 à 255) d’une image RGBA, avec la pondération de la perception. */
export function meanLuma(data: Uint8ClampedArray): number {
  const pixels = data.length / 4;
  if (pixels === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }
  return sum / pixels;
}

/**
 * Lit la caméra arrière tant que `active` est vrai, et envoie chaque mesure de luminosité à `onLuma`. Renvoie
 * l’état de l’accès : « refusé », « indisponible », etc. ; le défi affiche alors pourquoi il ne peut pas être réussi.
 */
export function useCameraLuma(active: boolean, onLuma: (luma: number, t: number) => void): CameraStatus {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const handler = useRef(onLuma);

  useEffect(() => {
    handler.current = onLuma;
  });

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      return;
    }
    if (!window.isSecureContext) {
      setStatus('insecure');
      return;
    }
    if (!canUseMedia()) {
      setStatus('unavailable');
      return;
    }

    let disposed = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIDE;
    canvas.height = SAMPLE_SIDE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    setStatus('starting');

    requestCamera(readMediaPrefs(), 'environment')
      .then((flow) => {
        if (disposed) {
          flow.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = flow;
        video.srcObject = flow;
        void video.play().catch(() => undefined);
        timer = window.setInterval(() => {
          if (!context || video.readyState < 2) return;
          context.drawImage(video, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
          const pixels = context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data;
          handler.current(meanLuma(pixels), performance.now());
        }, SAMPLE_MS);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const name = err instanceof Error ? err.name : '';
        setStatus(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'unavailable');
      });

    return () => {
      disposed = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [active]);

  return status;
}
