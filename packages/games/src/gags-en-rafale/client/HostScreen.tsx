import type { HostViewProps } from '../../client/types.js';
import { useElapsed, useRemaining } from '../../client/hooks.js';
import { Avatar, Countdown, FinalHost, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';
import { flyAt } from '../gags.js';
import type { GagsPub, GagView } from './types.js';

export function GagsHost({ publicState, hostState, now }: HostViewProps) {
  const pub = publicState as GagsPub | null;
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;
  if (pub.phase === 'intro' && pub.microgame) return <IntroStage pub={pub} gag={pub.microgame} now={now} />;
  if (pub.phase === 'play' && pub.microgame) {
    return (
      <PlayStage
        pub={pub}
        gag={pub.microgame}
        now={now}
        pending={(hostState as { pending?: string[] } | null)?.pending ?? []}
      />
    );
  }
  return <RevealStage pub={pub} />;
}

function IntroStage({ pub, gag, now }: { pub: GagsPub; gag: GagView; now: number }) {
  const remaining = useRemaining(pub.introEndsAt, now);
  return (
    <section className="game-host fade-in gag gag-intro" key={`i-${pub.round}`}>
      <p className="gag-round">
        Gag {pub.round} / {pub.rounds}
      </p>
      <p className="gag-icon" aria-hidden="true">
        {gag.icon}
      </p>
      <h2 className="gag-name">{gag.name}</h2>
      <p className="gag-flavor">{gag.flavor}</p>
      <p className="gag-instruction">{gag.instruction}</p>
      <p className="muted">{gag.hint}</p>
      <Countdown remaining={remaining} />
    </section>
  );
}

function PlayStage({ pub, gag, now, pending }: { pub: GagsPub; gag: GagView; now: number; pending: string[] }) {
  const remaining = useRemaining(pub.endsAt, now);
  const submitted = new Set(pub.submitted);
  const waiting = gag.input === 'wait';
  return (
    <section className={`game-host fade-in gag gag-play is-${gag.input}`} key={`p-${pub.round}`}>
      <header className="gag-head">
        <span className="gag-icon-small" aria-hidden="true">
          {gag.icon}
        </span>
        <div>
          <h2 className="gag-name-small">{gag.name}</h2>
          <p className="gag-instruction-small">{gag.instruction}</p>
        </div>
        <span className="gag-round-small">
          {pub.round} / {pub.rounds}
        </span>
      </header>
      <TimerBar remaining={remaining} total={gag.durationMs} />
      <GagScene gag={gag} startedAt={pub.startedAt} now={now} />
      <ul className="gag-players">
        {pub.players.map((p) => {
          const done = submitted.has(p.id);
          return (
            <li key={p.id} className={`gag-player${done ? ' is-done' : ''}`}>
              <Avatar name={p.name} size="md" />
              <span className="name">{p.name}</span>
              <span className="gag-state">{done ? (waiting ? '✘ touché' : '✔ prêt') : '…'}</span>
            </li>
          );
        })}
      </ul>
      <p className="muted small" aria-live="polite">
        {submitted.size} / {pub.players.length} {waiting ? 'ont touché' : 'ont joué'}
        {pending.length > 0 && !waiting && <> · En attente : {pending.join(', ')}</>}
      </p>
    </section>
  );
}

/** La scène du gag sur l'écran principal. La mouche suit la même trajectoire que sur les téléphones. */
function GagScene({ gag, startedAt, now }: { gag: GagView; startedAt: number; now: number }) {
  const elapsed = useElapsed(startedAt, now, gag.input === 'moving-target');
  if (gag.input === 'moving-target') {
    const p = flyAt(gag.seed, elapsed);
    return (
      <div className="gag-field gag-field-tv" aria-hidden="true">
        <span className="gag-fly" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>
          🪰
        </span>
      </div>
    );
  }
  return (
    <div className={`gag-scene gag-scene-${gag.input}`} aria-hidden="true">
      <span>{gag.icon}</span>
    </div>
  );
}

function RevealStage({ pub }: { pub: GagsPub }) {
  const results = pub.results ?? [];
  const gag = pub.microgame;
  const winners = results.filter((r) => r.success).length;
  const quip = gag ? (winners > 0 ? gag.quips.win : gag.quips.lose) : '';
  return (
    <section className="game-host fade-in gag gag-reveal" key={`r-${pub.round}`}>
      <p className="gag-round">
        Bilan · gag {pub.round} / {pub.rounds}
        {gag && <> · {gag.name}</>}
      </p>
      <p className="gag-quip">{quip}</p>
      <ul className="gag-results">
        {results.map((r) => (
          <li key={r.playerId} className={r.success ? 'is-ok' : 'is-ko'}>
            <Avatar name={r.name} size="md" />
            <span className="name">{r.name}</span>
            <span className="gag-verdict-host">{r.success ? '✔ Réussi' : '✘ Raté'}</span>
            <span className="gag-gain">{r.points > 0 ? `+${r.points}` : '0'}</span>
          </li>
        ))}
      </ul>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
