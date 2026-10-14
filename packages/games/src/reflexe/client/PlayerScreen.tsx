import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';

export function ReflexePlayer({ publicState: pub, playerState: me, send }: PlayerViewProps) {
  const [error, setError] = useState<string | null>(null);

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  if (pub.phase === 'reveal') {
    const gained = me?.gained ?? 0;
    return (
      <section className="player-game fade-in">
        <p className="verdict">
          {me?.falseStart
            ? 'Faux départ !'
            : me?.reaction !== null && me?.reaction !== undefined
              ? `${Math.round(me.reaction)} ms`
              : 'Trop lent'}
        </p>
        {gained > 0 && <p className="big-number">+{gained}</p>}
        <p>
          Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}
        </p>
      </section>
    );
  }

  const acted: boolean = !!me?.acted;

  async function tap() {
    if (acted) return;
    setError(null);
    const res = await send('tap');
    if (!res.ok) setError(res.error ?? 'Trop tard');
  }

  if (pub.phase === 'wait') {
    if (acted) {
      return (
        <WaitingScreen
          title={me?.falseStart ? 'Trop tôt !' : 'Touché !'}
          text={me?.falseStart ? 'Faux départ : vous attendrez la prochaine manche.' : 'Attendez le résultat…'}
        />
      );
    }
    return (
      <section className="player-game fade-in">
        <button type="button" className="reflex-pad red" onClick={tap}>
          Attendez le vert…
        </button>
        <p className="muted">Touchez seulement quand l’écran devient vert !</p>
      </section>
    );
  }

  // go
  if (acted) {
    return (
      <WaitingScreen
        title={me?.reaction !== null && me?.reaction !== undefined ? `${Math.round(me.reaction)} ms` : 'Touché !'}
        text="En attente des autres…"
      />
    );
  }

  return (
    <section className="player-game fade-in">
      <button type="button" className="reflex-pad green" onClick={tap}>
        TOUCHEZ !
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
