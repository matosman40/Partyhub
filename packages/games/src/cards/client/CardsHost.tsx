import { useRef } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from './CardFace.js';
import { useCardFlights, useChange } from './cues.js';
import { entryOf, familyOf, handPoints, rankingOf, type CardsPublic } from './common.js';

/** Écran principal d'un jeu de cartes : table, pioche, défausse et joueurs. */
export function CardsHost({ publicState, now }: HostViewProps) {
  const pub = publicState as CardsPublic | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);
  const rootRef = useRef<HTMLElement>(null);

  // Sons et trajets : déclenchés par les changements d'état, avant les retours anticipés.
  useChange(pub?.started ?? false, (_, started) => {
    if (started) play('start');
  });
  useChange(pub?.top?.uid ?? null, (before, after) => {
    if (before !== null && after) play('card');
  });
  useChange(pub?.phase ?? '', (_, phase) => {
    if (phase === 'final') play('final');
    else if (phase === 'round-over') play('win');
  });
  useCardFlights(rootRef);

  if (!pub) return null;

  if (!pub.started) {
    return (
      <WaitingScreen
        title={`${pub.def.name} : en attente du lancement…`}
        text={`Objectif : ${pub.settings.targetScore} points · ${pub.def.rules.handSize} cartes par main`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={rankingOf(pub)} />;

  const topEntry = pub.top ? entryOf(pub.def, pub.top.entry) : undefined;
  const family = familyOf(pub.def, pub.family);
  const totalSeconds = pub.settings.turnSeconds;
  const picker = pub.picker ? pub.names[pub.picker] : null;

  return (
    <section
      ref={rootRef}
      className={`cards-host fade-in phase-${pub.phase}`}
      key={`r-${pub.round}`}
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="cards-hud">
        <span className="hud-pill">Manche {pub.round}</span>
        <span className="hud-pill">Objectif {pub.settings.targetScore} pts</span>
        {family && (
          <span className="hud-pill family-chip">
            <i style={{ background: family.color }} />
            {family.label}
          </span>
        )}
        <span className="hud-pill">{pub.direction === 1 ? '↻ sens horaire' : '↺ sens inverse'}</span>
        <SoundToggle />
      </div>

      <div className="cards-seats">
        {pub.order.map((id) => {
          const name = pub.names[id] ?? '?';
          const count = pub.counts[id] ?? 0;
          const cls = [
            'seat-card',
            pub.current === id ? 'is-turn' : '',
            pub.picker === id ? 'is-picker' : '',
            pub.roundWinner === id && pub.phase !== 'play' ? 'is-winner' : '',
          ].join(' ');
          return (
            <div key={id} className={cls} data-seat={id}>
              <Avatar name={name} size="sm" />
              <div className="seat-meta">
                <span className="seat-name">{name}</span>
                <span className="seat-score">{pub.scores[id] ?? 0} pts</span>
              </div>
              <span className="seat-count" role="img" aria-label={`${count} cartes en main`}>
                <span className="mini-stack">
                  {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
                    <span key={i} className="mini-back">
                      <CardFace def={pub.def} back />
                    </span>
                  ))}
                </span>
                <b>{count}</b>
              </span>
            </div>
          );
        })}
      </div>

      <div className="cards-felt table-mat">
        <div className="cards-pile" role="img" aria-label={`${pub.drawCount} cartes en pioche`}>
          <div className="pile-back">
            <CardFace def={pub.def} back />
          </div>
          <span className="pile-count">{pub.drawCount}</span>
        </div>
        <div className="cards-discard">
          {topEntry && pub.top && (
            <div className="discard-card" key={pub.top.uid} data-uid={pub.top.uid} data-zone="table">
              <CardFace def={pub.def} entry={topEntry} />
            </div>
          )}
        </div>
      </div>

      {totalSeconds > 0 && pub.phase === 'play' && <TimerBar remaining={remaining} total={totalSeconds * 1000} />}

      <p className="cards-event" aria-live="polite">
        {pub.lastEvent}
        {pub.phase === 'pick-family' && picker && <> · {picker} choisit la couleur…</>}
      </p>

      {pub.phase === 'round-over' && pub.revealed && (
        <div className="cards-reveal">
          <h3>Mains restantes</h3>
          <div className="reveal-hands">
            {pub.order.map((id) => (
              <div key={id} className="reveal-hand">
                <span className="seat-name">{pub.names[id]}</span>
                <span className="mini-row">
                  {(pub.revealed?.[id] ?? []).slice(0, 10).map((c, idx) => (
                    <span key={c.uid} className="mini-card" style={{ ['--i' as string]: idx }}>
                      <CardFace def={pub.def} entry={entryOf(pub.def, c.entry)} />
                    </span>
                  ))}
                </span>
                <span className="muted">{handPoints(pub.def, pub.revealed?.[id] ?? [])} pts en main</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
