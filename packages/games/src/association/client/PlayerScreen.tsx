import { useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, FinalScreen, LETTERS, WaitingScreen } from '../../client/ui.js';

export function AssociationPlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  if (pub.phase === 'write') {
    if (me?.answered) {
      return (
        <WaitingScreen title={`Votre mot : « ${me.myWord ?? ''} »`} text="Mot envoyé ✔ · En attente des autres…" />
      );
    }

    async function submit(e: FormEvent) {
      e.preventDefault();
      const value = word.trim();
      if (!value || busy) return;
      setBusy(true);
      setError(null);
      const res = await send('word', { word: value });
      setBusy(false);
      if (!res.ok) setError(res.error ?? 'Mot refusé');
    }

    return (
      <section className="player-game fade-in">
        <div className="round-info">
          Manche {pub.round + 1} / {pub.total} · <Countdown remaining={remaining} />
        </div>
        <h2 className="question-small">{pub.prompt}</h2>
        <form className="stack" onSubmit={submit}>
          <label className="field big-field">
            <span>Votre association</span>
            <input
              value={word}
              maxLength={24}
              autoComplete="off"
              autoFocus
              onChange={(e) => setWord(e.target.value)}
            />
          </label>
          <button type="submit" className="btn primary big" disabled={busy || !word.trim() || remaining <= 0}>
            Envoyer
          </button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    );
  }

  if (pub.phase === 'vote') {
    async function choose(option: number) {
      if (me?.answered || busy) return;
      setBusy(true);
      setError(null);
      const res = await send('vote', { option });
      setBusy(false);
      if (!res.ok) setError(res.error ?? 'Vote refusé');
    }

    return (
      <section className="player-game fade-in">
        <div className="round-info">
          Vote · <Countdown remaining={remaining} />
        </div>
        <h2 className="question-small">{pub.prompt}</h2>
        <div className="choices-stack">
          {pub.options.map((word: string, i: number) => {
            const mine = me?.myOption === i;
            return (
              <button
                key={i}
                type="button"
                className={`choice-btn${me?.myVote === i ? ' selected' : ''}`}
                disabled={me?.answered || mine || remaining <= 0 || busy}
                onClick={() => choose(i)}
              >
                <span className="letter">{LETTERS[i]}</span>
                {mine ? `${word} (le vôtre)` : word}
              </button>
            );
          })}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {me?.answered ? (
          <p className="notice">Vote enregistré ✔ · En attente des autres…</p>
        ) : (
          <p className="muted">Votez pour le mot le plus drôle.</p>
        )}
      </section>
    );
  }

  // reveal
  const gained = me?.gained ?? 0;
  return (
    <section className="player-game fade-in">
      <p className={`verdict ${gained > 0 ? 'ok' : ''}`}>
        {gained > 0 ? 'Votre mot a plu !' : 'Pas de vote pour vous cette fois'}
      </p>
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p>Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}</p>
    </section>
  );
}
