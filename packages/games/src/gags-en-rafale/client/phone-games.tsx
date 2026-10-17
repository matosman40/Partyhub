import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useMotionFeed, type MotionFrame } from '../../client/sensors.js';
import { HoldTimer } from '../../client/sensors-core.js';
import {
  BALLOON_MAX_MS,
  BALLOON_MIN_MS,
  CREPE_MIN_MS,
  CREPE_SWIPE_RATIO,
  flyAt,
  isFlyHit,
  SCRATCH_MIN_MS,
  SCRATCH_SHARE,
  STATUE_MS,
  STILL_ACCEL,
  type Answer,
} from '../gags.js';

/**
 * Les gags vus du téléphone. Chacun joue avec son geste, et appelle `onDone` une seule fois, avec la réponse à juger.
 * `localStart` est l'instant du début du gag sur ce téléphone (horloge recalée sur le serveur).
 */

export interface ChallengeProps {
  localStart: number;
  seed: number;
  onDone: (answer: Answer) => void;
}

/** Temps écoulé depuis le début du gag, sur ce téléphone. */
function elapsedSince(localStart: number): number {
  return Math.max(0, performance.now() - localStart);
}

/** Position d'un pointeur dans une zone, de 0 à 1 sur chaque axe. */
function relative(e: { clientX: number; clientY: number }, box: DOMRect): { x: number; y: number } {
  const x = (e.clientX - box.left) / Math.max(1, box.width);
  const y = (e.clientY - box.top) / Math.max(1, box.height);
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** Message commun quand le téléphone ne transmet pas le mouvement. */
function NoSensor({ text }: { text: string }) {
  return (
    <p className="notice gag-nosensor" role="alert">
      {text}
    </p>
  );
}

/** Rafraîchit l'affichage dix fois par seconde, sans re-rendre à chaque mesure. */
function useDisplayTick(run: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!run) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 100);
    return () => window.clearInterval(id);
  }, [run]);
}

/** Crêpe : un glissement franc vers le haut, sur un tiers de l'aire de jeu. Le temps mis compte. */
export function SwipeChallenge({ localStart, onDone }: ChallengeProps) {
  const pad = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; height: number } | null>(null);
  const finished = useRef(false);
  const [lift, setLift] = useState(0);

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (finished.current || !pad.current) return;
    start.current = { y: e.clientY, height: pad.current.getBoundingClientRect().height };
    pad.current.setPointerCapture?.(e.pointerId);
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const from = start.current;
    if (!from || finished.current) return;
    const ratio = (from.y - e.clientY) / Math.max(1, from.height);
    setLift(Math.max(0, Math.min(1, ratio / CREPE_SWIPE_RATIO)));
    if (ratio >= CREPE_SWIPE_RATIO) {
      finished.current = true;
      onDone({ value: Math.max(CREPE_MIN_MS, Math.round(elapsedSince(localStart))) });
    }
  }

  function endSwipe() {
    start.current = null;
  }

  return (
    <div
      ref={pad}
      className="gag-pad gag-swipe"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={endSwipe}
      onPointerCancel={endSwipe}
    >
      <span className="gag-pad-icon" aria-hidden="true">
        🥞
      </span>
      <span className="gag-pad-text">⬆ Glissez vers le haut !</span>
      <span className="gag-lift" aria-hidden="true">
        <span style={{ transform: `scaleY(${lift.toFixed(3)})` }} />
      </span>
    </div>
  );
}

