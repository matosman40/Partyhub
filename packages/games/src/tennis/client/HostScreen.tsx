import { useEffect, useRef, useState } from 'react';
import type { CharacterMood } from '@partyhub/shared';
import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, Countdown, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { isFreshReading, useSensors } from '../../client/sensors.js';
import {
  AUTO_BIAS,
  SERVE_DELAY_MS,
  SIDES,
  SIDE_NAMES,
  createRally,
  moveRackets,
  serve,
  stepRally,
  type Rally,
  type Side,
} from '../rules.js';
import type { TennisMatchView, TournamentRow, TournamentView } from '../module.js';
import { Athlete } from './Athlete.js';
import { drawBackdrop, drawCourt, drawNet } from './court.js';
import { handOf, layoutFor, project, standAt, strikeAt, type Layout, type Point } from './geometry.js';
import { SIDE_COLORS, type TennisPub, type TennisSeatView } from './types.js';

/** Un relevé plus vieux que ce délai ne pilote plus la raquette : le téléphone est éteint ou hors de portée. */
const FRESH_MS = 1200;
/** Délai avant le premier service, le temps de présenter les joueurs. */
const INTRO_MS = 1500;
/** Coup de raquette : la raquette part en arrière puis revient en `SWING_MS`. */
const SWING_MS = 220;
const SWING_DEG = 62;
/** Durée de l’arc de la balle après chaque coup, et hauteur maximale (fraction de la largeur de scène). */
const FLIGHT_MS = 650;
const LIFT = 0.05;
/** Humeurs : joie après un coup réussi, tristesse après une balle perdue. */
const JOY_MS = 900;
const SAD_MS = 1400;
/** Pied du personnage, en fraction de sa hauteur : le cadre laisse un peu de place sous les chaussures. */
const FEET = 0.92;
/** Taille de l’anneau de frappe, en fraction de la largeur de scène. */
const RING = 0.07;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Au tennis, le service part vers le joueur qui reçoit (le côté opposé au serveur). Hors match de tennis, le côté est
 * tiré au hasard : undefined.
 */
function receiverSide(pub: TennisPub): Side | undefined {
  const m = pub.match;
  if (!m || m.rules !== 'tennis') return undefined;
  return m.server === 0 ? 1 : 0;
}

/**
 * Tennis party, écran principal. Pendant un match : terrain en vue isométrique, avec le score au-dessus. Entre deux
 * matchs d’un championnat : le tableau et le prochain match. À la fin : le classement.
 *
 * Le fond et la surface sont dessinés une fois sur un canevas ; les joueurs, leurs raquettes et la balle sont des
 * éléments HTML placés à chaque image. Les coups réussis et les balles perdues sont envoyés au serveur, qui tient le
 * score. Une raquette suit le téléphone de son joueur ; sans relevé récent (robot, téléphone sans capteur), elle se
 * joue toute seule.
 */
export function TennisHost({ publicState, now, onAction }: HostViewProps) {
  const pub = publicState as TennisPub | null;
  if (!pub) return null;
  if (pub.phase === 'final') return <TennisFinal pub={pub} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;
  if (pub.phase === 'pause') return <TournamentPanel pub={pub} now={now} />;
  return <Court pub={pub} now={now} onAction={onAction} />;
}

