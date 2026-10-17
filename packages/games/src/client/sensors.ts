import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SensorSample } from '@partyhub/shared';
import { canUseMedia, readMediaPrefs, requestMicrophone } from './media.js';
import { Throttle, levelFromBytes, shakeMagnitude, tiltFrom, type Neutral, type Point } from './sensors-core.js';

/**
 * Capteurs du téléphone pour les jeux : gyroscope (inclinaison), accéléromètre (secousses) et micro (souffle).
 * Chaque fonction est sans effet si l’appareil ne sait pas faire : le jeu reçoit alors un état « indisponible »
 * et propose une autre manière de jouer. Les détections pures sont dans `sensors-core.ts`.
 */

export type MotionAccess = 'granted' | 'denied' | 'unavailable' | 'insecure';

/** Vrai si le navigateur publie des événements d’orientation ou de mouvement. */
export function motionAvailable(): boolean {
  return typeof window !== 'undefined' && ('DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window);
}

/** Vrai sur iPhone et iPad (iOS 13 et plus) : l’accès aux capteurs doit être demandé par un geste. */
export function motionNeedsPermission(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent
      ?.requestPermission === 'function'
  );
}

/**
 * Demande l’accès aux capteurs. À appeler depuis un geste de l’utilisateur (un bouton) : iOS l’exige.
 * Android et ordinateurs n’ont pas de demande : l’accès est accordé dès que la page est en HTTPS.
 */
export async function requestMotionAccess(): Promise<MotionAccess> {
  if (typeof window === 'undefined') return 'unavailable';
  if (!window.isSecureContext) return 'insecure';
  if (!motionAvailable()) return 'unavailable';
  if (!motionNeedsPermission()) return 'granted';
  try {
    const orientation = window.DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> };
    const answer = await orientation.requestPermission();
    const motion = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } })
      .DeviceMotionEvent;
    if (answer === 'granted' && typeof motion?.requestPermission === 'function') {
      await motion.requestPermission().catch(() => undefined);
    }
    return answer === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Un échantillon de capteurs, à chaque mesure d’orientation du téléphone. */
export interface MotionFrame {
  /** Inclinaison relative à la pose neutre, de -1 à 1 sur chaque axe. */
  tilt: Point;
  /** Accélération linéaire en m/s² (sans la pesanteur), ou null si le téléphone ne la donne pas. */
  accel: number | null;
  /** Cap du téléphone à plat, en degrés ; null si le navigateur ne le donne pas. */
  alpha: number | null;
  /** Horloge de la page au moment de la mesure (performance.now). */
  t: number;
}

export type SignalState = 'unknown' | 'yes' | 'no';

/** Délai sans mesure au-delà duquel on considère que le téléphone n’a pas de capteur utilisable. */
const SIGNAL_TIMEOUT_MS = 1500;

/**
 * Écoute l’orientation et l’accélération tant que `active` est vrai, et envoie chaque mesure à `onFrame`.
 * La pose neutre est prise à la première mesure : le téléphone doit être tenu comme au départ.
 * `recalibrate()` la reprend à la mesure suivante. `signal` passe à « no » si rien n’arrive.
 */
export function useMotionFeed(
  active: boolean,
  onFrame: (frame: MotionFrame) => void,
): { supported: boolean; signal: SignalState; recalibrate: () => void } {
  const [supported] = useState(motionAvailable);
  const [signal, setSignal] = useState<SignalState>('unknown');
  const handler = useRef(onFrame);
  const neutral = useRef<Neutral | null>(null);
  const accel = useRef<number | null>(null);

  useEffect(() => {
    handler.current = onFrame;
  });

  useEffect(() => {
    if (!active || !supported) return;
    neutral.current = null;
    accel.current = null;
    let heard = false;
    setSignal('unknown');

    const timer = window.setTimeout(() => {
      if (!heard) setSignal('no');
    }, SIGNAL_TIMEOUT_MS);

    const onMotion = (e: DeviceMotionEvent) => {
      const value = shakeMagnitude(e);
      if (value !== null) accel.current = value;
    };
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      if (!heard) {
        heard = true;
        window.clearTimeout(timer);
        setSignal('yes');
      }
      if (!neutral.current) neutral.current = { beta: e.beta, gamma: e.gamma };
      handler.current({
        tilt: tiltFrom(e.beta, e.gamma, neutral.current),
        accel: accel.current,
        alpha: e.alpha,
        t: performance.now(),
      });
    };

    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [active, supported]);

  const recalibrate = useCallback(() => {
    neutral.current = null;
  }, []);

  return { supported, signal, recalibrate };
}

