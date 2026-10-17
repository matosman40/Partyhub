import { useCallback, useEffect, useRef, useState } from 'react';
import { SENSOR_SEND_HZ } from '@partyhub/shared';
import { useMotionFeed, useSensorBroadcast, type MotionFrame } from '../../client/sensors.js';
import { FallDetector, WALK_MS, clampUnit, leanOf, windAt, windPeak } from '../rules.js';
import { Streamers, secondsLabel, windSentence } from './wind.js';
import type { WindView } from './types.js';

/**
 * La traversée, sur le téléphone : le téléphone est le balancier. L’inclinaison (depuis la pose de départ)
 * s’ajoute au vent ; le personnage penche d’autant. Hors d’équilibre trop longtemps, il tombe, et le temps
 * tenu part vers le serveur. Tenir la traversée entière envoie la durée complète.
 */
export function WalkChallenge({
  wind,
  localStart,
  onDone,
}: {
  wind: WindView;
  localStart: number;
  onDone: (survivedMs: number) => void;
}) {
  const [fall] = useState(() => new FallDetector());
  const finished = useRef(false);
  const latest = useRef({ lean: 0, wind: 0, t: 0 });
  const [view, setView] = useState({ lean: 0, wind: 0, t: 0 });
  const filRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLSpanElement | null>(null);
  // Mesures du fil et du personnage, relues au redimensionnement seulement : jamais pendant une mesure du capteur.
  const geometry = useRef({ width: 0, half: 0 });
  const painted = useRef('');
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const finish = (survivedMs: number) => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current(Math.round(survivedMs));
  };

  // Le funambule suit le téléphone à chaque mesure : sa position et son inclinaison sont écrites directement sur le
  // personnage, en pixels calculés à partir des mesures en cache. Aucune mise en page n'est lue, l'état de React
  // n'est pas sollicité, et rien n'est écrit tant que la position ne bouge pas.
  const placeWalker = useCallback((lean: number) => {
    const dot = dotRef.current;
    if (!dot) return;
    const { width, half } = geometry.current;
    const x = ((clampUnit(lean) + 1) / 2) * width - half;
    const next = `translate3d(${x.toFixed(1)}px, 0, 0) rotate(${(lean * 22).toFixed(1)}deg)`;
    if (next === painted.current) return;
    dot.style.transform = next;
    painted.current = next;
  }, []);

  const { signal, recalibrate } = useMotionFeed(true, (frame: MotionFrame) => {
    if (finished.current) return;
    const t = frame.t - localStart;
    const air = windAt(t, wind.strength, wind.seed);
    const lean = leanOf(frame.tilt.x, air);
    latest.current = { lean, wind: air, t };
    placeWalker(lean);
    broadcast({ x: clampUnit(lean), y: frame.tilt.y, energy: Math.min(1, Math.abs(lean)) }, frame.t);
    const fellAt = fall.feed(lean, t);
    if (fellAt !== null) finish(fellAt);
    else if (t >= WALK_MS) finish(WALK_MS);
  });

  // Le fil est mesuré au montage et à chaque changement de taille (rotation du téléphone, redimensionnement).
  useEffect(() => {
    const fil = filRef.current;
    if (!fil) return;
    const measure = () => {
      geometry.current = { width: fil.clientWidth, half: (dotRef.current?.offsetWidth ?? 0) / 2 };
      painted.current = '';
      placeWalker(latest.current.lean);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(fil);
    return () => observer.disconnect();
  }, [signal, placeWalker]);

  // Le texte se rafraîchit dix fois par seconde, sans re-rendre à chaque mesure. La traversée se termine aussi
  // à sa durée quand les mesures s’arrêtent (téléphone figé, onglet caché) : le temps tenu est alors complet.
  useEffect(() => {
    const id = window.setInterval(() => {
      setView({ ...latest.current });
      if (latest.current.t >= WALK_MS) finish(WALK_MS);
    }, 100);
    return () => window.clearInterval(id);
    // `finish` ne lit que des références stables : l'effet n'a pas besoin de se relancer.
  }, []);

  if (signal === 'no') {
    return (
      <p className="notice fnb-nosensor" role="alert">
        Ce téléphone ne transmet pas l’inclinaison : le funambule ne peut pas tenir le fil.
      </p>
    );
  }

  const danger = Math.min(1, Math.abs(view.lean));
  const remaining = Math.max(0, WALK_MS - view.t);
  return (
    <div className="fnb-challenge">
      <Streamers wind={view.wind / windPeak(wind.strength)} size="sm" />
      <p className="fnb-wind-text">
        {wind.label} · {windSentence(view.wind)}
      </p>
      <div
        ref={filRef}
        className={`fnb-fil${danger > 0.7 ? ' is-danger' : ''}`}
        role="img"
        aria-label="Position sur le fil"
      >
        <span className="fnb-post is-left" aria-hidden="true" />
        <span className="fnb-post is-right" aria-hidden="true" />
        <span className="fnb-cable" aria-hidden="true" />
        <span className="fnb-marker" aria-hidden="true" />
        <span
          ref={dotRef}
          className="fnb-walker-dot"
          style={{ opacity: 0.55 + 0.45 * (1 - danger) }}
          aria-hidden="true"
        >
          🧍
        </span>
      </div>
      <p className="fnb-clock">Il reste {secondsLabel(remaining)}</p>
      <button type="button" className="btn ghost small" onClick={recalibrate}>
        Recentrer
      </button>
    </div>
  );
}
