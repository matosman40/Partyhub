import { memo } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useElapsed, useRemaining } from '../../client/hooks.js';
import { Avatar, Countdown, FinalHost, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';
import { isFreshReading, useFreshnessTick, useSensors, type SensorReading } from '../../client/sensors.js';
import { PILE_WINDOW, pileMarker } from '../microgames.js';
import type { MicroDefisPub, MicrogameView } from './types.js';

/** Un échantillon plus vieux que ce délai n’est plus affiché : le joueur a lâché le téléphone ou il est hors portée. */
const FRESH_MS = 1200;

export function MicroDefisHost({ publicState, hostState, now }: HostViewProps) {
  const pub = publicState as MicroDefisPub | null;
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;
  if (pub.phase === 'intro' && pub.microgame) return <IntroStage pub={pub} game={pub.microgame} now={now} />;
  if (pub.phase === 'play' && pub.microgame) {
    return (
      <PlayStage
        pub={pub}
        game={pub.microgame}
        now={now}
        pending={(hostState as { pending?: string[] } | null)?.pending ?? []}
      />
    );
  }
  return <RevealStage pub={pub} />;
}

function IntroStage({ pub, game, now }: { pub: MicroDefisPub; game: MicrogameView; now: number }) {
  const remaining = useRemaining(pub.introEndsAt, now);
  return (
    <section className="game-host fade-in mdf mdf-intro" key={`i-${pub.round}`}>
      <p className="mdf-round">
        Défi {pub.round} / {pub.rounds}
      </p>
      <p className="mdf-icon" aria-hidden="true">
        {game.icon}
      </p>
      <h2 className="mdf-name">{game.name}</h2>
      <p className="mdf-instruction">{game.instruction}</p>
      <p className="muted">{game.hint}</p>
      <Countdown remaining={remaining} />
    </section>
  );
}

function PlayStage({
  pub,
  game,
  now,
  pending,
}: {
  pub: MicroDefisPub;
  game: MicrogameView;
  now: number;
  pending: string[];
}) {
  const remaining = useRemaining(pub.endsAt, now);
  const submitted = new Set(pub.submitted);
  const showsEnergy = game.sensor !== 'timing';
  return (
    <section className={`game-host fade-in mdf mdf-play is-${game.sensor}`} key={`p-${pub.round}`}>
      <header className="mdf-head">
        <span className="mdf-icon-small" aria-hidden="true">
          {game.icon}
        </span>
        <div>
          <h2 className="mdf-name-small">{game.name}</h2>
          <p className="mdf-instruction-small">{game.instruction}</p>
        </div>
        <span className="mdf-round-small">
          {pub.round} / {pub.rounds}
        </span>
      </header>
      <TimerBar remaining={remaining} total={game.durationMs} />
      {game.sensor === 'timing' && <PileBar startedAt={pub.startedAt} now={now} />}
      <PlayerFigures players={pub.players} submitted={submitted} showsEnergy={showsEnergy} />
      <p className="muted small" aria-live="polite">
        {submitted.size} / {pub.players.length} ont joué
        {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
      </p>
    </section>
  );
}

/**
 * Les personnages : seule cette liste est abonnée aux mesures. Un téléphone qui envoie ne redessine que son
 * personnage ; la scène et les autres restent en place.
 */
function PlayerFigures({
  players,
  submitted,
  showsEnergy,
}: {
  players: MicroDefisPub['players'];
  submitted: Set<string>;
  showsEnergy: boolean;
}) {
  const sensors = useSensors();
  useFreshnessTick();
  const now = performance.now();
  return (
    <ul className="mdf-players">
      {players.map((p) => {
        const reading = sensors[p.id];
        return (
          <PlayerFigure
            key={p.id}
            name={p.name}
            reading={reading}
            fresh={isFreshReading(reading, now, FRESH_MS)}
            done={submitted.has(p.id)}
            showsEnergy={showsEnergy}
          />
        );
      })}
    </ul>
  );
}

/** Le visage du personnage, sans son inclinaison : il ne se reconstruit pas à chaque mesure. */
const FigureFace = memo(function FigureFace({ name }: { name: string }) {
  return <Avatar name={name} size="lg" />;
});

/** Un personnage qui suit l’inclinaison de son téléphone en direct, avec son effort. */
const PlayerFigure = memo(function PlayerFigure({
  name,
  reading,
  fresh,
  done,
  showsEnergy,
}: {
  name: string;
  reading: SensorReading | undefined;
  fresh: boolean;
  done: boolean;
  showsEnergy: boolean;
}) {
  const x = fresh && reading ? reading.x : 0;
  const y = fresh && reading ? reading.y : 0;
  const energy = fresh && reading ? reading.energy : 0;
  return (
    <li className={`mdf-player${done ? ' is-done' : ''}`}>
      <div
        className="mdf-figure"
        style={{ transform: `rotate(${(x * 22).toFixed(1)}deg) translateY(${(y * -8).toFixed(1)}px)` }}
      >
        <FigureFace name={name} />
      </div>
      <span className="name">{name}</span>
      {showsEnergy && (
        <span className="mdf-meter" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, energy))})` }} />
        </span>
      )}
      <span className="mdf-state">{done ? '✔ prêt' : '…'}</span>
    </li>
  );
});

/** Le curseur du défi « Pile », animé avec l’horloge serveur. */
function PileBar({ startedAt, now }: { startedAt: number; now: number }) {
  const elapsed = useElapsed(startedAt, now, true);
  return (
    <div className="mdf-track mdf-track-tv" aria-hidden="true">
      <span
        className="mdf-pile-zone"
        style={{ left: `${(0.5 - PILE_WINDOW) * 100}%`, width: `${PILE_WINDOW * 200}%` }}
      />
      <span className="mdf-cursor" style={{ left: `${pileMarker(elapsed) * 100}%` }} />
    </div>
  );
}

function RevealStage({ pub }: { pub: MicroDefisPub }) {
  const results = pub.results ?? [];
  const game = pub.microgame;
  return (
    <section className="game-host fade-in mdf mdf-reveal" key={`r-${pub.round}`}>
      <p className="mdf-round">
        Bilan · défi {pub.round} / {pub.rounds}
        {game && <> · {game.name}</>}
      </p>
      <ul className="mdf-results">
        {results.map((r) => (
          <li key={r.playerId} className={r.success ? 'is-ok' : 'is-ko'}>
            <Avatar name={r.name} size="md" />
            <span className="name">{r.name}</span>
            <span className="mdf-verdict">{r.success ? '✔ Réussi' : '✘ Raté'}</span>
            <span className="mdf-gain">{r.points > 0 ? `+${r.points}` : '0'}</span>
          </li>
        ))}
      </ul>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
