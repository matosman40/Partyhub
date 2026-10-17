import { useEffect, useRef, useState } from 'react';
import { SENSOR_SEND_HZ } from '@partyhub/shared';
import { useMicLevel, useMotionFeed, useSensorBroadcast, type MotionFrame } from '../../client/sensors.js';
import { HoldTimer, Pulses, ShakeDetector, SpinTracker } from '../../client/sensors-core.js';
import { PILE_WINDOW, pileMarker } from '../microgames.js';

/**
 * Les cinq manières de jouer un défi sur le téléphone. Chacune mesure avec son capteur, envoie son état à l'écran
 * principal (pour le faire voir en direct), et appelle `onDone` une seule fois, avec la valeur à juger.
 */

/** Niveau du micro à partir duquel on considère qu'on souffle (de 0 à 1). */
export const BLOW_LEVEL = 0.2;
/** Tolérance autour du centre pour l'équilibre (de 0 à 1 sur chaque axe). */
export const BALANCE_ZONE = 0.2;

interface GameProps {
  target: number;
  onDone: (value: number) => void;
}

/** Message commun quand le téléphone ne transmet pas le mouvement. */
function NoSensor({ text }: { text: string }) {
  return (
    <p className="notice mdf-nosensor" role="alert">
      {text}
    </p>
  );
}

/** Délai au bout duquel un téléphone qui ne donne pas le cap est signalé : le défi ne peut alors pas être réussi. */
const NO_ANGLE_MS = 2000;

/** Rafraîchit l'affichage dix fois par seconde, sans re-rendre à chaque mesure. */
function useDisplayTick(run: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!run) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, [run]);
  return tick;
}

/** Secouez : douze secousses. L'accéléromètre compte les impulsions. */
export function ShakeChallenge({ target, onDone }: GameProps) {
  const [detector] = useState(() => new ShakeDetector(12, 160));
  const count = useRef(0);
  const finished = useRef(false);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);
  const { signal } = useMotionFeed(true, (frame: MotionFrame) => {
    if (finished.current) return;
    if (frame.accel !== null) detector.feed(frame.accel, frame.t);
    else detector.pulses.tick(frame.t);
    count.current = detector.pulses.count;
    broadcast({ x: frame.tilt.x, y: frame.tilt.y, energy: detector.pulses.energy }, frame.t);
    if (count.current >= target) {
      finished.current = true;
      onDone(count.current);
    }
  });
  useDisplayTick(signal !== 'no');
  const shown = count.current;
  if (signal === 'no')
    return <NoSensor text="Ce téléphone ne transmet pas le mouvement : ce défi ne peut pas être réussi." />;
  return (
    <div className="mdf-challenge mdf-shake">
      <p className="mdf-big-count" aria-live="polite">
        {shown} <span>/ {target}</span>
      </p>
      <p className="mdf-hint-line">Secouez !</p>
    </div>
  );
}

