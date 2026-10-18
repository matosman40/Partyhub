import { useEffect, useRef, useState } from 'react';
import { SENSOR_SEND_HZ } from '@partyhub/shared';
import { useMicLevel, useSensorBroadcast } from '../../client/sensors.js';
import { ClapDetector, CLAP_HIGH, HoldTimer } from '../../client/sensors-core.js';
import { NoSensor, type GameProps } from './phone-games.js';
import { useCameraLuma } from './camera-luma.js';

/**
 * Les défis qui écoutent le micro ou regardent la caméra. Le micro et la caméra ne quittent jamais le téléphone :
 * seul un nombre (claquements, durée de maintien) est envoyé au serveur.
 */

/* ---------- Applaudissez : cinq claquements près du micro ---------- */

/** Le micro est mesuré cinquante fois par seconde : un claquement dure moins longtemps qu’une mesure normale. */
const CLAP_SAMPLE_MS = 20;

export function ClapChallenge({ target, onDone }: GameProps) {
  const [detector] = useState(() => new ClapDetector());
  const [shown, setShown] = useState(0);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const { status, level } = useMicLevel(true, {
    intervalMs: CLAP_SAMPLE_MS,
    onLevel: (value, t) => {
      if (finished.current || !detector.feed(value, t)) return;
      const count = detector.pulses.count;
      setShown(count);
      broadcast({ x: 0, y: 0, energy: detector.pulses.energy }, t);
      if (count >= target) {
        finished.current = true;
        onDoneRef.current(count);
      }
    },
  });

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
    <div className="mdf-challenge mdf-blow mdf-clap">
      <p className="mdf-big-count" aria-live="polite">
        {shown} <span>/ {target}</span>
      </p>
      <div className="mdf-meter-big" role="img" aria-label="Niveau du micro">
        <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, level))})` }} />
        <i style={{ left: `${Math.round(CLAP_HIGH * 100)}%` }} />
      </div>
      <p className="mdf-hint-line">
        {status === 'starting' ? 'Micro en cours…' : 'Claquez des mains, près du micro !'}
      </p>
    </div>
  );
}

/* ---------- Cache la lumière : le doigt sur l’objectif arrière, deux secondes ---------- */

/** Sous cette luminosité de référence, la caméra ne voit presque rien : on ne peut pas savoir si l’objectif est couvert. */
const MIN_BASELINE = 30;
/** L’objectif est couvert quand la lumière tombe sous cette part de la référence. */
const COVER_RATIO = 0.4;
/** Mise à jour de l’affichage, dix fois par seconde. */
const VIEW_TICK_MS = 100;

/**
 * Le doigt couvre l’objectif arrière : la lumière mesurée chute. La référence est le maximum récent, qui redescend
 * lentement, pour qu’un changement de lumière dans la pièce ne fasse pas un faux défi. Aucune image n’est gardée.
 */
export function LumiereChallenge({ target, onDone }: GameProps) {
  const [hold] = useState(() => new HoldTimer());
  const reference = useRef(0);
  const latest = useRef({ covered: false, held: 0, luma: 0 });
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const [view, setView] = useState({ covered: false, held: 0, dark: false });
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  const status = useCameraLuma(true, (luma, t) => {
    if (finished.current) return;
    reference.current = Math.max(luma, reference.current * 0.995);
    const covered = reference.current >= MIN_BASELINE && luma < reference.current * COVER_RATIO;
    const duration = hold.feed(covered, t);
    latest.current = { covered, held: duration, luma: reference.current };
    broadcast({ x: 0, y: 0, energy: Math.min(1, duration / target) }, t);
    if (duration >= target) {
      finished.current = true;
      onDoneRef.current(Math.round(duration));
    }
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      const { covered, held, luma } = latest.current;
      setView({ covered, held, dark: luma < MIN_BASELINE });
    }, VIEW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  if (status === 'denied' || status === 'unavailable' || status === 'insecure') {
    const text =
      status === 'insecure'
        ? 'La caméra est bloquée parce que la page n’est pas en HTTPS.'
        : status === 'denied'
          ? 'La caméra est refusée : autorisez-la dans le navigateur pour ce défi.'
          : 'Ce téléphone ne donne pas accès à la caméra : ce défi ne peut pas être réussi.';
    return <NoSensor text={text} />;
  }

  const seconds = (ms: number) => `${(Math.min(ms, target) / 1000).toFixed(1)} s / ${(target / 1000).toFixed(1)} s`;
  let hint = 'Couvrez l’objectif arrière avec votre doigt…';
  if (status === 'starting') hint = 'Caméra en cours…';
  else if (status === 'ready' && view.dark) hint = 'Éclairez la pièce : la caméra voit trop peu de lumière.';
  else if (view.covered) hint = `Maintenu : ${seconds(view.held)}`;

  return (
    <div className="mdf-challenge mdf-lumiere">
      <div className={`mdf-sun${view.covered ? ' is-covered' : ''}`} aria-hidden="true" />
      <p className="mdf-hint-line" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}
