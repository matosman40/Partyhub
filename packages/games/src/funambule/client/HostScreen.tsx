import { memo } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useElapsed, useRemaining } from '../../client/hooks.js';
import { Avatar, Countdown, FinalHost, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';
import { isFreshReading, useFreshnessTick, useSensors, type SensorReading } from '../../client/sensors.js';
import { clampUnit, windAt, windPeak } from '../rules.js';
import { Streamers, secondsLabel, windSentence } from './wind.js';
import type { FunambulePub, WindView } from './types.js';

/** Un échantillon plus vieux que ce délai n’est plus suivi : le téléphone est éteint ou hors de portée. */
const FRESH_MS = 1200;
/** Au-delà de cette position, le funambule vacille (il est près de tomber). */
const WOBBLE = 0.8;

export function FunambuleHost({ publicState, hostState, now }: HostViewProps) {
  const pub = publicState as FunambulePub | null;
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;
  if (pub.phase === 'reveal') return <RevealStage pub={pub} />;
  if (!pub.wind) return <WaitingScreen title="Manche suivante…" />;
  return (
    <Scene pub={pub} wind={pub.wind} now={now} pending={(hostState as { pending?: string[] } | null)?.pending ?? []} />
  );
}

/** Le fil tendu, les funambules et le vent : une seule scène, pendant l’installation et la traversée. */
function Scene({ pub, wind, now, pending }: { pub: FunambulePub; wind: WindView; now: number; pending: string[] }) {
  const walking = pub.phase === 'walk';
  // Le décompte de la traversée suit la durée de jeu, sans la marge réseau.
  const remaining = useRemaining(walking ? pub.startedAt + wind.walkMs : pub.introEndsAt, now);
  const elapsed = useElapsed(pub.startedAt, now, walking);
  const air = walking ? windAt(elapsed, wind.strength, wind.seed) : 0;
  const fallen = new Set(pub.fallen);
  const crossed = new Set(pub.crossed);
  const count = pub.players.length;

  return (
    <section className={`game-host fade-in fnb ${walking ? 'is-walk' : 'is-intro'}`} key={`f-${pub.round}`}>
      <header className="fnb-head">
        <div>
          <h2 className="fnb-name-small">Funambule</h2>
          <p className="fnb-instruction-small">
            {walking
              ? 'Penchez le téléphone du côté opposé au vent.'
              : `${wind.label} : tenez ${secondsLabel(wind.walkMs)} sur le fil.`}
          </p>
        </div>
        <span className="fnb-round-small">
          {pub.round} / {pub.rounds}
        </span>
      </header>
      {walking && <TimerBar remaining={remaining} total={wind.walkMs} />}
      <div className="fnb-wind">
        <Streamers wind={air / windPeak(wind.strength)} size="lg" />
        <p className="fnb-wind-text">
          {walking ? `${wind.label} · ${windSentence(air)}` : `${wind.label} · le vent se lève au départ`}
        </p>
      </div>
      <div className="fnb-scene">
        <span className="fnb-rope-tv" aria-hidden="true" />
        <span className="fnb-post-tv is-left" aria-hidden="true" />
        <span className="fnb-post-tv is-right" aria-hidden="true" />
        <WalkerList players={pub.players} fallen={fallen} crossed={crossed} />
      </div>
      {walking ? (
        <p className="muted small" aria-live="polite">
          {fallen.size + crossed.size} / {count} ont fini
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      ) : (
        <Countdown remaining={remaining} />
      )}
    </section>
  );
}

/**
 * Les funambules : seule cette liste est abonnée aux mesures. Quand un téléphone envoie, seul son funambule se
 * redessine ; les autres et la scène restent en place.
 */
function WalkerList({
  players,
  fallen,
  crossed,
}: {
  players: FunambulePub['players'];
  fallen: Set<string>;
  crossed: Set<string>;
}) {
  const sensors = useSensors();
  useFreshnessTick();
  const now = performance.now();
  const count = players.length;
  return (
    <ul className="fnb-walkers">
      {players.map((p, i) => {
        const reading = sensors[p.id];
        return (
          <Walker
            key={p.id}
            name={p.name}
            left={((i + 0.5) / count) * 100}
            reading={reading}
            fresh={isFreshReading(reading, now, FRESH_MS)}
            fallen={fallen.has(p.id)}
            crossed={crossed.has(p.id)}
          />
        );
      })}
    </ul>
  );
}

/**
 * Le personnage, sans son inclinaison : il ne se reconstruit pas à chaque mesure, seule la perche qui le porte bouge.
 */
const WalkerFace = memo(function WalkerFace({ name }: { name: string }) {
  return <Avatar name={name} size="lg" />;
});

/** Un funambule : sa perche suit l’inclinaison de son téléphone en direct ; il tombe ou arrive en fin de traversée. */
const Walker = memo(function Walker({
  name,
  left,
  reading,
  fresh,
  fallen,
  crossed,
}: {
  name: string;
  left: number;
  reading: SensorReading | undefined;
  fresh: boolean;
  fallen: boolean;
  crossed: boolean;
}) {
  const lean = fresh && reading ? clampUnit(reading.x) : 0;
  // Une chute part du côté où le funambule penchait en dernier, même si le téléphone ne parle plus.
  const side = (reading?.x ?? 0) < 0 ? -1 : 1;
  const angle = fallen ? side * 80 : lean * 24;
  const wobbly = !fallen && fresh && reading !== undefined && reading.energy >= WOBBLE;
  const classes = ['fnb-walker'];
  if (fallen) classes.push('is-fallen');
  if (crossed) classes.push('is-crossed');
  if (wobbly) classes.push('is-wobbly');
  return (
    <li className={classes.join(' ')} style={{ left: `${left}%` }}>
      <div className="fnb-body" style={{ transform: `rotate(${angle.toFixed(1)}deg)` }}>
        <span className="fnb-pole" aria-hidden="true" />
        <WalkerFace name={name} />
      </div>
      <span className="fnb-label">{name}</span>
      {(fallen || crossed) && <span className="fnb-state">{fallen ? 'Tombé' : 'Arrivé'}</span>}
    </li>
  );
});

function RevealStage({ pub }: { pub: FunambulePub }) {
  const results = pub.results ?? [];
  const answered = new Set(pub.submitted);
  return (
    <section className="game-host fade-in fnb fnb-reveal" key={`r-${pub.round}`}>
      <p className="fnb-round-small">
        Bilan · manche {pub.round} / {pub.rounds}
        {pub.wind && <> · {pub.wind.label}</>}
      </p>
      <ul className="fnb-results">
        {results.map((r) => (
          <li key={r.playerId} className={r.success ? 'is-ok' : 'is-ko'}>
            <Avatar name={r.name} size="md" />
            <span className="name">{r.name}</span>
            <span className="fnb-verdict">
              {r.success
                ? '✔ Arrivé'
                : answered.has(r.playerId)
                  ? `✘ Tombé à ${secondsLabel(r.survived)}`
                  : '✘ Pas de réponse'}
            </span>
            <span className="fnb-gain">{r.points > 0 ? `+${r.points}` : '0'}</span>
          </li>
        ))}
      </ul>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
