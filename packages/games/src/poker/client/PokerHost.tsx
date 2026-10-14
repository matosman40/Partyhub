import type { CSSProperties } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { CardFace } from '../../cards/client/CardFace.js';
import { useChange } from '../../cards/client/cues.js';
import { entryOf } from '../../cards/client/common.js';
import { POKER_DEFINITION } from '../rules.js';
import { STREET_LABEL, chipsRanking, fmt, type PokerPub } from './common.js';

/** Écran principal du poker : les joueurs et leurs mises, le tableau commun et le pot. */
export function PokerHost({ publicState, now }: HostViewProps) {
  const pub = publicState as PokerPub | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);

  // Sons déclenchés par les changements d'état, avant les retours anticipés.
  useChange(pub?.started ?? false, (_, started) => {
    if (started) play('start');
  });
  useChange(pub?.board.length ?? 0, (before, after) => {
    if (after > before) play('card');
  });
  useChange(pub?.pot ?? 0, (before, after) => {
    if (after > before) play('chip');
  });
  useChange(pub?.phase ?? '', (_, phase) => {
    if (phase === 'hand-over') play('win');
    else if (phase === 'final') play('final');
  });

  if (!pub) return null;
  if (!pub.started) {
    return (
      <WaitingScreen
        title="Poker : en attente du lancement…"
        text={`${pub.order.length} joueur(s) à la table sur ${pub.settings.seats}${pub.spectators.length ? ` · ${pub.spectators.length} spectateur(s)` : ''} · ${fmt(pub.settings.startingChips)} jetons chacun · blindes ${pub.settings.smallBlind} / ${pub.settings.bigBlind}`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={chipsRanking(pub)} />;

  const winners = new Map(pub.winners.map((w) => [w.id, w]));
  const current = pub.current ? pub.names[pub.current] : null;
  const total = pub.settings.turnSeconds * 1000;

  return (
    <section
      className={`cards-host poker-host poker-amb-${pub.settings.ambiance} fade-in`}
      data-mat={pub.settings.theme}
      onPointerDownCapture={() => unlockAudio()}
    >
      <div className="cards-hud">
        <span className="hud-pill">Main n°{pub.handNumber}</span>
        <span className="hud-pill">
          Blindes {fmt(pub.settings.smallBlind)} / {fmt(pub.settings.bigBlind)}
        </span>
        <span className="hud-pill">{STREET_LABEL[pub.street]}</span>
        {pub.spectators.length > 0 && <span className="hud-pill">Spectateurs : {pub.spectators.length}</span>}
        <SoundToggle />
      </div>

      <div className="cards-seats poker-seats">
        {pub.order.map((id) => {
          const name = pub.names[id] ?? '?';
          const stack = pub.stacks[id] ?? 0;
          const bet = pub.bets[id] ?? 0;
          const inHand = pub.inHand.includes(id);
          const folded = pub.folded.includes(id);
          const allIn = pub.allIn.includes(id);
          const status = !inHand
            ? stack === 0
              ? 'Éliminé'
              : 'En attente'
            : folded
              ? 'Couché'
              : allIn
                ? 'Tapis'
                : '';
          const win = winners.get(id);
          const shown = pub.revealed[id];
          const cls = [
            'seat-card',
            'poker-seat',
            pub.current === id ? 'is-turn' : '',
            folded ? 'is-folded' : '',
            !inHand && stack === 0 ? 'is-out' : '',
            win ? 'is-winner' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={id} className={cls} data-seat={id}>
              <Avatar name={name} size="sm" />
              <div className="seat-meta">
                <span className="seat-name">
                  {name}
                  {pub.dealer === id && (
                    <span className="dealer-btn" title="Croupier" aria-label="Croupier">
                      D
                    </span>
                  )}
                </span>
                <span className="seat-score">
                  {fmt(stack)} jetons{status ? ` · ${status}` : ''}
                </span>
              </div>
              {shown && (
                <span className="poker-shown" aria-label={`Cartes de ${name}`}>
                  {shown.map((c) => (
                    <span key={c} className="mini-card">
                      <CardFace def={POKER_DEFINITION} entry={entryOf(POKER_DEFINITION, c)} />
                    </span>
                  ))}
                </span>
              )}
              {bet > 0 && <span className="bet-chip">{fmt(bet)}</span>}
              {win && <span className="win-chip">+{fmt(win.amount)}</span>}
            </div>
          );
        })}
      </div>

      <div className="poker-table table-mat">
        <div className="poker-pot" aria-live="polite">
          <span className="chip-dot" aria-hidden="true" />
          Pot {fmt(pub.pot)}
        </div>
        <div className="poker-board" aria-label="Cartes communes">
          {[0, 1, 2, 3, 4].map((i) => {
            const card = pub.board[i];
            if (!card) return <div key={`slot-${i}`} className="poker-slot" aria-hidden="true" />;
            // Le flop arrive carte par carte : décalage selon la place dans le tableau.
            const style = { ['--d' as string]: `${i < 3 ? i * 120 : 0}ms` } as CSSProperties;
            return (
              <div key={card} className="poker-board-card" style={style}>
                <CardFace def={POKER_DEFINITION} entry={entryOf(POKER_DEFINITION, card)} />
              </div>
            );
          })}
        </div>
      </div>

      {pub.phase === 'play' && total > 0 && <TimerBar remaining={remaining} total={total} />}

      <p className="cards-event" aria-live="polite">
        {pub.lastEvent}
        {current && pub.phase === 'play' && <> · À {current} de parler</>}
      </p>

      {pub.phase === 'hand-over' && pub.winners.length > 0 && (
        <div className="cards-reveal poker-winners">
          <h3>Main remportée</h3>
          <ul>
            {pub.winners.map((w) => (
              <li key={w.id}>
                <Avatar name={w.name} size="sm" />
                <b>{w.name}</b>
                <span>+{fmt(w.amount)} jetons</span>
                {w.hand && <span className="muted">{w.hand}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
