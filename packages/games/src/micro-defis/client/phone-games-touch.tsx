import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { SENSOR_SEND_HZ } from '@partyhub/shared';
import { useSensorBroadcast } from '../../client/sensors.js';
import { HoldTimer } from '../../client/sensors-core.js';
import { type GameProps } from './phone-games.js';
import {
  atScale,
  flickSpeed,
  pinchGap,
  pinchScale,
  swipeDirection,
  type Point,
  type SwipeDirection,
  type TimedPoint,
} from './gestures.js';
import { canVibrate, vibrate } from './haptics.js';

/**
 * Les défis tactiles : glisser, répéter un motif de vibrations, pincer, lancer. Chacun appelle `onDone` une seule
 * fois, avec la valeur à juger (comme les défis de capteurs). Le jugement, côté serveur, borne chaque valeur par le
 * temps écoulé : un téléphone ne peut pas envoyer plus de glissés qu’il n’en a pu faire.
 */

/* ---------- Glisse-moi : six flèches à suivre dans l’ordre ---------- */

const ARROW: Record<SwipeDirection, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const DIRECTIONS: readonly SwipeDirection[] = ['up', 'down', 'left', 'right'];

/** Un glissé dans le mauvais sens ne compte pas et ne met pas fin au défi : on peut recommencer. */
export function SwipeChallenge({ target, onDone }: GameProps) {
  const [sequence] = useState<SwipeDirection[]>(() =>
    Array.from({ length: target }, () => DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]!),
  );
  const [done, setDone] = useState(0);
  const [misses, setMisses] = useState(0);
  const start = useRef<Point | null>(null);
  const count = useRef(0);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (finished.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
  }

  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    const from = start.current;
    start.current = null;
    if (!from || finished.current) return;
    const direction = swipeDirection(e.clientX - from.x, e.clientY - from.y);
    if (!direction) return;
    if (direction !== sequence[count.current]) {
      setMisses((m) => m + 1);
      return;
    }
    count.current += 1;
    setDone(count.current);
    broadcast({ x: 0, y: 0, energy: count.current / target }, performance.now());
    if (count.current >= target) {
      finished.current = true;
      onDoneRef.current(count.current);
    }
  }

  return (
    <div className="mdf-challenge mdf-swipe">
      <div className="mdf-arrows">
        {sequence.map((direction, i) => (
          <span key={i} aria-hidden="true" className={i < done ? 'is-done' : i === done ? 'is-next' : undefined}>
            {ARROW[direction]}
          </span>
        ))}
      </div>
      <div
        className="mdf-pad mdf-touch-none"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        <span className="mdf-big-count" aria-live="polite">
          {done}
          <span> / {target}</span>
        </span>
        <span>Glissez !</span>
      </div>
      {misses > 0 && (
        <p key={misses} className="mdf-miss" role="status">
          Mauvais sens
        </p>
      )}
    </div>
  );
}

/* ---------- Répète le motif : vibrations (ou écran) puis reproduction au doigt ---------- */

type Stroke = 'short' | 'long';

const SHORT_MS = 160;
const LONG_MS = 480;
const STROKE_GAP_MS = 300;
const LEAD_MS = 700;
/** Un appui plus long que ceci est un « long ». */
const LONG_PRESS_MS = 300;

/**
 * Le téléphone joue un motif de symboles courts et longs : il vibre (quand le navigateur le permet) et le motif
 * s’affiche à l’écran. Ensuite, on reproduit le motif : un tapotement pour un court, un maintien pour un long.
 * Un symbole faux termine le défi.
 */
export function VibreChallenge({ target, onDone }: GameProps) {
  const [pattern] = useState<Stroke[]>(() =>
    Array.from({ length: target }, () => (Math.random() < 0.5 ? 'short' : 'long')),
  );
  const [lit, setLit] = useState<number | null>(null);
  const [listening, setListening] = useState(true);
  const [typed, setTyped] = useState<Stroke[]>([]);
  const [wrong, setWrong] = useState(false);
  const pressedAt = useRef<number | null>(null);
  const count = useRef(0);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // Le motif se joue une seule fois, au début du défi.
  useEffect(() => {
    const timers: number[] = [];
    let at = LEAD_MS;
    pattern.forEach((stroke, i) => {
      const length = stroke === 'short' ? SHORT_MS : LONG_MS;
      timers.push(
        window.setTimeout(() => {
          setLit(i);
          vibrate(length);
        }, at),
      );
      at += length;
      timers.push(window.setTimeout(() => setLit(null), at));
      at += STROKE_GAP_MS;
    });
    timers.push(window.setTimeout(() => setListening(false), at));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [pattern]);

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (listening || finished.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pressedAt.current = performance.now();
  }

  function onUp() {
    const from = pressedAt.current;
    pressedAt.current = null;
    if (from === null || listening || finished.current) return;
    const stroke: Stroke = performance.now() - from >= LONG_PRESS_MS ? 'long' : 'short';
    const i = count.current;
    if (stroke !== pattern[i]) {
      finished.current = true;
      setWrong(true);
      onDoneRef.current(i);
      return;
    }
    count.current = i + 1;
    setTyped((list) => [...list, stroke]);
    broadcast({ x: 0, y: 0, energy: count.current / target }, performance.now());
    if (count.current >= target) {
      finished.current = true;
      onDoneRef.current(target);
    }
  }

  const playing = lit === null ? null : pattern[lit]!;
  const hint = listening
    ? 'Écoutez le motif…'
    : wrong
      ? 'Raté : ce n’était pas le bon symbole.'
      : 'À vous : tapotez pour court, maintenez pour long.';

  return (
    <div className="mdf-challenge mdf-vibre">
      <div className="mdf-symbol-stage" aria-hidden="true">
        <span className={`mdf-symbol${playing ? ` is-${playing} is-lit` : ''}`} />
      </div>
      <p className="mdf-hint-line" aria-live="polite">
        {hint}
      </p>
      <div className="mdf-slots" aria-hidden="true">
        {pattern.map((_, i) => (
          <span key={i} className={`mdf-slot${typed[i] ? ` is-${typed[i]}` : ''}`} />
        ))}
      </div>
      <div
        className={`mdf-pad mdf-touch-none${listening ? ' is-waiting' : ''}`}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => {
          pressedAt.current = null;
        }}
      >
        <span>
          {listening ? '…' : canVibrate() ? 'Tapotez ou maintenez' : 'Tapotez ou maintenez (sans vibration ici)'}
        </span>
      </div>
    </div>
  );
}

