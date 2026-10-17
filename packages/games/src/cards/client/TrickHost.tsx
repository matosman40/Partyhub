import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from './CardFace.js';
import { useChange } from './cues.js';
import { entryOf, rankingOf } from './common.js';
import { familyName, type TrickPublic } from './trick-common.js';

/** Écran principal du pli : la table, la couleur demandée, l'atout et les plis de chacun. */
export function TrickHost({ publicState, now }: HostViewProps) {
  const pub = publicState as TrickPublic | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);

  // Sons : une carte posée sur la table, fin de manche, fin de partie.
  useChange(pub?.table.length ?? 0, (before, after) => {
    if (after > before) play('card');
  });
  useChange(pub?.phase ?? '', (before, phase) => {
    if (before && phase === 'round-over') play('pickup');
    if (phase === 'final') play('final');
  });

  if (!pub) return null;

  if (!pub.started) {
    const trump = familyName(pub.def, pub.trump);
    return (
      <WaitingScreen
        title={`${pub.def.name} : en attente du lancement…`}
        text={`Objectif ${pub.settings.targetScore} points · ${trump ? `atout : ${trump}` : 'sans atout'}`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={rankingOf(pub)} />;

  const led = familyName(pub.def, pub.ledFamily);
  const trump = familyName(pub.def, pub.trump);
  const turnMs = pub.settings.turnSeconds * 1000;
  const winner = pub.phase === 'trick-over' ? (pub.lastTrick?.winner ?? null) : null;

  return (
    <section
      className={`cards-host trick-host fade-in phase-${pub.phase}`}
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="cards-hud">
        <span className="hud-pill">Manche {pub.round}</span>
        <span className="hud-pill">Objectif {pub.settings.targetScore} pts</span>
        {led && <span className="hud-pill">Couleur demandée : {led}</span>}
        {trump && <span className="hud-pill">Atout : {trump}</span>}
        <SoundToggle />
      </div>

      <div className="cards-seats">
        {pub.order.map((id) => {
          const name = pub.names[id] ?? '?';
          return (
            <div key={id} className={`seat-card${pub.current === id ? ' is-turn' : ''}`} data-seat={id}>
              <Avatar name={name} size="sm" />
              <div className="seat-meta">
                <span className="seat-name">{name}</span>
                <span className="seat-score">
                  {pub.scores[id] ?? 0} pts · {pub.tricksWon[id] ?? 0} plis · {pub.counts[id] ?? 0} cartes
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
        {pub.current && pub.phase === 'play' ? `Tour de ${pub.names[pub.current] ?? '?'}. ` : ''}
        {pub.lastEvent}
      </p>

      <div className="trick-table">
        {pub.table.length === 0 ? (
          <p className="muted">Le pli est vide : le premier joueur choisit la couleur.</p>
        ) : (
          pub.table.map((t) => {
            const entry = entryOf(pub.def, t.entry);
            const name = pub.names[t.pid] ?? '?';
            return (
              <figure key={t.pid} className={`trick-slot${winner === t.pid ? ' is-winner' : ''}`}>
                <CardFace
                  def={pub.def}
                  entry={entry}
                  label={`${name} joue ${entry?.label || entry?.symbol || 'une carte'}`}
                />
                <figcaption>{name}</figcaption>
              </figure>
            );
          })
        )}
      </div>
    </section>
  );
}