export type MicStatus = 'idle' | 'starting' | 'ready' | 'denied' | 'unavailable' | 'insecure';

/**
 * Niveau du micro (0 à 1), tant que `active` est vrai. Le micro est demandé à ce moment-là, puis arrêté
 * dès que `active` redevient faux : le flux n’est jamais envoyé au serveur.
 */
export function useMicLevel(active: boolean): { status: MicStatus; level: number } {
  const [status, setStatus] = useState<MicStatus>('idle');
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      setLevel(0);
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
    let context: AudioContext | null = null;
    let timer = 0;
    setStatus('starting');

    requestMicrophone(readMediaPrefs())
      .then((flow) => {
        if (disposed) {
          flow.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = flow;
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        context = new Ctor();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(flow).connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);
        timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(buffer);
          setLevel(levelFromBytes(buffer));
        }, 50);
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
      void context?.close().catch(() => undefined);
      setLevel(0);
    };
  }, [active]);

  return { status, level };
}

/** Dernier échantillon connu d’un joueur, avec l’instant de réception sur l’écran principal. */
export interface SensorReading extends SensorSample {
  at: number;
}

/** Échantillons de chaque joueur, indexés par identifiant. Fourni par l’écran principal. */
export const SensorsContext = createContext<Record<string, SensorReading>>({});

/** Envoi d’un échantillon depuis le téléphone. Fourni par la place du joueur ; absent hors partie. */
export const SensorSenderContext = createContext<((sample: SensorSample) => void) | null>(null);

/** Échantillons reçus de tous les joueurs (écran principal). */
export function useSensors(): Record<string, SensorReading> {
  return useContext(SensorsContext);
}

/**
 * Une mesure est fraîche tant qu’elle a moins de `maxAgeMs` : au-delà, le téléphone s’est tu ou il est hors de
 * portée, et le joueur n’est plus suivi.
 */
export function isFreshReading(reading: SensorReading | undefined, now: number, maxAgeMs: number): boolean {
  return reading !== undefined && now - reading.at < maxAgeMs;
}

/**
 * Redessine le composant à intervalle régulier : une mesure qui vieillit est alors revue comme périmée, même si le
 * téléphone ne parle plus. Sans cela, un personnage resterait penché.
 */
export function useFreshnessTick(everyMs = 250): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
}

/**
 * Envoie l’état des capteurs au serveur, au plus `hz` fois par seconde, pour l’afficher sur l’écran principal.
 * Renvoie une fonction à appeler à chaque mesure : elle ignore les envois trop rapprochés.
 */
export function useSensorBroadcast(hz = 10): (sample: SensorSample, t: number) => void {
  const send = useContext(SensorSenderContext);
  // L’envoi est lu dans une référence : la fonction renvoyée garde la même identité, même si la place du joueur
  // en fournit une nouvelle à chaque rendu. Les effets qui en dépendent ne se relancent pas pour rien.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const throttle = useMemo(() => new Throttle(hz), [hz]);
  return useCallback(
    (sample: SensorSample, t: number) => {
      const out = sendRef.current;
      if (out && throttle.offer(t)) out(sample);
    },
    [throttle],
  );
}