/** Mouche : la mouche bouge sans arrêt. Un tap à côté ne compte pas : on peut retenter tant que le temps dure. */
export function MoucheChallenge({ localStart, seed, onDone }: ChallengeProps) {
  const field = useRef<HTMLDivElement>(null);
  const fly = useRef<HTMLSpanElement>(null);
  const finished = useRef(false);
  const [miss, setMiss] = useState(0);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const p = flyAt(seed, elapsedSince(localStart));
      if (fly.current) {
        fly.current.style.left = `${p.x * 100}%`;
        fly.current.style.top = `${p.y * 100}%`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [localStart, seed]);

  function tap(e: ReactPointerEvent<HTMLDivElement>) {
    if (finished.current || !field.current) return;
    // L'instant est arrondi avant le test : le serveur juge la valeur reçue, pas l'instant exact.
    const value = Math.round(elapsedSince(localStart));
    const at = relative(e, field.current.getBoundingClientRect());
    if (isFlyHit(seed, value, at.x, at.y)) {
      finished.current = true;
      onDone({ value, x: at.x, y: at.y });
    } else {
      setMiss((m) => m + 1);
    }
  }

  return (
    <div ref={field} className="gag-pad gag-field" onPointerDown={tap} role="application" aria-label="Aire de jeu">
      <span ref={fly} className="gag-fly" aria-hidden="true">
        🪰
      </span>
      <span className="gag-pad-text" aria-live="polite">
        {miss > 0 ? 'Pschit… raté ! Encore.' : 'Tapez la mouche !'}
      </span>
    </div>
  );
}

/** Ce que dit le ballon pendant qu'on le gonfle : trop tôt, à point, ou trop tard. */
export function balloonHint(heldMs: number): string {
  if (heldMs < BALLOON_MIN_MS) return 'Encore un peu…';
  if (heldMs <= BALLOON_MAX_MS) return 'À point ! Relâchez';
  return 'Trop tard : relâchez vite !';
}

