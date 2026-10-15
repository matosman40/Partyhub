import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  describeMediaError,
  formatBytes,
  levelFromBytes,
  permissionLabel,
  unavailableMessage,
} from '../device/mediaTest.js';

/**
 * Page de test : micro (niveau et enregistrement de 3 s), caméra (aperçu) et image (ouverte depuis
 * l'appareil). Le navigateur demande l'autorisation au premier usage ; rien n'est envoyé au serveur.
 */

type PermissionName = 'microphone' | 'camera';

/** État de l'autorisation, lu via la Permissions API quand le navigateur la propose. */
function usePermission(name: PermissionName): [string, () => void] {
  const [state, setState] = useState('inconnue');
  const refresh = useCallback(() => {
    if (!navigator.permissions?.query) return;
    navigator.permissions
      .query({ name } as unknown as PermissionDescriptor)
      .then((r) => setState(r.state))
      .catch(() => setState('inconnue'));
  }, [name]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return [permissionLabel(state), refresh];
}

function Warning() {
  if (typeof window === 'undefined' || window.isSecureContext) return null;
  return (
    <p className="card devtest-warning" role="alert">
      Cette page n’est pas en HTTPS : le navigateur bloque le micro et la caméra. L’ouverture d’une image fonctionne
      quand même. Pour tester micro et caméra, ouvrez PartyHub en HTTPS.
    </p>
  );
}

function MicPanel() {
  const [permission, refreshPermission] = usePermission('microphone');
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number>(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setLevel(0);
    setActive(false);
  }, []);

  useEffect(() => stop, [stop]);

  const ensureStream = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(unavailableMessage('micro', window.isSecureContext));
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setError(null);
      refreshPermission();
      const AudioCtx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        setLevel(levelFromBytes(samples));
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
      setActive(true);
      return stream;
    } catch (err) {
      setError(describeMediaError(err));
      refreshPermission();
      return null;
    }
  }, [refreshPermission]);

  async function record() {
    const stream = await ensureStream();
    if (!stream) return;
    if (typeof MediaRecorder === 'undefined') {
      setError('L’enregistrement n’est pas disponible sur ce navigateur.');
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      setRecording(false);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      setClipUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(blob);
      });
    };
    setRecording(true);
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, 3000);
  }

  useEffect(
    () => () => {
      if (clipUrl) URL.revokeObjectURL(clipUrl);
    },
    [clipUrl],
  );

  return (
    <section className="card stack devtest-card" aria-labelledby="devtest-mic">
      <h2 id="devtest-mic">Micro</h2>
      <p className="muted small">Autorisation : {permission}</p>
      <div className="devtest-meter" aria-label="Niveau du micro">
        <span style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <div className="devtest-actions">
        {!active ? (
          <button type="button" className="btn primary" onClick={() => void ensureStream()}>
            Activer le micro
          </button>
        ) : (
          <button type="button" className="btn ghost" onClick={stop}>
            Arrêter le micro
          </button>
        )}
        <button type="button" className="btn" onClick={() => void record()} disabled={recording}>
          {recording ? 'Enregistrement (3 s)…' : 'Enregistrer 3 s'}
        </button>
      </div>
      {clipUrl && (
        <audio className="devtest-audio" controls src={clipUrl}>
          Votre navigateur ne lit pas l’audio.
        </audio>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function CameraPanel() {
  const [permission, refreshPermission] = usePermission('camera');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [active, setActive] = useState(false);
  const [cameras, setCameras] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => stop, [stop]);

  async function start(mode: 'user' | 'environment') {
    stop();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(unavailableMessage('caméra', window.isSecureContext));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      setFacing(mode);
      setActive(true);
      setError(null);
      refreshPermission();
      const devices = await navigator.mediaDevices.enumerateDevices?.();
      setCameras(devices ? devices.filter((d) => d.kind === 'videoinput').length : null);
    } catch (err) {
      setError(describeMediaError(err));
      refreshPermission();
    }
  }

  return (
    <section className="card stack devtest-card" aria-labelledby="devtest-cam">
      <h2 id="devtest-cam">Caméra</h2>
      <p className="muted small">
        Autorisation : {permission}
        {cameras !== null && ` · ${cameras} caméra(s) détectée(s)`}
      </p>
      <div className="devtest-preview">
        <video ref={videoRef} playsInline muted autoPlay aria-label="Aperçu de la caméra" hidden={!active} />
        {!active && <p className="muted small">L’aperçu de la caméra apparaîtra ici.</p>}
      </div>
      <div className="devtest-actions">
        <button type="button" className="btn primary" onClick={() => void start('user')}>
          {active && facing === 'user' ? 'Caméra avant (active)' : 'Caméra avant'}
        </button>
        <button type="button" className="btn" onClick={() => void start('environment')}>
          {active && facing === 'environment' ? 'Caméra arrière (active)' : 'Caméra arrière'}
        </button>
        {active && (
          <button type="button" className="btn ghost" onClick={stop}>
            Arrêter
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ImagePanel() {
  const [url, setUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const next = URL.createObjectURL(file);
    urlRef.current = next;
    setUrl(next);
    setInfo(`${file.name || 'image'} · ${formatBytes(file.size)} · ${file.type || 'type inconnu'}`);
  }

  return (
    <section className="card stack devtest-card" aria-labelledby="devtest-img">
      <h2 id="devtest-img">Image</h2>
      <p className="muted small">
        Ouvre une photo de votre appareil. Le fichier reste sur cet appareil et n’est envoyé nulle part.
      </p>
      <label className="btn primary devtest-file">
        Ouvrir une image
        <input type="file" accept="image/*" onChange={onPick} />
      </label>
      {url && (
        <figure className="devtest-image">
          <img src={url} alt="Image choisie" />
          <figcaption className="muted small">{info}</figcaption>
        </figure>
      )}
    </section>
  );
}

export function DeviceTestPage() {
  return (
    <main className="page devtest fade-in">
      <header className="stack">
        <Link to="/" className="muted small">
          ← Accueil
        </Link>
        <h1>Test des appareils</h1>
        <p className="muted">
          Vérifiez que le micro, la caméra et les images fonctionnent sur cet appareil. Au premier essai, le navigateur
          demande l’autorisation : acceptez-la pour continuer.
        </p>
      </header>
      <Warning />
      <div className="devtest-grid">
        <MicPanel />
        <CameraPanel />
        <ImagePanel />
      </div>
    </main>
  );
}
