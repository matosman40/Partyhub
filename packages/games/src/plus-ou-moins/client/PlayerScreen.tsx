import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, FinalScreen, PlayingCard, WaitingScreen } from '../../client/ui.js';

export function PlusOuMoinsPlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  if (pub.phase === 'bet') {
    const bet = me?.myBet as 'higher' | 'lower' | null | undefined;
    const closed = remaining <= 0;

    if (me?.answered) {
      return (
        <section className="player-game fade-in">
          <PlayingCard card={pub.current} />
          <p className="notice">
            Pari enregistré : {bet === 'higher' ? '▲ plus haut' : '▼ plus bas'} · En attente des autres…
          </p>
        </section>
      );
    }

    async function betOn(direction: 'higher' | 'lower') {
      await send('bet', { direction });
    }

    return (
      <section className="player-game fade-in">
        <div className="round-info">
          Carte {pub.round + 1} / {pub.total} · <Countdown remaining={remaining} />
        </div>
        <PlayingCard card={pub.current} />
        <div className="bet-buttons">
          <button type="button" className="btn primary big" disabled={closed} onClick={() => betOn('higher')}>
            ▲ Plus haut
          </button>
          <button type="button" className="btn ghost big" disabled={closed} onClick={() => betOn('lower')}>
            ▼ Plus bas
          </button>
        </div>
        <p className="muted">L’as est la carte la plus haute. Égalité = personne ne gagne.</p>
      </section>
    );
  }

  // reveal
  const correct = me?.correct as boolean | null | undefined;
  const gained = me?.gained ?? 0;
  const verdict =
    correct === null || correct === undefined
      ? 'Égalité'
      : correct
        ? 'Bien joué !'
        : me?.myBet
          ? 'Raté…'
          : 'Pas de pari';

  return (
    <section className="player-game fade-in">
      <div className="card-table duo small">
        <PlayingCard card={pub.current} label="Carte de départ" />
        <PlayingCard card={pub.revealed} label="Carte suivante" />
      </div>
      <p className={`verdict ${correct ? 'ok' : correct === false ? 'ko' : ''}`}>{verdict}</p>
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p>
        Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}
      </p>
    </section>
  );
}
