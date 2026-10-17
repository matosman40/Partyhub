import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from './CardFace.js';
import { useChange } from './cues.js';
import { entryOf, rankingOf } from './common.js';
import type { RacePublic } from './race-common.js';

/** Écran principal de la ressemblance : la carte du centre, les scores et les touches bloquées. */
export function RaceHost({ publicState, now }: HostViewProps) {
  const pub = publicState as RacePublic | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);

  // Sons : nouvelle carte au centre, fin de manche, fin de partie.
  useChange(pub?.center?.uid ?? '', (before, after) => {
    if (before && after) play('card');
  });
  useChange(pub?.phase ?? '', (before, phase) => {
    if (before && phase === 'round-over') play('pickup');
    if (phase === 'final') play('final');
  });

  if (!pub) return null;

  if (!pub.started) {
    return (
      <WaitingScreen
        title={`${pub.def.name} : en attente du lancement…`}
        text={`Objectif ${pub.settings.targetScore} points`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={rankingOf(pub)} />;

  const centerEntry = pub.center ? entryOf(pub.def, pub.center.entry) : undefined;
  const turnMs = pub.settings.turnSeconds * 1000;

  return (
    <section
      className={`cards-host race-host fade-in phase-${pub.phase}`}
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="cards-hud">
        <span className="hud-pill">Manche {pub.round}</span>
        <span className="hud-pill">Objectif {pub.settings.targetScore} pts</span>
        <span className="hud-pill">Pioche {pub.pileCount}</span>
        <SoundToggle />
      </div>

      <div className="cards-seats">
        {pub.order.map((id) => {
          const name = pub.names[id] ?? '?';
          const locked = (pub.locked[id] ?? 0) > now;
          return (
            <div key={id} className={`seat-card${locked ? ' is-locked' : ''}`} data-seat={id}>
              <Avatar name={name} size="sm" />
              <div className="seat-meta">
                <span className="seat-name">{name}</span>
                <span className="seat-score">
                  {pub.scores[id] ?? 0} pts · {pub.counts[id] ?? 0} cartes{locked ? ' · bloqué' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {pub.turnEndsAt !== null && pub.phase === 'play' && turnMs > 0 && (
        <TimerBar remaining={remaining} total={turnMs} />
      )}

      <p className="cards-event" aria-live="polite">
        {pub.lastEvent}
      </p>

      <div className="race-center">
        {pub.center && centerEntry ? (
          <CardFace
            def={pub.def}
            entry={centerEntry}
            label={`Carte du centre : ${centerEntry.label || centerEntry.symbol}`}
          />
        ) : (
          <CardFace def={pub.def} back label="Plus de carte au centre" />
        )}
      </div>
    </section>
  );
}
