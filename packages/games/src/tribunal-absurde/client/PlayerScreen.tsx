import { useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, FinalScreen, LETTERS, WaitingScreen } from '../../client/ui.js';
import { DEFENSE_MAX_LENGTH } from '../info.js';

export function TribunalPlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="Le tribunal va bientôt siéger." />;
  }

  const header = (
    <div className="round-info">
      Affaire {pub.round + 1} / {pub.total} · {pub.modeLabel}
    </div>
  );

  if (pub.phase === 'write') {
    if (me?.answered) {
      return <WaitingScreen title="Défense envoyée ✔" text="Le jury délibère dès que tout le monde a écrit." />;
    }

    async function submit(e: FormEvent) {
      e.preventDefault();
      const value = text.trim();
      if (!value || busy) return;
      setBusy(true);
      setError(null);
      const res = await send('defense', { text: value });
      setBusy(false);
      if (!res.ok) setError(res.error ?? 'Défense refusée');
    }

    return (
      <section className="player-game tribunal fade-in">
        {header}
        <p className="tribunal-hint">{pub.hint}</p>
        <h2 className="question-small">{pub.situation}</h2>
        <form className="stack" onSubmit={submit}>
          <label className="field big-field">
            <span>
              Votre défense · <Countdown remaining={remaining} />
            </span>
            <textarea
              value={text}
              rows={3}
              maxLength={DEFENSE_MAX_LENGTH}
              autoComplete="off"
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button type="submit" className="btn primary big" disabled={busy || !text.trim() || remaining <= 0}>
            Envoyer ma défense
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
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
      <section className="player-game tribunal fade-in">
        {header}
        <p className="label">
          Le jury vote · <Countdown remaining={remaining} />
        </p>
        <div className="choices-stack">
          {pub.options.map((defense: string, i: number) => {
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
                {mine ? `${defense} (la vôtre)` : defense}
              </button>
            );
          })}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {me?.answered ? (
          <p className="notice">Vote enregistré ✔ · En attente des autres…</p>
        ) : (
          <p className="muted">Votez pour la défense la plus convaincante.</p>
        )}
      </section>
    );
  }

  // reveal : verdict personnel.
  const gained = me?.gained ?? 0;
  const verdict = me?.verdict ?? null;
  return (
    <section className="player-game tribunal fade-in">
      {me?.myDefense && <p className="tribunal-own">« {me.myDefense} »</p>}
      <p className={`verdict ${verdict === 'acquittee' ? 'ok' : ''}`}>
        {verdict === 'acquittee' && 'Acquittée !'}
        {verdict === 'condamnee' && 'Condamnée…'}
        {verdict === null && 'Pas de verdict cette fois'}
      </p>
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p>
        Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}
      </p>
    </section>
  );
}