function Court({ pub, now, onAction }: { pub: TennisPub; now: number; onAction: HostViewProps['onAction'] }) {
  const remaining = useRemaining(pub.endsAt, now);
  // Les relevés des téléphones et la vue du serveur sont lus à chaque image dans une référence : la boucle
  // d’animation n’est jamais relancée.
  const sensors = useSensors();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const netRef = useRef<HTMLCanvasElement>(null);
  const roots = useRef<(HTMLDivElement | null)[]>([]);
  const bats = useRef<(HTMLSpanElement | null)[]>([]);
  // Humeur de chaque joueur : seule chose de cette vue qui passe par React (rare : à chaque coup ou balle perdue).
  const [moods, setMoods] = useState<CharacterMood[]>(() => SIDES.map((): CharacterMood => 'idle'));
  const latest = useRef({ pub, sensors, onAction });
  latest.current = { pub, sensors, onAction };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let width = 480;
    let rally: Rally | null = null;
    let live = false;
    let serveAt = 0;
    let lastBallAt = 0;
    let drawnKey = '';
    let reported = false;
    const swingAt = SIDES.map(() => -1e9);
    const angle = SIDES.map(() => 0);
    const timers: number[] = [];

    /** Change l’humeur d’un joueur pour un moment, puis la remet au repos. */
    const mood = (side: Side, value: CharacterMood, ms: number) => {
      setMoods((prev) => prev.map((v, i) => (i === side ? value : v)));
      timers.push(
        window.setTimeout(() => setMoods((prev) => prev.map((v, i) => (i === side && v === value ? 'idle' : v))), ms),
      );
    };

    /** Anneau blanc qui s’élargit à l’endroit du coup. */
    const ring = (p: Point) => {
      const el = ringRef.current;
      if (!el || typeof el.animate !== 'function') return;
      const size = width * RING;
      el.animate(
        [
          { transform: `translate(${p.x - size / 2}px, ${p.y - size / 2}px) scale(0.3)`, opacity: 0.95 },
          { transform: `translate(${p.x - size / 2}px, ${p.y - size / 2}px) scale(1.5)`, opacity: 0 },
        ],
        { duration: 360, easing: 'ease-out' },
      );
    };

    /** Redessine le fond et le terrain seulement quand la taille ou les côtés défendus changent. */
    const draw = (canvas: HTMLCanvasElement, g: Layout, active: boolean[]) => {
      const dpr = window.devicePixelRatio || 1;
      const key = `${g.W}|${active.map((a) => (a ? 1 : 0)).join('')}`;
      if (key === drawnKey) return;
      drawnKey = key;
      canvas.width = Math.round(g.W * dpr);
      canvas.height = Math.round(g.H * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackdrop(ctx, g);
      drawCourt(ctx, g, active);
    };

    /** Le filet a sa propre couche, placée selon sa profondeur entre les joueurs du fond et ceux du premier plan. */
    let netKey = '';
    const drawNetLayer = (net: HTMLCanvasElement, g: Layout) => {
      const key = String(g.W);
      if (key !== netKey) {
        netKey = key;
        const dpr = window.devicePixelRatio || 1;
        net.width = Math.round(g.W * dpr);
        net.height = Math.round(g.H * dpr);
        const ctx = net.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawNet(ctx, g);
        }
      }
      net.style.zIndex = String(Math.round(project(g, 0.5, 0.5).y));
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      try {
        const stage = stageRef.current;
        const canvas = canvasRef.current;
        if (!stage || !canvas) return;
        const g = layoutFor(stage.clientWidth || 480);
        width = g.W;
        const net = netRef.current;
        if (net) drawNetLayer(net, g);
        const wall = performance.now();
        const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
        last = t;

        const { pub: view, sensors: readings, onAction: send } = latest.current;
        if (view.phase !== 'play') {
          rally = null;
          live = false;
          if (ballRef.current) ballRef.current.style.visibility = 'hidden';
          if (shadowRef.current) shadowRef.current.style.visibility = 'hidden';
          return;
        }

        const seats = SIDES.map((side) => view.seats.find((seat) => seat.side === side));
        const active = seats.map((seat) => Boolean(seat?.alive && seat.playerId));
        const toward = receiverSide(view);
        draw(canvas, g, active);

        if (!rally) {
          rally = createRally(active, Math.random, toward);
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
          r.ball = serve(active, Math.random, toward);
          r.bias = SIDES.map(() => (Math.random() * 2 - 1) * AUTO_BIAS);
          live = true;
          lastBallAt = wall;
        }

        if (live) {
          for (const event of stepRally(r, dt)) {
            if (event.type === 'hit') {
              swingAt[event.side] = wall;
              lastBallAt = wall;
              const s = strikeAt(event.side, r.pos[event.side] ?? 0.5);
              ring(project(g, s.u, s.v));
              mood(event.side, 'joy', JOY_MS);
              void send?.('hit', { side: event.side });
              continue;
            }
            // Balle perdue : le serveur retire une vie (ou donne le point), puis le service reprend après une pause.
            mood(event.side, 'sad', SAD_MS);
            void send?.('lost', { side: event.side });
            live = false;
            serveAt = wall + SERVE_DELAY_MS;
            break;
          }
        } else {
          // Pendant la pause, les raquettes suivent quand même leur téléphone.
          moveRackets(r, Math.min(0.05, dt));
        }

        // Balle : arc visuel après chaque coup, et ombre au sol qui rétrécit quand elle monte.
        const lift = live ? LIFT * Math.sin(Math.PI * clamp01((wall - lastBallAt) / FLIGHT_MS)) : 0;
        const ball = ballRef.current;
        const shadow = shadowRef.current;
        if (ball) {
          const air = project(g, r.ball.x, r.ball.y, lift);
          const ground = project(g, r.ball.x, r.ball.y);
          const d = 2 * g.ballR;
          ball.style.visibility = live ? 'visible' : 'hidden';
          ball.style.width = `${d}px`;
          ball.style.height = `${d}px`;
          ball.style.transform = `translate(${air.x - g.ballR}px, ${air.y - g.ballR}px)`;
          ball.style.zIndex = String(Math.round(ground.y) + 1);
          if (shadow) {
            const s = d * 1.7 * (1 - lift * 6);
            shadow.style.visibility = live ? 'visible' : 'hidden';
            shadow.style.width = `${s}px`;
            shadow.style.height = `${s * 0.5}px`;
            shadow.style.transform = `translate(${ground.x - s / 2}px, ${ground.y - s / 4}px)`;
          }
        }

        // Joueurs : plus ils sont près du spectateur, plus ils sont grands ; leur raquette suit la balle.
        SIDES.forEach((side) => {
          const root = roots.current[side];
          if (!root) return;
          const stand = standAt(side, r.pos[side] ?? 0.5);
          const feet = project(g, stand.u, stand.v);
          const near = clamp01((feet.y - g.yFar) / (g.yNear - g.yFar));
          const scale = 0.72 + 0.4 * near;
          const left = feet.x - g.figW / 2;
          const topPx = feet.y - FEET * g.figH;
          root.style.transform = `translate(${left}px, ${topPx}px) scale(${scale})`;
          root.style.zIndex = String(Math.round(feet.y));

          const bat = bats.current[side];
          if (!bat || !active[side]) return;
          // Position de la main dans le repère du personnage (avant la mise à l’échelle, qui se fait au pied).
          const hand = handOf(g, feet);
          const lx = g.figW / 2 + (hand.x - feet.x) / scale;
          const ly = FEET * g.figH + (hand.y - feet.y) / scale;
          const aim = project(g, r.ball.x, r.ball.y, lift);
          const dx = aim.x - hand.x;
          const dy = aim.y - hand.y;
          if (Math.hypot(dx, dy) > g.figH * 0.25) {
            const want = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
            angle[side] = (angle[side] ?? 0) + wrapDeg(want - (angle[side] ?? 0)) * (1 - Math.exp(-dt * 14));
          }
          const since = wall - (swingAt[side] ?? 0);
          const swing = since < SWING_MS ? -SWING_DEG * (1 - since / SWING_MS) : 0;
          const batWidth = g.racketH * 0.5;
          const tilt = wrapDeg((angle[side] ?? 0) + swing);
          // Raquette levée vers le haut : elle passe derrière le personnage, pour ne pas cacher son visage.
          bat.style.zIndex = Math.abs(tilt) < 50 ? '-1' : '1';
          bat.style.transform = `translate(${lx - batWidth / 2}px, ${ly - g.racketH}px) rotate(${tilt}deg)`;
        });
      } catch (err) {
        // Une erreur de dessin ne doit jamais figer l’écran : on la signale une seule fois, la boucle continue.
        if (!reported) {
          reported = true;
          console.error('Tennis : erreur de dessin', err);
        }
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const match = pub.match;
  return (
    <section className="game-host fade-in tennis-host">
      <header className="tennis-head">
        <h2 className="tennis-title">Tennis party</h2>
        <p className="tennis-rule muted">{ruleLine(pub)}</p>
      </header>
      {match && <MatchBar match={match} />}
      <div className="tennis-court-wrap">
        <div className="tennis-hud">
          {SIDES.map((side) => (
            <HudChip
              key={side}
              side={side}
              seat={pub.seats.find((s) => s.side === side)}
              match={match}
              championship={pub.tournament !== null}
            />
          ))}
        </div>
        <div className="tennis-stage" ref={stageRef}>
          <canvas ref={canvasRef} className="tennis-canvas" role="img" aria-label="Terrain de tennis" />
          <canvas ref={netRef} className="tennis-net" aria-hidden="true" />
          <div ref={shadowRef} className="tennis-shadow" aria-hidden="true" />
          {SIDES.map((side) => {
            const seat = pub.seats.find((s) => s.side === side);
            if (!seat?.playerId || !seat.name) return null;
            const out = !seat.alive;
            return (
              <Athlete
                key={seat.playerId}
                side={side}
                name={seat.name}
                mood={out ? 'sad' : (moods[side] ?? 'idle')}
                active={!out}
                out={out}
                tagBelow={side === 1}
                rootRef={(el) => {
                  roots.current[side] = el;
                }}
                racketRef={(el) => {
                  bats.current[side] = el;
                }}
              />
            );
          })}
          <div ref={ballRef} className="tennis-ball" aria-hidden="true" />
          <div ref={ringRef} className="tennis-ring" aria-hidden="true" />
        </div>
      </div>
      <TimerBar remaining={remaining} total={pub.matchMs} />
    </section>
  );
}

/** Phrase de règles, sous le titre. */
function ruleLine(pub: TennisPub): string {
  if (pub.rules === 'tennis') {
    const length = pub.sets === 3 ? 'meilleur de trois sets' : 'un set';
    return `Règles du tennis, ${length}. Une balle ratée donne le point à l’adversaire.`;
  }
  return `Chaque joueur défend son côté. ${pub.lives} vie${pub.lives > 1 ? 's' : ''} chacun : une balle ratée en coûte une.`;
}

/** Le match en cours : son tour, les joueurs, et le score (sets et jeux en règles du tennis, vies sinon). */
function MatchBar({ match }: { match: TennisMatchView }) {
  return (
    <div className="tennis-matchbar" aria-live="polite">
      {match.label && <span className="tennis-match-label">{match.label}</span>}
      <span className="tennis-match-names">
        {match.names[0]} <span className="muted">contre</span> {match.names[1]}
      </span>
      {match.rules === 'tennis' ? (
        <span className="tennis-match-score">
          Sets {match.sets[0]}–{match.sets[1]} · Jeux {match.games}
          {match.tiebreak ? ' · tie-break' : ''}
        </span>
      ) : (
        <span className="tennis-match-score">
          Vies {match.lives[0]}–{match.lives[1]}
        </span>
      )}
    </div>
  );
}

/** Un côté du terrain : le joueur qui le défend, son score (point, ou vies) et son service. */
function HudChip({
  side,
  seat,
  match,
  championship,
}: {
  side: Side;
  seat: TennisSeatView | undefined;
  match: TennisMatchView | null;
  /** En championnat, les points ne sont distribués qu’à la fin : on n’affiche que les vies. */
  championship: boolean;
}) {
  if (!seat?.playerId || !seat.name) {
    return (
      <div className="tennis-chip is-empty">
        <span className="muted">Côté {SIDE_NAMES[side]} libre</span>
      </div>
    );
  }
  const tennis = match?.rules === 'tennis' && (side === 0 || side === 1) ? match : null;
  const serving = tennis !== null && tennis.server === side;
  return (
    <div className={`tennis-chip${seat.alive ? '' : ' is-out'}`} style={{ borderColor: SIDE_COLORS[side] }}>
      <Avatar name={seat.name} size="sm" />
      <div className="tennis-chip-text">
        <span className="tennis-chip-name">
          {seat.name}
          {serving && (
            <span className="tennis-serve" role="img" aria-label="Il sert">
              {' '}
              ●
            </span>
          )}
        </span>
        <span className="tennis-chip-stats">
          {tennis ? (
            <span className="tennis-points">{tennis.points[side === 1 ? 1 : 0]}</span>
          ) : (
            <>
              <span className="tennis-hearts" role="img" aria-label={`${seat.lives} vie${seat.lives > 1 ? 's' : ''}`}>
                {seat.alive ? '❤'.repeat(seat.lives) : 'Éliminé'}
              </span>
              {championship || <span className="tennis-points">{seat.points} pts</span>}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** Entre deux matchs : le prochain match, avec son compte à rebours, et le tableau du championnat. */
function TournamentPanel({ pub, now }: { pub: TennisPub; now: number }) {
  const remaining = useRemaining(pub.endsAt, now);
  const t = pub.tournament;
  const next = t?.matches.find((m) => m.status === 'waiting' && m.a !== null && m.b !== null && !m.bye);
  return (
    <section className="game-host fade-in tennis-host tennis-tour">
      <h2 className="tennis-title">{t?.kind === 'poule' ? 'Championnat en poule' : 'Tableau à élimination'}</h2>
      {next ? (
        <p className="tennis-next">
          {next.label} : <strong>{next.a}</strong> <span className="muted">contre</span> <strong>{next.b}</strong>
        </p>
      ) : (
        <p className="tennis-next muted">Tous les matchs sont joués.</p>
      )}
      {next && (
        <div className="tennis-countdown">
          <span className="muted">Départ dans</span>
          <Countdown remaining={remaining} />
        </div>
      )}
      {t && <TournamentBoard tournament={t} rules={pub.rules} />}
    </section>
  );
}

/** Fin de partie : le podium du classement, puis le détail du championnat s’il y en a un. */
function TennisFinal({ pub }: { pub: TennisPub }) {
  return (
    <div className="tennis-final">
      <FinalHost ranking={pub.ranking} />
      {pub.tournament && (
        <section className="game-host fade-in tennis-host tennis-tour">
          <TournamentBoard tournament={pub.tournament} rules={pub.rules} />
        </section>
      )}
    </div>
  );
}

/** Tableau du championnat : classement de la poule, et liste des matchs avec leur résultat. */
function TournamentBoard({ tournament, rules }: { tournament: TournamentView; rules: TennisPub['rules'] }) {
  return (
    <div className="tennis-board">
      {tournament.standings && (
        <table className="tennis-table">
          <thead>
            <tr>
              <th scope="col">Rang</th>
              <th scope="col">Joueur</th>
              <th scope="col">Matchs</th>
              <th scope="col">V</th>
              <th scope="col">N</th>
              <th scope="col">D</th>
              <th scope="col">{rules === 'tennis' ? 'Sets' : 'Vies'}</th>
              <th scope="col">Points</th>
            </tr>
          </thead>
          <tbody>
            {tournament.standings.map((row) => (
              <tr key={row.id}>
                <td>{row.rank}</td>
                <td>{row.name}</td>
                <td>{row.played}</td>
                <td>{row.won}</td>
                <td>{row.drawn}</td>
                <td>{row.lost}</td>
                <td>
                  {row.wins[0]}–{row.wins[1]}
                </td>
                <td>{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ol className="tennis-matches">
        {tournament.matches.map((m) => (
          <li key={m.id} className={`tennis-row is-${m.status}`}>
            <span className="tennis-row-label">{m.label}</span>
            <span className="tennis-row-names">{rowNames(m)}</span>
            <span className="tennis-row-result">{rowResult(m, rules, tournament.kind)}</span>
          </li>
        ))}
      </ol>
      {tournament.champion && (
        <p className="tennis-champion">
          Champion : <strong>{tournament.champion}</strong> 🏆
        </p>
      )}
    </div>
  );
}

function rowNames(m: TournamentRow): string {
  if (m.bye) return `${m.a ?? m.b ?? '?'} est exempté`;
  return `${m.a ?? '…'} contre ${m.b ?? '…'}`;
}

function rowResult(m: TournamentRow, rules: TennisPub['rules'], kind: TournamentView['kind']): string {
  if (m.status === 'bye') return 'Exempt';
  if (m.status === 'playing') return 'En cours';
  if (!m.result) return 'À venir';
  const { wins, scored } = m.result;
  // Au temps limite, un match aux règles du tennis peut finir sans set gagné : on donne alors les jeux.
  const timed = rules === 'tennis' && wins[0] === 0 && wins[1] === 0;
  const score = timed
    ? `${scored[0]}–${scored[1]} jeux`
    : `${wins[0]}–${wins[1]} ${rules === 'tennis' ? 'sets' : 'vies'}`;
  if (m.result.winner === null) return kind === 'poule' ? `Nul (${score})` : `Nul (${score}), à rejouer`;
  return `${m.winner ?? ''} gagne${timed ? ' au temps' : ''}, ${score}`;
}
