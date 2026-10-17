import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from './CardFace.js';
import { useChange } from './cues.js';
import { entryOf, rankingOf } from './common.js';
import { isHidden, memoryColumns, type MemoryPublic } from './memory-common.js';

/** Écran principal du mémo : le plateau face cachée, les paires trouvées et les scores. */
export function MemoryHost({ publicState, now }: HostViewProps) {
  const pub = publicState as MemoryPublic | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);

  // Sons : retournement, paire trouvée, paire ratée, fin.
  useChange(pub?.open.length ?? 0, (before, after) => {
    if (after > before) play('card');
  });
  useChange(pub?.matches ?? 0, (before, after) => {
    if (after > before) play('pickup');
  });
  useChange(pub?.phase ?? '', (before, phase) => {
    if (before === 'peek' && phase === 'play') play('click');
    if (phase === 'final') play('final');
  });

  if (!pub) return null;

  if (!pub.started) {
    return (
      <WaitingScreen
        title={`${pub.def.name} : en attente du lancement…`}
        text={`${pub.pairs} paires à trouver · objectif ${pub.settings.targetScore} points`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={rankingOf(pub)} />;

  const current = pub.current ? pub.names[pub.current] : null;
  const cols = memoryColumns(pub.board.length, 1.4);
  const rows = Math.ceil(pub.board.length / cols);

  return (
    <section
      className={`cards-host memory-host fade-in phase-${pub.phase}`}
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="cards-hud">
        <span className="hud-pill">
          Paires {pub.matches} / {pub.pairs}
        </span>
        <span className="hud-pill">Objectif {pub.settings.targetScore} pts</span>
        <SoundToggle />
      </div>

      <div className="cards-seats">
        {pub.order.map((id) => (
          <div key={id} className={`seat-card${pub.current === id ? ' is-turn' : ''}`} data-seat={id}>
            <Avatar name={pub.names[id] ?? '?'} size="sm" />
            <div className="seat-meta">
              <span className="seat-name">{pub.names[id] ?? '?'}</span>
              <span className="seat-score">{pub.scores[id] ?? 0} pts</span>
            </div>
          </div>
        ))}
      </div>

      {pub.turnEndsAt !== null && pub.phase === 'play' && pub.settings.turnSeconds > 0 && (
        <TimerBar remaining={remaining} total={pub.settings.turnSeconds * 1000} />
      )}

      <p className="cards-event" aria-live="polite">
        {current && pub.phase === 'play' ? `Tour de ${current}. ` : ''}
        {pub.lastEvent}
      </p>

      <div
        className="memory-board is-host"
        style={{ ['--memory-cols' as string]: cols, ['--memory-rows' as string]: rows }}
      >
        {pub.board.map((cell, index) => {
          const entry = cell.entry ? entryOf(pub.def, cell.entry) : undefined;
          const found = cell.owner !== null;
          const cls = ['memory-tile', found ? 'is-found' : '', !isHidden(cell) && !found ? 'is-open' : ''].join(' ');
          return (
            <div key={cell.uid} className={cls} data-uid={cell.uid}>
              <CardFace
                def={pub.def}
                entry={entry}
                label={entry ? entry.label || entry.text?.slice(0, 40) : `Carte ${index + 1}, face cachée`}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
