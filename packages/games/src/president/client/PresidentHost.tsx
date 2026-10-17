import { useRef } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from '../../cards/client/CardFace.js';
import { useCardFlights, useChange } from '../../cards/client/cues.js';
import { entryOf, rankingOf, type CardsPublic } from '../../cards/client/common.js';

/** Écran principal du Président : pli au centre, joueurs autour, rôles en fin de manche. */
export function PresidentHost({ publicState, now }: HostViewProps) {
  const pub = publicState as (CardsPublic & PresidentExtra) | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);
  const rootRef = useRef<HTMLElement>(null);

  // Sons et trajets : déclenchés par les changements d'état, avant les retours anticipés.
  useChange(pub?.started ?? false, (_, started) => {
    if (started) play('start');
  });
  useChange(pub?.pileCount ?? 0, (before, after) => {
    if (after > before) play('card');
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
        title="Le Président : en attente du lancement…"
        text={`${pub.order.length} joueur(s) · ${pub.rounds} manche(s)`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={rankingOf(pub)} />;

  const pile = pub.pile ?? [];
  const current = pub.current ? pub.names[pub.current] : null;
  const passed = new Set(pub.passed ?? []);

  return (
    <section
      ref={rootRef}
      className={`cards-host pres-host fade-in phase-${pub.phase}`}
      key={`r-${pub.round}`}
      data-mat={pub.def.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="cards-hud">
        <span className="hud-pill">
          Manche {pub.round} / {pub.rounds}
        </span>
        {pub.phase === 'play' && pub.pileCount > 0 && (
          <span className="hud-pill">
            Pli : {pub.pileCount} × {pileLabel(pub, pile)}
          </span>
        )}
        {pub.pileCount === 0 && pub.phase === 'play' && <span className="hud-pill">Table libre</span>}
        <SoundToggle />
      </div>

      <div className="cards-seats">
        {pub.order.map((id) => {
          const name = pub.names[id] ?? '?';
          const count = pub.counts[id] ?? 0;
          const out = (pub.finished ?? []).includes(id);
          const role = pub.roles?.[id];
          const cls = [
            'seat-card',
            pub.current === id ? 'is-turn' : '',
            passed.has(id) ? 'is-passed' : '',
            out ? 'is-out' : '',
          ].join(' ');
          return (
            <div key={id} className={cls} data-seat={id}>
              <Avatar name={name} size="sm" />
              <div className="seat-meta">
                <span className="seat-name">{name}</span>
                <span className="seat-score">
                  {role ? role : out ? 'Sorti' : passed.has(id) ? 'A passé' : `${pub.scores[id] ?? 0} pts`}
                </span>
              </div>
              <span className="seat-count">
                <b>{count}</b>
                <span className="muted small">cartes</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="pres-table table-mat">
        {pile.length > 0 ? (
          <div className="pres-pile" role="img" aria-label={`Pli : ${pub.pileCount} carte(s)`}>
            {pile.map((c, i) => (
              <div
                key={c.uid}
                className="pres-pile-card"
                data-uid={c.uid}
                data-zone="table"
                style={{
                  transform: `translateX(${(i - (pile.length - 1) / 2) * 34}px) rotate(${(i - (pile.length - 1) / 2) * 4}deg)`,
                }}
              >
                <div className="pres-pile-face" data-fly-target>
                  <CardFace def={pub.def} entry={entryOf(pub.def, c.entry)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="pres-empty" aria-hidden="true">
            {pub.phase === 'play' ? '♠ ♥ ♦ ♣' : ''}
          </div>
        )}
      </div>

      {pub.phase === 'play' && pub.settings.turnSeconds > 0 && (
        <TimerBar remaining={remaining} total={pub.settings.turnSeconds * 1000} />
      )}

      <p className="cards-event" aria-live="polite">
        {pub.lastEvent}
        {current && pub.phase === 'play' && <> · À {current} de jouer</>}
      </p>

      {pub.phase === 'round-over' && (
        <div className="cards-reveal">
          <h3>Rangs de la manche</h3>
          <ol className="pres-roles">
            {(pub.finished ?? []).map((id) => (
              <li key={id}>
                <span className="pres-role">{pub.roles?.[id]}</span>
                <span>{pub.names[id]}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

interface PresidentExtra {
  rounds: number;
  pile: { uid: string; entry: string }[];
  pileRank: number;
  pileCount: number;
  passed: string[];
  finished: string[];
  roles: Record<string, string>;
}

function pileLabel(pub: CardsPublic, pile: { entry: string }[]): string {
  const first = pile[0] ? entryOf(pub.def, pile[0].entry) : undefined;
  return first?.label ?? '';
}
