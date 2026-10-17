import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { play, unlockAudio } from '../../client/audio.js';
import { Avatar, FinalHost, TimerBar, WaitingScreen } from '../../client/ui.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { useChange } from '../../cards/client/cues.js';
import { rankingOf } from '../../cards/client/common.js';
import { ChipStack, PokerCardFace } from './PokerCards.js';
import type { PokerPublic } from './common.js';

/** Angle de chaque siège autour de la table ; le premier est en bas, comme un joueur qui regarde l’écran. */
function seatPosition(index: number, count: number): { left: number; top: number } {
  const angle = ((90 + (index * 360) / count) * Math.PI) / 180;
  // Rayon vertical un peu réduit : le siège du bas reste au-dessus de la barre de commandes de l’hôte.
  return { left: 50 + 45 * Math.cos(angle), top: 50 + 34 * Math.sin(angle) };
}

/** Écran principal du poker : la table, le tapis, les cartes communes et les jetons de chacun. */
export function PokerHost({ publicState, now }: HostViewProps) {
  const pub = publicState as PokerPublic | null;
  const remaining = useRemaining(pub?.turnEndsAt ?? undefined, now);

  useChange(pub?.board.length ?? 0, (before, after) => {
    if (after > before) play('card');
  });
  useChange(pub?.phase ?? '', (before, phase) => {
    if (before === 'betting' && phase === 'hand-over') play('pickup');
    if (phase === 'final') play('final');
  });

  if (!pub) return null;

  if (!pub.started) {
    return (
      <WaitingScreen
        title={`${pub.order.length} joueurs à la table`}
        text={`${pub.settings.startingChips} jetons chacun · blinde ${pub.settings.bigBlind / 2}/${pub.settings.bigBlind} · ${pub.settings.hands} donnes`}
      />
    );
  }
  if (pub.phase === 'final') return <FinalHost ranking={rankingOf(pub)} />;

  const count = pub.order.length;
  const seatsById = new Map(pub.seats.map((s) => [s.id, s]));
  const reveals = pub.result && !pub.result.byFold ? pub.result.reveals : {};
  const winnerIds = new Set(pub.result?.winners.map((w) => w.pid) ?? []);
  const turnMs = pub.settings.turnSeconds * 1000;

  return (
    <section className={`cards-host poker-host fade-in phase-${pub.phase}`} onPointerDownCapture={() => unlockAudio()}>
      <div className="cards-hud">
        <span className="hud-pill">
          Donne {pub.hand} / {pub.settings.hands}
        </span>
        <span className="hud-pill">
          Blindes {pub.settings.bigBlind / 2} / {pub.settings.bigBlind}
        </span>
        <span className="hud-pill">Pot {pub.pot}</span>
        <SoundToggle />
      </div>

      {pub.turnEndsAt !== null && pub.phase === 'betting' && turnMs > 0 && (
        <TimerBar remaining={remaining} total={turnMs} />
      )}

      <div className="poker-table">
        <div className="poker-felt">
          <div className="poker-board" role="group" aria-label="Cartes communes">
            {[0, 1, 2, 3, 4].map((i) => {
              const card = pub.board[i];
              return card ? <PokerCardFace key={i} card={card} /> : <PokerCardFace key={i} empty />;
            })}
          </div>
          <div className="poker-pot">
            <ChipStack amount={pub.pot} />
            <span className="poker-pot-amount">{pub.pot}</span>
          </div>
          <p className="poker-event" aria-live="polite">
            {pub.lastEvent}
          </p>
        </div>

        {pub.order.map((pid, index) => {
          const seat = seatsById.get(pid);
          const pos = seatPosition(index, count);
          const name = pub.names[pid] ?? '?';
          const chips = pub.chips[pid] ?? 0;
          const out = chips === 0 && !seat?.inHand;
          const cls = [
            'poker-seat',
            pub.current === pid ? 'is-turn' : '',
            seat?.folded ? 'is-folded' : '',
            out ? 'is-out' : '',
            winnerIds.has(pid) ? 'is-winner' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={pid} className={cls} data-seat={pid} style={{ left: `${pos.left}%`, top: `${pos.top}%` }}>
              {pub.dealerId === pid && (
                <span className="poker-dealer" role="img" aria-label="Bouton">
                  D
                </span>
              )}
              <div className="poker-seat-head">
                <Avatar name={name} size="sm" />
                <div className="seat-meta">
                  <span className="seat-name">{name}</span>
                  <span className="seat-score">
                    {chips} jetons{seat?.allIn ? ' · tapis' : ''}
                  </span>
                </div>
              </div>
              {seat?.inHand && !seat.folded && (
                <div className="poker-seat-cards">
                  {reveals[pid] ? (
                    reveals[pid]!.map((card, i) => <PokerCardFace key={i} card={card} small />)
                  ) : (
                    <>
                      <PokerCardFace back small />
                      <PokerCardFace back small />
                    </>
                  )}
                </div>
              )}
              {seat && seat.bet > 0 && (
                <div className="poker-seat-bet">
                  <ChipStack amount={seat.bet} />
                  <span>{seat.bet}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
