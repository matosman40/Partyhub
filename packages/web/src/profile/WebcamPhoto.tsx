import { useEffect, useRef, useState } from 'react';
import { sourceToAvatarDataUrl } from './avatarImage.js';

/** La webcam demande une page sécurisée (https) et un navigateur qui la prend en charge. */
export function webcamAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Message lisible pour un refus ou une absence de caméra. */
export function webcamErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'L’accès à la caméra est refusé. Autorisez la caméra dans votre navigateur, ou choisissez une photo.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Aucune caméra trouvée sur cet appareil. Choisissez plutôt une photo.';
  }
  return 'La caméra ne répond pas. Réessayez, ou choisissez une photo.';
}

/**
 * Prend la photo de profil avec la webcam : aperçu en miroir, compte à rebours de 3 secondes,
 * puis la photo est recadrée comme une photo choisie. La caméra s'éteint dès que c'est fini.
 */
export function WebcamPhoto({ onCapture, onCancel }: { onCapture: (dataUrl: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<'starting' | 'ready' | 'countdown' | 'error'>('starting');
  const [count, setCount] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = () => {
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    if (!webcamAvailable()) {
      setError('La webcam demande une connexion sécurisée (https). Choisissez plutôt une photo.');
      setStatus('error');
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(webcamErrorMessage(err));
        setStatus('error');
      });
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, []);

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError('La caméra ne renvoie pas encore d’image. Réessayez dans une seconde.');
      setStatus('ready');
      return;
    }
    try {
      const dataUrl = sourceToAvatarDataUrl(video, video.videoWidth, video.videoHeight, { mirror: true });
      stopCamera();
      onCapture(dataUrl);
    } catch (err) {
      setError((err as Error).message);
      setStatus('ready');
    }
  }

  function startCountdown() {
    setError(null);
    setStatus('countdown');
    let left = 3;
    setCount(left);
    timerRef.current = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(timerRef.current);
        takePhoto();
      } else {
        setCount(left);
      }
    }, 1000);
  }

  function cancel() {
    stopCamera();
    onCancel();
  }

  return (
    <div className="webcam stack" aria-label="Photo avec la webcam">
      <div className="webcam-frame" aria-live="polite">
        {status !== 'error' && (
          <video ref={videoRef} className="webcam-video" autoPlay muted playsInline aria-label="Aperçu de la webcam" />
        )}
        {status === 'starting' && <p className="webcam-note">Ouverture de la caméra…</p>}
        {status === 'countdown' && (
          <p className="webcam-count" aria-label={`Photo dans ${count}`}>
            {count}
          </p>
        )}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div className="voice-add">
        <button type="button" className="btn primary" onClick={startCountdown} disabled={status !== 'ready'}>
          Prendre la photo
        </button>
        <button type="button" className="btn ghost" onClick={cancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}