/** Équilibre : le point doit rester dans la zone centrale pendant trois secondes. */
export function TiltChallenge({ target, onDone }: GameProps) {
  const [hold] = useState(() => new HoldTimer());
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [held, setHeld] = useState(0);
  const finished = useRef(false);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);
  const latest = useRef({ x: 0, y: 0, held: 0 });
  const { signal, recalibrate } = useMotionFeed(true, (frame: MotionFrame) => {
    if (finished.current) return;
    const { x, y } = frame.tilt;
    const inside = Math.abs(x) <= BALANCE_ZONE && Math.abs(y) <= BALANCE_ZONE;
    const duration = hold.feed(inside, frame.t);
    latest.current = { x, y, held: duration };
    broadcast({ x, y, energy: Math.min(1, duration / target) }, frame.t);
    if (duration >= target) {
      finished.current = true;
      onDone(Math.round(duration));
    }
  });
  // Un seul rafraîchissement à dix fois par seconde : il met aussi à jour le point et la durée.
  useEffect(() => {
    const id = window.setInterval(() => {
      setPoint({ x: latest.current.x, y: latest.current.y });
      setHeld(latest.current.held);
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  if (signal === 'no')
    return <NoSensor text="Ce téléphone ne transmet pas l’inclinaison : ce défi ne peut pas être réussi." />;
  const pct = (v: number) => `${Math.round(((v + 1) / 2) * 100)}%`;
  return (
    <div className="mdf-challenge mdf-tilt">
      <div className="mdf-field" role="img" aria-label="Position du téléphone">
        <span className="mdf-zone" />
        <span className="mdf-dot" style={{ left: pct(point.x), top: pct(point.y) }} />
      </div>
      <p className="mdf-hint-line" aria-live="polite">
        Maintenu : {(Math.min(held, target) / 1000).toFixed(1)} s / {(target / 1000).toFixed(1)} s
      </p>
      <button type="button" className="btn ghost small" onClick={recalibrate}>
        Recentrer
      </button>
    </div>
  );
}

/** Plateau tournant : un tour complet à plat, mesuré par le cap du téléphone (rotation nette). */
export function SpinChallenge({ target, onDone }: GameProps) {
  const [spin] = useState(() => new SpinTracker());
  const [degrees, setDegrees] = useState(0);
  const [noAngle, setNoAngle] = useState(false);
  const finished = useRef(false);
  const angleSeen = useRef(false);
  const mountedAt = useRef(performance.now());
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);
  const latest = useRef(0);
  const { signal } = useMotionFeed(true, (frame: MotionFrame) => {
    if (finished.current || frame.alpha === null) return;
    angleSeen.current = true;
    const total = spin.feed(frame.alpha);
    latest.current = total;
    broadcast({ x: frame.tilt.x, y: frame.tilt.y, energy: Math.min(1, total / target) }, frame.t);
    if (total >= target) {
      finished.current = true;
      onDone(Math.round(total));
    }
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      setDegrees(latest.current);
      // Certains navigateurs ne donnent pas le cap : on le dit, au lieu d'attendre sans fin.
      setNoAngle(!angleSeen.current && performance.now() - mountedAt.current > NO_ANGLE_MS);
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  if (signal === 'no' || noAngle)
    return <NoSensor text="Ce téléphone ne transmet pas la rotation : ce défi ne peut pas être réussi." />;
  return (
    <div className="mdf-challenge mdf-spin">
      <div className="mdf-ring" style={{ ['--p' as string]: `${Math.min(100, (degrees / target) * 100)}%` }}>
        <span>{Math.min(360, Math.round(degrees))}°</span>
      </div>
      <p className="mdf-hint-line">Faites un tour complet à plat.</p>
    </div>
  );
}

/** Souffle : le niveau du micro doit rester au-dessus du seuil pendant une seconde et demie. */
export function BlowChallenge({ target, onDone }: GameProps) {
  const { status, level } = useMicLevel(true);
  const [hold] = useState(() => new HoldTimer());
  const [held, setHeld] = useState(0);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);

  // `onDone` peut changer d'identité à chaque rendu : on le lit dans une référence, sans relancer l'effet.
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (status !== 'ready' || finished.current) return;
    const t = performance.now();
    const duration = hold.feed(level >= BLOW_LEVEL, t);
    setHeld(duration);
    broadcast({ x: 0, y: 0, energy: level }, t);
    if (duration >= target) {
      finished.current = true;
      onDoneRef.current(Math.round(duration));
    }
  }, [level, status, hold, target, broadcast]);

  if (status === 'denied' || status === 'unavailable' || status === 'insecure') {
    const text =
      status === 'insecure'
        ? 'Le micro est bloqué parce que la page n’est pas en HTTPS.'
        : status === 'denied'
          ? 'Le micro est refusé : autorisez-le dans le navigateur pour ce défi.'
          : 'Ce téléphone ne donne pas accès au micro : ce défi ne peut pas être réussi.';
    return <NoSensor text={text} />;
  }
  return (
    <div className="mdf-challenge mdf-blow">
      <div className="mdf-meter-big" role="img" aria-label="Niveau du micro">
        <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, level))})` }} />
        <i style={{ left: `${Math.round(BLOW_LEVEL * 100)}%` }} />
      </div>
      <p className="mdf-hint-line" aria-live="polite">
        {status === 'starting'
          ? 'Micro en cours…'
          : `Souffle : ${(held / 1000).toFixed(1)} s / ${(target / 1000).toFixed(1)} s`}
      </p>
    </div>
  );
}

/** Tapote vite : vingt tapotements. Chaque tapotement est compté au plus toutes les 70 ms, comme le serveur l'exige. */
export function TapChallenge({ target, onDone }: GameProps) {
  const [pulses] = useState(() => new Pulses(70));
  const [count, setCount] = useState(0);
  const finished = useRef(false);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);

  // Le compteur suit chaque tapotement, sans attendre le rafraîchissement de l'affichage.
  function tap() {
    if (finished.current) return;
    const t = performance.now();
    pulses.hit(t);
    setCount(pulses.count);
    broadcast({ x: 0, y: 0, energy: pulses.energy }, t);
    if (pulses.count >= target) {
      finished.current = true;
      onDone(pulses.count);
    }
  }

  return (
    <div className="mdf-challenge mdf-tap">
      <button type="button" className="mdf-pad" onPointerDown={tap}>
        <span className="mdf-big-count" aria-live="polite">
          {count}
        </span>
        <span>/ {target}</span>
      </button>
    </div>
  );
}

/**
 * Pile au bon moment : un curseur va et vient, un seul appui compte. La valeur est l'instant de l'appui.
 * Le curseur est déplacé directement dans le document (sans re-rendu à chaque image) ; le bouton se désactive
 * quand le défi est terminé.
 */
export function PileChallenge({
  localStart,
  durationMs,
  onDone,
}: {
  localStart: number;
  durationMs: number;
  onDone: (value: number) => void;
}) {
  const cursor = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const t = performance.now() - localStart;
      if (cursor.current) cursor.current.style.left = `${pileMarker(Math.max(0, t)) * 100}%`;
      if (t < durationMs) {
        frame = requestAnimationFrame(loop);
      } else {
        setOver(true);
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [localStart, durationMs]);

  function stop() {
    if (finished.current) return;
    finished.current = true;
    setOver(true);
    onDone(Math.max(0, Math.round(performance.now() - localStart)));
  }

  return (
    <div className="mdf-challenge mdf-pile">
      <div className="mdf-track">
        <span
          className="mdf-pile-zone"
          style={{ left: `${(0.5 - PILE_WINDOW) * 100}%`, width: `${PILE_WINDOW * 200}%` }}
        />
        <span ref={cursor} className="mdf-cursor" style={{ left: '0%' }} />
      </div>
      <button type="button" className="mdf-pad" onPointerDown={stop} disabled={over}>
        Stop !
      </button>
    </div>
  );
}
