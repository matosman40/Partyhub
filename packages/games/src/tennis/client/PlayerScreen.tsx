import { useEffect, useRef, useState } from 'react';
import { SENSOR_SEND_HZ } from '@partyhub/shared';
import type { PlayerViewProps } from '../../client/types.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { useMotionFeed, useSensorBroadcast } from '../../client/sensors.js';
import { SIDE_NAMES, aimFromTilt, isHorizontal, racketTarget, type Side } from '../rules.js';
import { SIDE_COLORS, type TennisMe, type TennisPub } from './types.js';

/**
 * Tennis party, téléphone : la raquette suit l’inclinaison, ou les boutons (ou les flèches) à défaut. La commande
 * est envoyée à l’écran principal à chaque instant, sur le canal des capteurs : rien n’est enregistré.
 */
export function TennisPlayer({ publicState, playerState }: PlayerViewProps) {
  const pub = publicState as TennisPub | null;
  const me = playerState as TennisMe | null;
  const side: Side | null = me?.side ?? null;
  const live = Boolean(pub?.phase === 'play' && me?.alive && side !== null);

  // Commande de l’inclinaison, et commande des boutons ou des flèches (prioritaire quand elle est active).
  const tiltAim = useRef(0);
  const heldAim = useRef(0);
  const [shown, setShown] = useState(0);
  const broadcast = useSensorBroadcast(SENSOR_SEND_HZ);

  const { signal, recalibrate } = useMotionFeed(live, (frame) => {
    if (side !== null) tiltAim.current = aimFromTilt(side, frame.tilt);
  });

  // Envoi des commandes au rythme des capteurs, et affichage de la raquette dix fois par seconde.
  useEffect(() => {
    if (!live) return;
    const send = window.setInterval(() => {
      const aim = heldAim.current !== 0 ? heldAim.current : tiltAim.current;
      broadcast({ x: aim, y: 0, energy: Math.min(1, Math.abs(aim)) }, performance.now());
    }, 1000 / SENSOR_SEND_HZ);
    const view = window.setInterval(() => {
      setShown(heldAim.current !== 0 ? heldAim.current : tiltAim.current);
    }, 100);
    return () => {
      window.clearInterval(send);
      window.clearInterval(view);
      heldAim.current = 0;
      tiltAim.current = 0;
    };
  }, [live, broadcast]);

  // Flèches du clavier : celles du côté du joueur (gauche et droite pour bas et haut, haut et bas sinon).
  useEffect(() => {
    if (!live || side === null) return;
    const horizontal = isHorizontal(side);
    const low = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const high = horizontal ? 'ArrowRight' : 'ArrowDown';
    const down = (e: KeyboardEvent) => {
      if (e.key === low) heldAim.current = -1;
      else if (e.key === high) heldAim.current = 1;
      else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === low || e.key === high) heldAim.current = 0;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [live, side]);

  if (!pub) return null;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="Vous défendez un côté du terrain sur l’écran principal." />;
  }
  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={null} />;
  if (side === null) {
    return <WaitingScreen title="La partie est lancée" text="Vous n’avez pas de côté dans cette partie." />;
  }
  if (!me?.alive) {
    return (
      <section className="player-game fade-in tennis-player">
        <p className="big">Éliminé</p>
        <p className="muted">Suivez la fin de la partie sur l’écran principal.</p>
      </section>
    );
  }

  const horizontal = isHorizontal(side);
  const color = SIDE_COLORS[side];
  const place = `${racketTarget(shown) * 100}%`;
  // La taille de la raquette vient du CSS (20 % du côté) ; seule sa place change en direct.
  const racket = { background: color, ...(horizontal ? { left: place } : { top: place }) };
  // Boutons : sens de l’écran principal (gauche ou haut = -1, droite ou bas = +1).
  const [lowLabel, highLabel] = horizontal ? ['◀', '▶'] : ['▲', '▼'];
  const [lowName, highName] = horizontal
    ? ['vers la gauche', 'vers la droite']
    : ['vers le haut', 'vers le bas'];

  const press = (value: -1 | 1) => () => {
    heldAim.current = value;
  };
  const release = () => {
    heldAim.current = 0;
  };

  return (
    <section className={`player-game fade-in tennis-player ${horizontal ? 'is-horizontal' : 'is-vertical'}`}>
      <p className="tennis-side" style={{ color }}>
        Votre côté : {SIDE_NAMES[side]}
      </p>
      <p className="tennis-status">
        {'❤'.repeat(me.lives)} · {me.points} pts
      </p>
      <div className="tennis-track" aria-hidden="true">
        <span className="tennis-racket" style={racket} />
      </div>
      <div className="tennis-pad">
        <button
          type="button"
          className="tennis-btn"
          aria-label={`Raquette ${lowName}`}
          onPointerDown={press(-1)}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
        >
          {lowLabel}
        </button>
        <button
          type="button"
          className="tennis-btn"
          aria-label={`Raquette ${highName}`}
          onPointerDown={press(1)}
          onPointerUp={release}
          onPointerLeave={release}
          onPointerCancel={release}
        >
          {highLabel}
        </button>
      </div>
      <p className="muted small">
        {signal === 'no'
          ? 'Ce téléphone ne transmet pas l’inclinaison : utilisez les boutons.'
          : 'Penchez le téléphone pour glisser la raquette, ou utilisez les boutons.'}
      </p>
      <button type="button" className="btn ghost small" onClick={recalibrate}>
        Recentrer
      </button>
    </section>
  );
}
