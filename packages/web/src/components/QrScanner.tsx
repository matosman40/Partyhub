import { useEffect, useRef, useState } from 'react';

/**
 * Lecture d'un QR code avec la caméra arrière, quand le navigateur sait le faire
 * (API BarcodeDetector : Chrome et Android, pas Safari ni Firefox). Sinon, ou si la
 * caméra est refusée, le composant l'indique et l'utilisateur saisit le code à la main.
 */

interface DetectedCode {
  rawValue: string;
}

interface DetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}

type DetectorCtor = new (options: { formats: string[] }) => DetectorLike;

function detectorCtor(): DetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/** Vrai si le navigateur peut tenter de lire un QR code par la caméra. */
export function canScanQr(): boolean {
  return detectorCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function QrScanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Detector = detectorCtor();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError('Ce navigateur ne sait pas lire les QR codes. Saisissez le code affiché sur l’écran.');
      return;
    }

    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const detector = new Detector({ formats: ['qr_code'] });

    const scan = async () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      try {
        const codes = await detector.detect(video);
        const value = codes[0]?.rawValue;
        if (value) {
          stopped = true;
          onResult(value);
          return;
        }
      } catch {
        // Image pas encore prête : on réessaie.
      }
      timer = window.setTimeout(() => void scan(), 250);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        await video.play().catch(() => undefined);
        void scan();
      })
      .catch(() => {
        setError('Caméra indisponible ou refusée. Saisissez le code affiché sur l’écran.');
      });

    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // onResult change à chaque rendu : on ne relance pas la caméra pour autant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="qr-scanner card stack" role="dialog" aria-label="Scanner le QR code de la salle">
      {error ? (
        <p className="notice">{error}</p>
      ) : (
        <video ref={videoRef} className="qr-video" playsInline muted aria-label="Aperçu de la caméra" />
      )}
      <button type="button" className="btn ghost" onClick={onClose}>
        Fermer
      </button>
    </div>
  );
}
