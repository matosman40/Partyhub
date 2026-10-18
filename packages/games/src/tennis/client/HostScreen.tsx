import { useEffect, useRef } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { isFreshReading, useSensors } from '../../client/sensors.js';
import {
  AUTO_BIAS,
  SERVE_DELAY_MS,
  SIDES,
  createRally,
  moveRackets,
  serve,
  stepRally,
  type Rally,
  type Side,
} from '../rules.js';
import { EMPTY_FRAME, drawCourt, type CourtFrame } from './draw.js';
import { SIDE_COLORS, type TennisPub, type TennisSeatView } from './types.js';

/** Un relevé plus vieux que ce délai ne pilote plus la raquette : le téléphone est éteint ou hors de portée. */
const FRESH_MS = 1200;
/** Délai avant le premier service, le temps de présenter les joueurs. */
const INTRO_MS = 1500;
const TRAIL = 8;
const FLASH_MS = 180;
const SEAT_AREA: Record<Side, string> = { 0: 'bottom', 1: 'top', 2: 'left', 3: 'right' };

/**
 * Tennis party, écran principal : le terrain et la balle sont calculés ici, à chaque image. Les coups réussis et
 * les balles perdues sont envoyés au serveur, qui tient les vies et les points. Une raquette suit le téléphone de
 * son joueur ; sans relevé récent (robot, téléphone sans capteur), elle se joue toute seule.
 */
export function TennisHost({ publicState, now, onAction }: HostViewProps) {
  const pub = publicState as TennisPub | null;
  if (!pub) return null;
  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;
  return <Court pub={pub} now={now} onAction={onAction} />;
}

function Court({ pub, now, onAction }: { pub: TennisPub; now: number; onAction: HostViewProps['onAction'] }) {
  const remaining = useRemaining(pub.endsAt, now);
  // Les relevés des téléphones et la vue du serveur sont lus à chaque image dans une référence : la boucle de
  // dessin n’est jamais relancée, et le terrain ne se redessine pas à chaque relevé.
  const sensors = useSensors();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ pub, sensors, onAction });
  latest.current = { pub, sensors, onAction };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let rally: Rally | null = null;
    let live = false;
    let serveAt = 0;
    let trail: { x: number; y: number }[] = [];
    const flash = SIDES.map(() => 0);
    let reported = false;

    /** Une image de la partie : fait avancer l’échange et renvoie ce qu’il faut dessiner. */
    const advance = (t: number): CourtFrame => {
      const { pub: view, sensors: readings, onAction: send } = latest.current;
      if (view.phase !== 'play') {
        rally = null;
        live = false;
        trail = [];
        return EMPTY_FRAME;
      }

      const wall = performance.now();
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      const seats = SIDES.map((side) => view.seats.find((seat) => seat.side === side));
      const active = seats.map((seat) => Boolean(seat?.alive && seat.playerId));

      if (!rally) {
        rally = createRally(active, Math.random);
        live = false;
        serveAt = wall + INTRO_MS;
      }
      const r: Rally = rally;
      r.active = active;
      SIDES.forEach((side) => {
        const seat = seats[side];
        const reading = seat?.playerId ? readings[seat.playerId] : undefined;
        r.aim[side] = seat && isFreshReading(reading, wall, FRESH_MS) && reading ? reading.x : null;
      });

      if (!live && wall >= serveAt) {
        r.ball = serve(active, Math.random);
        r.bias = SIDES.map(() => (Math.random() * 2 - 1) * AUTO_BIAS);
        live = true;
        trail = [];
      }

      if (live) {
        for (const event of stepRally(r, dt)) {
          if (event.type === 'hit') {
            flash[event.side] = 1;
            void send?.('hit', { side: event.side });
            continue;
          }
          // Balle perdue : le serveur retire une vie, puis le service reprend après une courte pause.
          void send?.('lost', { side: event.side });
          live = false;
          serveAt = wall + SERVE_DELAY_MS;
          trail = [];
          break;
        }
        if (live) {
          trail.push({ x: r.ball.x, y: r.ball.y });
          if (trail.length > TRAIL) trail.shift();
        }
      } else {
        // Pendant la pause, les raquettes suivent quand même leur téléphone.
        moveRackets(r, Math.min(0.05, dt));
      }

      for (const side of SIDES) flash[side] = Math.max(0, (flash[side] ?? 0) - (dt * 1000) / FLASH_MS);
      return {
        sides: SIDES.map((side) => ({
          active: r.active[side] ?? false,
          pos: r.pos[side] ?? 0.5,
          flash: flash[side] ?? 0,
        })),
        ball: { x: r.ball.x, y: r.ball.y, visible: live },
        trail,
      };
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const cssW = canvas.clientWidth || 480;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.round(cssW * dpr);
        if (canvas.width !== bw || canvas.height !== bw) {
          canvas.width = bw;
          canvas.height = bw;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawCourt(ctx, cssW, advance(t));
      } catch (err) {
        // Une erreur de dessin ne doit jamais figer l’écran : on la signale une seule fois, la boucle continue.
        if (!reported) {
          reported = true;
          console.error('Tennis : erreur de dessin', err);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="game-host fade-in tennis-host">
      <header className="tennis-head">
        <h2 className="tennis-title">Tennis party</h2>
        <p className="tennis-rule muted">
          Chaque joueur défend son côté. {pub.lives} vie{pub.lives > 1 ? 's' : ''} chacun : une balle ratée en coûte une.
        </p>
      </header>
      <div className="tennis-court-wrap">
        {SIDES.map((side) => {
          const seat = pub.seats.find((s) => s.side === side);
          return seat ? <SeatCard key={side} seat={seat} area={SEAT_AREA[side]} side={side} /> : null;
        })}
        <div className="tennis-court-box">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Terrain de tennis"
            className="tennis-court"
            style={{ width: '100%' }}
          />
        </div>
      </div>
      <TimerBar remaining={remaining} total={pub.matchMs} />
    </section>
  );
}

/** Un joueur sur son côté : son personnage de profil, ses vies et ses points. */
function SeatCard({ seat, area, side }: { seat: TennisSeatView; area: string; side: Side }) {
  if (!seat.playerId || !seat.name) {
    return (
      <div className="tennis-seat is-empty" style={{ gridArea: area }}>
        <span className="muted">Côté libre</span>
      </div>
    );
  }
  return (
    <div
      className={`tennis-seat${seat.alive ? '' : ' is-out'}`}
      style={{ gridArea: area, borderColor: SIDE_COLORS[side] }}
    >
      <Avatar name={seat.name} size="md" />
      <span className="tennis-seat-name">{seat.name}</span>
      <span className="tennis-hearts" role="img" aria-label={`${seat.lives} vie${seat.lives > 1 ? 's' : ''}`}>
        {seat.alive ? '❤'.repeat(seat.lives) : 'Éliminé'}
      </span>
      <span className="tennis-points">{seat.points} pts</span>
    </div>
  );
}