/** Ballon : on maintient pour gonfler, on relâche entre 0,9 et 1,5 seconde. Un seul relâchement compte. */
export function BalloonChallenge({ onDone }: ChallengeProps) {
  const pressedAt = useRef<number | null>(null);
  const finished = useRef(false);
  const [held, setHeld] = useState(0);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      if (pressedAt.current !== null) setHeld(performance.now() - pressedAt.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  function press(e: ReactPointerEvent<HTMLDivElement>) {
    if (finished.current || pressedAt.current !== null) return;
    pressedAt.current = performance.now();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function release() {
    if (finished.current || pressedAt.current === null) return;
    finished.current = true;
    onDone({ value: Math.round(performance.now() - pressedAt.current) });
  }

  const ripe = held >= BALLOON_MIN_MS && held <= BALLOON_MAX_MS;
  const late = held > BALLOON_MAX_MS;
  const size = 0.35 + (Math.min(held, 2500) / 2500) * 0.65;
  const hint = pressedAt.current === null ? 'Maintenez pour gonfler' : balloonHint(held);
  return (
    <div
      className={`gag-pad gag-balloon${ripe ? ' is-ripe' : ''}${late ? ' is-late' : ''}`}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="gag-balloon-body" style={{ transform: `scale(${size.toFixed(3)})` }} aria-hidden="true">
        🎈
      </span>
      <span className="gag-pad-text" aria-live="polite">
        {hint}
      </span>
    </div>
  );
}

/**
 * Surtout, ne touchez pas : le gros bouton est une tentation. Un seul tap compte, et il perd. Qui ne touche rien
 * gagne à la fin du gag, sans rien envoyer.
 */
export function WaitChallenge({ localStart, onDone }: ChallengeProps) {
  const finished = useRef(false);

  function tap() {
    if (finished.current) return;
    finished.current = true;
    onDone({ value: Math.round(elapsedSince(localStart)) });
  }

  return (
    <div className="gag-challenge gag-wait">
      <button type="button" className="gag-stop" onPointerDown={tap}>
        NE PAS TOUCHER
      </button>
      <p className="muted small">Attendez. Les mains sur les genoux. Vraiment.</p>
    </div>
  );
}

/** Statue : le téléphone doit rester immobile pendant la durée requise. Il faut le capteur de mouvement. */
export function StillChallenge({ onDone }: Omit<ChallengeProps, 'localStart' | 'seed'>) {
  const [hold] = useState(() => new HoldTimer());
  const [held, setHeld] = useState(0);
  const finished = useRef(false);
  const latest = useRef(0);

  const { signal } = useMotionFeed(true, (frame: MotionFrame) => {
    if (finished.current) return;
    const inside = frame.accel !== null && frame.accel < STILL_ACCEL;
    const duration = hold.feed(inside, frame.t);
    latest.current = duration;
    if (duration >= STATUE_MS) {
      finished.current = true;
      onDone({ value: Math.round(duration) });
    }
  });

  // Un rafraîchissement à dix fois par seconde suffit pour afficher la progression.
  useEffect(() => {
    const id = window.setInterval(() => setHeld(latest.current), 100);
    return () => window.clearInterval(id);
  }, []);
  useDisplayTick(signal !== 'no');

  if (signal === 'no') {
    // Hors HTTPS, le navigateur bloque le mouvement : on le dit, plutôt que d'accuser le téléphone.
    const insecure = typeof window !== 'undefined' && window.isSecureContext === false;
    return (
      <NoSensor
        text={
          insecure
            ? 'Le mouvement est bloqué parce que la page n’est pas en HTTPS. Ce gag ne peut pas être réussi.'
            : 'Ce téléphone ne transmet pas le mouvement : ce gag ne peut pas être réussi.'
        }
      />
    );
  }
  return (
    <div className="gag-challenge gag-still">
      <span className="gag-pad-icon" aria-hidden="true">
        🗿
      </span>
      <p className="gag-hint-line" aria-live="polite">
        Immobile : {(Math.min(held, STATUE_MS) / 1000).toFixed(1)} s / {(STATUE_MS / 1000).toFixed(1)} s
      </p>
    </div>
  );
}

const COLS = 8;
const ROWS = 5;

/** Gratte : passer le doigt sur le ticket. Quand la plus grande part est grattée, le gag est réussi. */
export function ScratchChallenge({ localStart, onDone }: ChallengeProps) {
  const card = useRef<HTMLDivElement>(null);
  const cells = useRef(new Uint8Array(COLS * ROWS));
  const scratching = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const finished = useRef(false);
  const [opened, setOpened] = useState(0);

  /** Gratte une case ; renvoie le nombre de cases grattées au total. */
  function mark(x: number, y: number, count: number): number {
    const col = Math.min(COLS - 1, Math.floor(x * COLS));
    const row = Math.min(ROWS - 1, Math.floor(y * ROWS));
    const index = row * COLS + col;
    if (cells.current[index]) return count;
    cells.current[index] = 1;
    return count + 1;
  }

  /** Grattage entre deux positions, pour ne pas sauter de case quand le doigt va vite. */
  function scratchTo(x: number, y: number) {
    const from = last.current ?? { x, y };
    const steps = Math.min(40, Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) * COLS * 3)));
    let count = cells.current.reduce((n, v) => n + v, 0);
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      count = mark(from.x + (x - from.x) * k, from.y + (y - from.y) * k, count);
    }
    last.current = { x, y };
    setOpened(count);
    if (!finished.current && count / cells.current.length >= SCRATCH_SHARE) {
      finished.current = true;
      onDone({ value: Math.max(SCRATCH_MIN_MS, Math.round(elapsedSince(localStart))) });
    }
  }

  function at(e: ReactPointerEvent<HTMLDivElement>) {
    if (!card.current) return null;
    return relative(e, card.current.getBoundingClientRect());
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (finished.current) return;
    const p = at(e);
    if (!p) return;
    scratching.current = true;
    card.current?.setPointerCapture?.(e.pointerId);
    scratchTo(p.x, p.y);
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (!scratching.current || finished.current) return;
    const p = at(e);
    if (p) scratchTo(p.x, p.y);
  }

  function up() {
    scratching.current = false;
    last.current = null;
  }

  const share = Math.round((opened / (COLS * ROWS)) * 100);
  return (
    <div className="gag-challenge gag-scratch">
      <div
        ref={card}
        className="gag-ticket"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="application"
        aria-label="Ticket à gratter"
      >
        <span className="gag-prize" aria-hidden="true">
          🍌
        </span>
        <div className="gag-cells" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {Array.from({ length: COLS * ROWS }, (_, i) => (
            <span key={i} className={cells.current[i] ? 'is-open' : undefined} />
          ))}
        </div>
      </div>
      <p className="gag-hint-line" aria-live="polite">
        Gratté : {share} %
      </p>
    </div>
  );
}
