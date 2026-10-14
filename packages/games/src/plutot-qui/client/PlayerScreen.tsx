import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, Countdown, FinalScreen, WaitingScreen } from '../../client/ui.js';

interface Candidate {
  id: string;
  name: string;
}

export function PlutotQuiPlayer({ publicState: pub, playerState: me, playerId, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  if (pub.phase === 'vote') {
    async function choose(target: string) {
      if (me?.answered || busy) return;
      setBusy(true);
      setError(null);
      const res = await send('vote', { target });
      setBusy(false);
      if (!res.ok) setError(res.error ?? 'Vote refusé');
    }

    return (
      <section className="player-game fade-in">
        <div className="round-info">
          Question {pub.round + 1} / {pub.total} · <Countdown remaining={remaining} />
        </div>
        <h2 className="question-small">{pub.prompt}</h2>
        <div className="candidate-list">
          {(pub.candidates as Candidate[]).map((c) => {
            const isMe = c.id === playerId;
            return (
              <button
                key={c.id}
                type="button"
                className={`candidate${me?.myVote === c.id ? ' selected' : ''}`}
                disabled={me?.answered || remaining <= 0 || busy}
                onClick={() => choose(c.id)}
              >
                <Avatar name={c.name} />
                <span>{c.name}{isMe ? ' (vous)' : ''}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {me?.answered ? (
          <p className="notice">Vote enregistré ✔ · En attente des autres…</p>
        ) : (
          <p className="muted">Touchez le nom de la personne qui correspond le mieux.</p>
        )}
      </section>
    );
  }

  // reveal
  const gained = me?.gained ?? 0;
  return (
    <section className="player-game fade-in">
      <p className={`verdict ${gained > 0 ? 'ok' : 'ko'}`}>
        {me?.myVote ? (gained > 0 ? 'Vous étiez avec la majorité !' : 'Pas la majorité cette fois') : 'Pas de vote'}
      </p>
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p>Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}</p>
    </section>
  );
}
