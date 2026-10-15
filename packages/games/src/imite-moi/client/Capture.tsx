import { useCallback, useEffect, useRef, useState } from 'react';
import { canUseMedia, requestCamera, requestMicrophone, useMediaPrefs } from '../../client/media.js';
import { CLIP_MS, photoFromFile, photoFromVideo, recordClip } from './capture.js';

/** Message en français pour un refus ou une absence de caméra ou de micro. */
function mediaMessage(err: unknown, kind: 'micro' | 'caméra'): string {
  if (!canUseMedia()) return `Le ${kind} n’est pas disponible sur cette page : ouvrez PartyHub en HTTPS.`;
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return `Accès au ${kind} refusé. Autorisez-le dans les réglages du navigateur, puis réessayez.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return `Aucun ${kind} trouvé sur cet appareil.`;
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `Le ${kind} est utilisé par une autre application.`;
  }
  // Messages de nos propres fonctions (capture.ts), déjà rédigés en français.
  if (err instanceof Error && name === 'Error') return err.message;
  return `Impossible d’utiliser le ${kind}.`;
}

/**
 * Photo sur le téléphone : la galerie (fonctionne aussi en HTTP) ou la caméra avec un compte à rebours
 * (HTTPS requis). Le joueur voit l'aperçu, peut reprendre, puis envoie.
 */
export function PhotoCapture({
  mode,
  busy,
  onSubmit,
}: {
  mode: 'galerie' | 'grimace';
  busy: boolean;
  onSubmit: (dataUrl: string) => void;
}) {
  const [prefs] = useMediaPrefs();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => window.clearTimeout(timer);
    }
    setCountdown(null);
    const video = videoRef.current;
    if (!video) return;
    try {
      setPreview(photoFromVideo(video));
      stopCamera();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo impossible.');
    }
  }, [countdown, stopCamera]);

  async function openCamera() {
    setError(null);
    if (!canUseMedia()) {
      setError(mediaMessage(null, 'caméra'));
      return;
    }
    try {
      const stream = await requestCamera(prefs, 'user');
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      setLive(true);
    } catch (err) {
      setError(mediaMessage(err, 'caméra'));
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setPreview(await photoFromFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo impossible.');
    }
  }

  if (preview) {
    return (
      <div className="stack imite-capture">
        <img className="imite-preview" src={preview} alt="Votre photo avant envoi" />
        <div className="imite-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setPreview(null)}>
            Reprendre
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => onSubmit(preview)}>
            Envoyer cette photo
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="stack imite-capture">
      {mode === 'grimace' && (
        <div className="imite-live" hidden={!live}>
          <video ref={videoRef} playsInline muted aria-label="Aperçu de la caméra" />
          {countdown !== null && countdown > 0 && (
            <span className="imite-countdown" aria-live="polite">
              {countdown}
            </span>
          )}
        </div>
      )}
      <div className="imite-actions">
        {mode === 'grimace' && !live && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void openCamera()}>
            Ouvrir la caméra
          </button>
        )}
        {mode === 'grimace' && live && (
          <button
            type="button"
            className="btn primary"
            disabled={busy || countdown !== null}
            onClick={() => setCountdown(3)}
          >
            Prendre la photo (3 s)
          </button>
        )}
        <label className={`btn ${mode === 'galerie' ? 'primary' : ''} imite-file`}>
          Choisir dans la galerie
          <input type="file" accept="image/*" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Son sur le téléphone : un enregistrement de 3 secondes au micro, qu'on peut écouter avant d'envoyer. */
export function SoundRecorder({ busy, onSubmit }: { busy: boolean; onSubmit: (dataUrl: string) => void }) {
  const [prefs] = useMediaPrefs();
  const [preview, setPreview] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    setError(null);
    if (!canUseMedia()) {
      setError(mediaMessage(null, 'micro'));
      return;
    }
    setRecording(true);
    let stream: MediaStream | null = null;
    try {
      stream = await requestMicrophone(prefs);
      setPreview(await recordClip(stream, CLIP_MS));
    } catch (err) {
      setError(mediaMessage(err, 'micro'));
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setRecording(false);
    }
  }

  return (
    <div className="stack imite-capture">
      {preview && <audio className="imite-audio" controls src={preview} />}
      <div className="imite-actions">
        {!preview && (
          <button type="button" className="btn primary" disabled={busy || recording} onClick={() => void record()}>
            {recording ? 'Enregistrement…' : 'Enregistrer 3 secondes'}
          </button>
        )}
        {preview && (
          <>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setPreview(null)}>
              Réenregistrer
            </button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => onSubmit(preview)}>
              Envoyer ce son
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