/* ---------- Pince la taille : deux doigts, la bonne taille, tenue une seconde et demie ---------- */

/** Écart des doigts (en pixels) qui correspond à la taille de départ, soit une échelle de 1 (l’anneau fait 110 px). */
const PINCH_BASE_PX = 140;
const PINCH_TICK_MS = 100;

/**
 * Deux doigts règlent la taille d’un anneau sur celle du repère (dessiné en pointillés). La taille demandée est
 * tirée au hasard sur ce téléphone, entre 0,7 et 1,3 fois la taille de départ. Il faut la tenir.
 */
export function PinceChallenge({ target, onDone }: GameProps) {
  const [goal] = useState(() => 0.7 + Math.random() * 0.6);
  const [hold] = useState(() => new HoldTimer());
  const pointers = useRef(new Map<number, Point>());
  const latest = useRef(0);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const [scale, setScale] = useState(1);
  const [inside, setInside] = useState(false);
  const [held, setHeld] = useState(0);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  function refresh() {
    const points = [...pointers.current.values()];
    latest.current = points.length >= 2 ? pinchScale(pinchGap(points[0]!, points[1]!), PINCH_BASE_PX) : 0;
  }

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    refresh();
  }

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    refresh();
  }

  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    refresh();
  }

  // Le maintien se mesure à intervalle régulier : un doigt immobile doit aussi faire avancer le temps.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (finished.current) return;
      const s = latest.current;
      const zone = s > 0 && atScale(s, goal);
      const duration = hold.feed(zone, performance.now());
      if (s > 0) setScale(s);
      setInside(zone);
      setHeld(duration);
      broadcast({ x: 0, y: 0, energy: Math.min(1, duration / target) }, performance.now());
      if (duration >= target) {
        finished.current = true;
        onDoneRef.current(Math.round(duration));
      }
    }, PINCH_TICK_MS);
    return () => window.clearInterval(id);
  }, [goal, hold, target, broadcast]);

  return (
    <div className="mdf-challenge mdf-pince">
      <div className="mdf-pinch-stage" aria-hidden="true">
        <span className="mdf-pinch-ring is-goal" style={{ '--s': goal } as CSSProperties} />
        <span className={`mdf-pinch-ring is-now${inside ? ' is-ok' : ''}`} style={{ '--s': scale } as CSSProperties} />
      </div>
      <p className="mdf-hint-line" aria-live="polite">
        Maintenu : {(Math.min(held, target) / 1000).toFixed(1)} s / {(target / 1000).toFixed(1)} s
      </p>
      <div
        className="mdf-pad mdf-touch-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <span>Deux doigts, puis tenez</span>
      </div>
    </div>
  );
}

/* ---------- Lance le ballon : un seul geste vers le haut, assez fort ---------- */

/** Une seule fenêtre de mesure du geste : les derniers 300 ms avant le relâchement. */
const FLICK_KEEP_MS = 300;

/**
 * Un seul lancer. La valeur envoyée est la vitesse du doigt vers le haut, en centièmes de hauteur d’écran par
 * seconde : le défi se réussit dans une fenêtre, pour un lancer assez fort mais pas trop.
 */
export function LanceChallenge({ onDone }: GameProps) {
  const points = useRef<TimedPoint[]>([]);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (finished.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    points.current = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
  }

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (points.current.length === 0 || finished.current) return;
    const t = performance.now();
    points.current = [...points.current, { x: e.clientX, y: e.clientY, t }].filter((p) => t - p.t <= FLICK_KEEP_MS);
  }

  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (points.current.length === 0 || finished.current) return;
    const t = performance.now();
    const trail = [...points.current, { x: e.clientX, y: e.clientY, t }].filter((p) => t - p.t <= FLICK_KEEP_MS);
    points.current = [];
    finished.current = true;
    setSent(true);
    const speed = flickSpeed(trail, window.innerHeight);
    onDoneRef.current(Math.max(0, Math.round(speed * 100)));
  }

  return (
    <div className="mdf-challenge mdf-lance">
      <div
        className="mdf-pad mdf-touch-none mdf-flick-field"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          points.current = [];
        }}
      >
        <span className="mdf-goal" aria-hidden="true">
          🥅
        </span>
        <span className={`mdf-ball${sent ? ' is-sent' : ''}`} aria-hidden="true">
          ⚽
        </span>
      </div>
      <p className="mdf-hint-line" aria-live="polite">
        {sent ? 'Lancé !' : 'Glissez vers le haut, d’un seul geste.'}
      </p>
    </div>
  );
}
