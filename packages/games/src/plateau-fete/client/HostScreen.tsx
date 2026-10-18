import { useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { defaultCharacterFor, type CharacterMood } from '@partyhub/shared';
import type { HostViewProps } from '../../client/types.js';
import { AvatarsContext } from '../../client/avatar-context.js';
import { Character } from '../../client/character.js';
import { Avatar, Countdown, TimerBar } from '../../client/ui.js';
import { useRemaining } from '../../client/hooks.js';
import { TIMING, MINIGAME_EVERY, TURNS, RING, STAR_COST, wrap } from '../rules.js';
import { Die } from './Die.js';
import { KIND_LOOK, depthScale, kindOf, ringPoint, slotOffset } from './ring.js';
import type { EventView, MiniView, MoveView, PlateauPlayerView, PlateauPub } from './types.js';

/** Écran principal : le plateau en perspective, les pions, les annonces du tour et les mini-jeux. */
export function PlateauHost({ publicState, now }: HostViewProps) {
  const pub = publicState as PlateauPub | null;
  const shown = useSteppedCells(pub);
  if (!pub) return null;
  return (
    <section className={`pf-host pf-phase-${pub.phase}`} aria-label="Plateau fête">
      <TopBar pub={pub} now={now} />
      <div className="pf-body">
        <aside className="pf-side" aria-label="Classement">
          <Standings pub={pub} />
          <Legend />
        </aside>
        <Board pub={pub} now={now} shown={shown} />
      </div>
      {pub.phase === 'final' && <Podium pub={pub} />}
    </section>
  );
}

/**
 * Positions affichées des pions. Quand le serveur annonce un déplacement (`moveStamp` change), le pion avance case
 * par case, au rythme `TIMING.step`, au lieu de sauter directement à sa case finale.
 */
function useSteppedCells(pub: PlateauPub | null): Record<string, number> {
  const [shown, setShown] = useState<Record<string, number>>({});
  const latest = useRef(pub);
  latest.current = pub;
  const stamp = pub?.moveStamp ?? 0;

  useEffect(() => {
    const moves: MoveView[] = latest.current?.moves ?? [];
    if (moves.length === 0) return;
    const longest = Math.max(...moves.map((m) => m.path.length));
    const timers: number[] = [];
    for (let k = 0; k < longest; k++) {
      timers.push(
        window.setTimeout(
          () => {
            setShown((prev) => {
              const next = { ...prev };
              for (const m of moves) if (k < m.path.length) next[m.id] = m.path[k]!;
              return next;
            });
          },
          (k + 1) * TIMING.step,
        ),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [stamp]);

  return shown;
}

function TopBar({ pub, now }: { pub: PlateauPub; now: number }) {
  const remaining = useRemaining(pub.nextAt || undefined, now);
  // Le prochain mini-jeu suit le tour en cours, ou le termine s’il tombe sur lui (il a lieu à la fin de ce tour).
  const nextMini = Math.ceil(pub.turn / MINIGAME_EVERY) * MINIGAME_EVERY;
  const miniLeft = nextMini < TURNS && pub.phase !== 'final' && !pub.mini ? nextMini - pub.turn : null;
  const status = statusOf(pub);
  let next = '';
  if (miniLeft === 0) next = ' · mini-jeu à la fin de ce tour';
  else if (miniLeft !== null) next = ` · mini-jeu dans ${miniLeft} tour${miniLeft > 1 ? 's' : ''}`;
  return (
    <header className="pf-top">
      <p className="pf-status">
        {status}
        <span className="pf-next">{next}</span>
      </p>
      <div className="pf-clock">{pub.nextAt > 0 && remaining > 0 && <Countdown remaining={remaining} />}</div>
    </header>
  );
}

function statusOf(pub: PlateauPub): string {
  if (pub.phase === 'ready') return 'En attente du lancement';
  if (pub.phase === 'final') return 'Partie terminée';
  if (pub.mini) return `Mini-jeu ${pub.mini.number} · défi ${pub.mini.round} / ${pub.mini.rounds}`;
  return `Tour ${pub.turn} / ${pub.turns}`;
}

function Standings({ pub }: { pub: PlateauPub }) {
  return (
    <div className="pf-panel">
      <h3 className="pf-panel-title">Classement</h3>
      <ol className="pf-standings">
        {pub.standings.map((row) => (
          <li key={row.id} className={row.rank === 1 ? 'is-first' : undefined}>
            <span className="pf-rank">{row.rank}</span>
            <Avatar name={row.name} size="sm" />
            <span className="pf-who">{row.name}</span>
            <span className="pf-coins">🪙 {row.coins}</span>
            <span className="pf-stars">⭐ {row.stars}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Legend() {
  const rows: [string, string][] = [
    ['🪙', '+3 pièces'],
    ['💸', '−3 pièces'],
    ['🎁', 'Événement'],
    ['⭐', `Étoile : ${STAR_COST} pièces`],
    ['🏁', 'Départ : +2 pièces'],
  ];
  return (
    <div className="pf-panel pf-legend">
      <ul>
        {rows.map(([icon, label]) => (
          <li key={label}>
            <span aria-hidden="true">{icon}</span> {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Board({ pub, now, shown }: { pub: PlateauPub; now: number; shown: Record<string, number> }) {
  const avatars = useContext(AvatarsContext);
  const positions = pub.players.map((p) => ({ p, dist: shown[p.id] ?? p.dist }));
  const byCell = new Map<number, string[]>();
  for (const { p, dist } of positions) {
    const cell = wrap(dist);
    byCell.set(cell, [...(byCell.get(cell) ?? []), p.id]);
  }
  const starSet = new Set(pub.starCells);
  const waiting = new Set(pub.phase === 'roll' || pub.phase === 'choice' || pub.phase === 'mg-play' ? pub.waiting : []);
  const hasMini = pub.mini !== null;

  return (
    <div className={`pf-board${hasMini ? ' has-mini' : ''}`}>
      <div className="pf-table">
        <div className="pf-track" aria-hidden="true" />
        {Array.from({ length: RING }, (_, cell) => {
          const kind = kindOf(cell, RING);
          const point = ringPoint(cell, RING);
          const look = KIND_LOOK[kind];
          return (
            <div
              key={cell}
              className={`pf-tile k-${kind}${starSet.has(cell) ? ' has-star' : ''}`}
              style={{ left: `${point.x}%`, top: `${point.y}%`, '--k': depthScale(point.y) } as CSSProperties}
              title={look.label || undefined}
            >
              {look.icon && <span aria-hidden="true">{look.icon}</span>}
              {starSet.has(cell) && (
                <span className="pf-star" role="img" aria-label="Étoile à acheter">
                  ⭐
                </span>
              )}
            </div>
          );
        })}
        {positions.map(({ p, dist }) => {
          const cell = wrap(dist);
          const members = byCell.get(cell) ?? [p.id];
          const slot = members.indexOf(p.id);
          const point = ringPoint(cell, RING);
          return (
            <Pawn
              key={p.id}
              player={p}
              point={point}
              depth={depthScale(point.y)}
              dx={slotOffset(slot, members.length)}
              mood={moodOf(pub, p.id)}
              spec={avatars[p.name]?.character ?? defaultCharacterFor(p.name)}
              waiting={waiting.has(p.name)}
            />
          );
        })}
      </div>
      <div className="pf-centre">
        {pub.mini ? <MiniPanel pub={pub} mini={pub.mini} now={now} /> : <PhaseCard pub={pub} now={now} />}
      </div>
    </div>
  );
}

function moodOf(pub: PlateauPub, id: string): CharacterMood {
  if (pub.phase === 'final') {
    const top = pub.final?.[0];
    return top && top.id === id ? 'dance' : 'idle';
  }
  const mini = pub.mini;
  if (mini?.reveal && pub.phase === 'mg-reveal') {
    return mini.reveal[id]?.success ? 'joy' : 'sad';
  }
  if (mini?.payouts && pub.phase === 'mg-results' && (mini.payouts[id] ?? 0) >= 6) return 'joy';
  return 'idle';
}

function Pawn({
  player,
  point,
  depth,
  dx,
  mood,
  spec,
  waiting,
}: {
  player: PlateauPlayerView;
  point: { x: number; y: number };
  depth: number;
  dx: number;
  mood: CharacterMood;
  spec: ReturnType<typeof defaultCharacterFor>;
  waiting: boolean;
}) {
  return (
    <div
      className={`pf-pawn${waiting ? ' is-waiting' : ''}`}
      style={{ left: `${point.x}%`, top: `${point.y}%`, '--dx': dx, '--k': depth } as CSSProperties}
      data-player={player.name}
    >
      <span className="pf-pawn-name">{player.name}</span>
      <Character spec={spec} mood={mood} framing="full" label={player.name} className="pf-pawn-fig" />
    </div>
  );
}

/** Ce qui se passe au centre du plateau, hors mini-jeu. */
function PhaseCard({ pub, now }: { pub: PlateauPub; now: number }) {
  const remaining = useRemaining(pub.nextAt || undefined, now);
  switch (pub.phase) {
    case 'ready':
      return (
        <div className="pf-card">
          <p className="pf-kicker">Bienvenue</p>
          <p className="pf-big">Les pions attendent sur la case départ.</p>
          <p className="pf-muted">{pub.players.map((p) => p.name).join(', ')}</p>
        </div>
      );
    case 'intro':
      return (
        <div className="pf-card">
          <p className="pf-kicker">Règles</p>
          <p className="pf-big">Lancez, avancez, achetez des étoiles.</p>
          <p className="pf-muted">
            Une étoile coûte {STAR_COST} pièces. Tous les {MINIGAME_EVERY} tours, un mini-jeu distribue des pièces.
          </p>
          <Countdown remaining={remaining} />
        </div>
      );
    case 'banner': {
      const leader = [...pub.players].sort((a, b) => b.dist - a.dist)[0];
      return (
        <div className="pf-card pf-banner" key={`banner-${pub.turn}`}>
          <p className="pf-kicker">
            Tour {pub.turn} / {pub.turns}
          </p>
          <p className="pf-big">À vos dés !</p>
          {leader && <p className="pf-muted">En tête : {leader.name}</p>}
        </div>
      );
    }
    case 'roll':
      return (
        <div className="pf-card">
          <p className="pf-kicker">Tour {pub.turn}</p>
          <p className="pf-big">Lancez le dé sur votre téléphone</p>
          <DiceRow pub={pub} />
          <Countdown remaining={remaining} />
          {pub.waiting.length > 0 && <p className="pf-muted">Attendu : {pub.waiting.join(', ')}</p>}
        </div>
      );
    case 'move':
    case 'choice':
    case 'resolve':
      return (
        <div className="pf-card pf-turn-card" key={`turn-${pub.turn}-${pub.phase}`}>
          <p className="pf-kicker">Tour {pub.turn}</p>
          <DiceRow pub={pub} />
          {pub.phase === 'choice' && (
            <p className="pf-choice-line">
              Choix en cours : {pub.waiting.join(', ') || '…'}
              {remaining > 0 && <span className="pf-inline-count"> ({Math.ceil(remaining / 1000)} s)</span>}
            </p>
          )}
          {pub.event && <EventCard event={pub.event} names={pub.names} />}
          <ul className="pf-notes" aria-live="polite">
            {pub.notes.map((line, i) => (
              <li key={`${pub.turn}-${i}`} style={{ animationDelay: `${i * 120}ms` }}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return null;
  }
}

function DiceRow({ pub }: { pub: PlateauPub }) {
  return (
    <div className="pf-dice">
      {pub.players.map((p) => {
        const value = p.roll;
        return (
          <div key={p.id} className={`pf-dice-item${p.rolled ? ' has-rolled' : ''}`}>
            <Die
              value={value}
              rolling={value !== null && pub.phase === 'move'}
              size="sm"
              label={`${p.name} : ${value ?? 'en attente'}`}
            />
            <span className="pf-dice-name">{p.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function EventCard({ event, names }: { event: EventView; names: Record<string, string> }) {
  return (
    <div className="pf-event" key={`${event.id}-${event.by}`}>
      <span className="pf-event-icon" aria-hidden="true">
        {event.icon}
      </span>
      <div>
        <p className="pf-event-name">
          {event.name} <span className="pf-muted">· {names[event.by] ?? '?'}</span>
        </p>
        <p className="pf-event-text">{event.text}</p>
      </div>
    </div>
  );
}

/** Mini-jeu : une annonce, cinq défis, puis le bilan et le classement qui distribue des pièces. */
function MiniPanel({ pub, mini, now }: { pub: PlateauPub; mini: MiniView; now: number }) {
  const remaining = useRemaining(mini.endsAt || undefined, now);
  const game = mini.game;
  if (pub.phase === 'mg-intro') {
    return (
      <div className="pf-card pf-mini">
        <p className="pf-kicker">Mini-jeu {mini.number}</p>
        <p className="pf-big">Cinq défis, sur vos téléphones</p>
        <ul className="pf-sequence" aria-label="Défis de ce mini-jeu">
          {mini.sequence.map((d, i) => (
            <li key={`${d.name}-${i}`}>
              <span aria-hidden="true">{d.icon}</span>
              {d.name}
            </li>
          ))}
        </ul>
        <p className="pf-muted">Les pièces vont aux quatre premiers : 10, 6, 4 et 2.</p>
      </div>
    );
  }
  if (pub.phase === 'mg-play' && game) {
    return (
      <div className="pf-card pf-mini pf-defi" key={`defi-${mini.number}-${mini.round}`}>
        <p className="pf-kicker">
          Défi {mini.round} / {mini.rounds}
        </p>
        <p className="pf-defi-icon" aria-hidden="true">
          {game.icon}
        </p>
        <p className="pf-big">{game.name}</p>
        <p className="pf-instruction">{game.instruction}</p>
        <p className="pf-muted">{game.hint}</p>
        <TimerBar remaining={remaining} total={game.durationMs} />
        <p className="pf-muted">
          Ont joué : {mini.submitted.length} / {pub.players.length}
        </p>
      </div>
    );
  }
  if (pub.phase === 'mg-reveal' && mini.reveal) {
    const rows = [...pub.players].sort(
      (a, b) => (mini.reveal?.[b.id]?.points ?? 0) - (mini.reveal?.[a.id]?.points ?? 0),
    );
    return (
      <div className="pf-card pf-mini" key={`reveal-${mini.number}-${mini.round}`}>
        <p className="pf-kicker">Bilan du défi {mini.round}</p>
        <ul className="pf-reveal">
          {rows.map((p) => {
            const r = mini.reveal?.[p.id];
            return (
              <li key={p.id} className={r?.success ? 'is-ok' : 'is-miss'}>
                <span>{p.name}</span>
                <span role="img" aria-label={r?.success ? 'réussi' : 'raté'}>
                  {r?.success ? '✔' : '✖'}
                </span>
                <span className="pf-points">+{r?.points ?? 0}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  if (pub.phase === 'mg-results') {
    const rows = [...pub.players].sort((a, b) => (mini.points[b.id] ?? 0) - (mini.points[a.id] ?? 0));
    return (
      <div className="pf-card pf-mini" key={`results-${mini.number}`}>
        <p className="pf-kicker">Classement du mini-jeu {mini.number}</p>
        <ul className="pf-reveal pf-payouts">
          {rows.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <span className="pf-points">{mini.points[p.id] ?? 0} pts</span>
              <span className="pf-gain">+{mini.payouts?.[p.id] ?? 0} 🪙</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return null;
}

/** Podium final : étoiles d’abord, puis pièces. */
function Podium({ pub }: { pub: PlateauPub }) {
  const rows = pub.final ?? [];
  const winners = rows.filter((r) => r.rank === 1);
  return (
    <div className="pf-podium" role="region" aria-label="Classement final">
      <p className="pf-kicker">Classement final</p>
      <p className="pf-big">
        {winners.length > 1 ? 'Ex æquo en tête : ' : 'Vainqueur : '}
        {winners.map((w) => pub.names[w.id] ?? '?').join(', ')} 🏆
      </p>
      <ol>
        {rows.map((row) => (
          <li key={row.id} className={row.rank === 1 ? 'is-first' : undefined}>
            <span className="pf-rank">{row.rank}</span>
            <Avatar name={pub.names[row.id] ?? '?'} size="md" />
            <span className="pf-who">{pub.names[row.id] ?? '?'}</span>
            <span className="pf-stars">⭐ {row.stars}</span>
            <span className="pf-coins">🪙 {row.coins}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
