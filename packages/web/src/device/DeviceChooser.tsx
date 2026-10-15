import { useCallback, useEffect, useRef, useState } from 'react';
import { canUseMedia, requestCamera, requestMicrophone, useMediaPrefs } from '@partyhub/games/client';
import { describeMediaError, levelFromBytes, unavailableMessage } from './mediaTest.js';

/**
 * Choix du micro et de la caméra pour cet appareil, avec un test rapide. Le choix est gardé dans le
 * navigateur et sert à tous les jeux. Les noms des appareils n'apparaissent qu'après une autorisation.
 */

interface DeviceList {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
}

async function listDevices(): Promise<DeviceList> {
  const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  return {
    microphones: devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== ''),
    cameras: devices.filter((d) => d.kind === 'videoinput' && d.deviceId !== ''),
  };
}

function optionLabel(device: MediaDeviceInfo, fallback: string, index: number): string {
  return device.label || `${fallback} ${index + 1}`;
}

interface Props {
  /** Affichage resserré pour le tiroir d'angle du téléphone. */
  compact?: boolean;
}

export function DeviceChooser({ compact = false }: Props) {
  const [prefs, updatePrefs] = useMediaPrefs();
  const [devices, setDevices] = useState<DeviceList>({ microphones: [], cameras: [] });

  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);

  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(() => {
    void listDevices().then(setDevices, () => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    mediaDevices.addEventListener('devicechange', refresh);
    return () => mediaDevices.removeEventListener('devicechange', refresh);
  }, [refresh]);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    void micCtxRef.current?.close();
    micCtxRef.current = null;
    setLevel(0);
    setMicOn(false);
  }, []);

  const stopCam = useCallback(() => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    setCamOn(false);
  }, []);

  useEffect(
    () => () => {
      stopMic();
      stopCam();
    },
    [stopMic, stopCam],
  );

  async function startMic() {
    if (!canUseMedia()) {
      setMicError(unavailableMessage('micro', window.isSecureContext));
      return;
    }
    try {
      const stream = await requestMicrophone(prefs);
      micStreamRef.current = stream;
      const AudioCtx =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      micCtxRef.current = ctx;
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
      setMicError(null);
      setMicOn(true);
      refresh();
    } catch (err) {
      setMicError(describeMediaError(err));
    }
  }

  async function startCam() {
    stopCam();
    if (!canUseMedia()) {
      setCamError(unavailableMessage('caméra', window.isSecureContext));
      return;
    }
    try {
      const stream = await requestCamera(prefs);
      camStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      setCamError(null);
      setCamOn(true);
      refresh();
    } catch (err) {
      setCamError(describeMediaError(err));
    }
  }

  const micChosenMissing =
    prefs.microphoneId !== null &&
    devices.microphones.length > 0 &&
    !devices.microphones.some((d) => d.deviceId === prefs.microphoneId);
  const camChosenMissing =
    prefs.cameraId !== null &&
    devices.cameras.length > 0 &&
    !devices.cameras.some((d) => d.deviceId === prefs.cameraId);

  return (
    <div className={compact ? 'stack devtest-chooser compact' : 'stack devtest-chooser'}>
      <label className="field">
        <span>Micro</span>
        <select
          value={prefs.microphoneId ?? ''}
          onChange={(e) => updatePrefs({ microphoneId: e.target.value || null })}
        >
          <option value="">Appareil par défaut</option>
          {devices.microphones.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {optionLabel(d, 'Micro', i)}
            </option>
          ))}
        </select>
      </label>
      {devices.microphones.length === 0 && (
        <p className="muted small">Activez le micro une fois pour voir la liste des micros de cet appareil.</p>
      )}
      {micChosenMissing && (
        <p className="muted small">Le micro choisi n’est plus branché : l’appareil par défaut est utilisé.</p>
      )}
      <div className="devtest-meter" aria-label="Niveau du micro">
        <span style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <div className="devtest-actions">
        {micOn ? (
          <button type="button" className="btn ghost" onClick={stopMic}>
            Arrêter le test
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void startMic()}>
            Tester le micro
          </button>
        )}
      </div>
      {micError && (
        <p className="error" role="alert">
          {micError}
        </p>
      )}

      <label className="field">
        <span>Caméra</span>
        <select value={prefs.cameraId ?? ''} onChange={(e) => updatePrefs({ cameraId: e.target.value || null })}>
          <option value="">Appareil par défaut</option>
          {devices.cameras.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {optionLabel(d, 'Caméra', i)}
            </option>
          ))}
        </select>
      </label>
      {devices.cameras.length === 0 && (
        <p className="muted small">Activez la caméra une fois pour voir la liste des caméras de cet appareil.</p>
      )}
      {camChosenMissing && (
        <p className="muted small">La caméra choisie n’est plus disponible : l’appareil par défaut est utilisé.</p>
      )}
      <div className="devtest-preview" hidden={!camOn}>
        <video ref={videoRef} playsInline muted autoPlay aria-label="Aperçu de la caméra" />
      </div>
      <div className="devtest-actions">
        {camOn ? (
          <button type="button" className="btn ghost" onClick={stopCam}>
            Arrêter le test
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void startCam()}>
            Tester la caméra
          </button>
        )}
      </div>
      {camError && (
        <p className="error" role="alert">
          {camError}
        </p>
      )}
    </div>
  );
}
