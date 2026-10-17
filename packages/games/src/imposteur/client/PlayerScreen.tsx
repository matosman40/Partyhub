import { useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, Countdown, FinalScreen, WaitingScreen } from '../../client/ui.js';

interface Candidate {
  id: string;
  name: string;
}

/** Rôle secret reçu par le joueur : imposteur sans mot, ou membre de l’équipe avec le mot. */
function RoleCard({ me }: { me: { role?: string; category?: string; word?: string } | null | undefined }) {
  if (me?.role === 'impostor') {
    return (
      <div className="role-card impostor">
        <p className="role-title">Vous êtes l’IMPOSTEUR 🕵️</p>
        <p>
          Catégorie : <strong>{me.category}</strong>
        </p>
        <p className="muted">Vous ne connaissez pas le mot. Donnez un indice crédible !</p>
      </div>
    );
  }
  if (me?.role === 'crew') {
    return (
      <div className="role-card crew">
        <p className="role-title">Mot secret</p>
        <p className="secret-word">{me.word}</p>
        <p className="muted">Catégorie : {me.category}</p>
      </div>
    );
  }
  return null;
}

export function ImposteurPlayer({ publicState: pub, playerState: me, playerId, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  async function run(type: string, payload: unknown) {
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Action refusée');
    return res.ok;
  }

  if (pub.phase === 'clues') {
    async function submit(e: FormEvent) {
      e.preventDefault();
      const value = text.trim();
      if (!value || busy) return;
      await run('clue', { text: value });
    }

    if (me?.answered) {
      return (
        <section className="player-game fade-in">
          <RoleCard me={me} />
          <p className="notice">Indice envoyé ✔ · En attente des autres…</p>
        </section>
      );
    }

    return (
      <section className="player-game fade-in">
        <div className="round-info">
          Manche {pub.round + 1} / {pub.total} · <Countdown remaining={remaining} />
        </div>
        <RoleCard me={me} />
        <form className="stack" onSubmit={submit}>
          <label className="field big-field">
            <span>Votre indice (un mot ou une courte phrase)</span>
            <input value={text} maxLength={24} autoComplete="off" onChange={(e) => setText(e.target.value)} />
          </label>
          <button type="submit" className="btn primary big" disabled={busy || !text.trim() || remaining <= 0}>
            Envoyer l’indice
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
    return (
      <section className="player-game fade-in">
        <div className="round-info">
          Vote · <Countdown remaining={remaining} />
        </div>
        <RoleCard me={me} />
        <p className="label">Qui est l’imposteur ?</p>
        <div className="candidate-list">
          {(pub.candidates as Candidate[]).map((c) => {
            const isMe = c.id === playerId;
            return (
              <button
                key={c.id}
                type="button"
                className={`candidate${me?.myVote === c.id ? ' selected' : ''}`}
                disabled={isMe || me?.answered || remaining <= 0 || busy}
                onClick={() => run('vote', { target: c.id })}
              >
                <Avatar name={c.name} />
                <span>
                  {c.name}
                  {isMe ? ' (vous)' : ''}
                </span>
              </button>
            );
          })}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {me?.answered && <p className="notice">Vote enregistré ✔</p>}
      </section>
    );
  }

  if (pub.phase === 'guess') {
    if (me?.canGuess) {
      async function guess(e: FormEvent) {
        e.preventDefault();
        const value = text.trim();
        if (!value || busy) return;
        await run('guess', { word: value });
      }
      return (
        <section className="player-game fade-in">
          <p className="verdict ko">Vous êtes démasqué !</p>
          <p>Devinez le mot secret pour marquer des points :</p>
          <form className="stack" onSubmit={guess}>
            <label className="field big-field">
              <span>Le mot secret est…</span>
              <input value={text} maxLength={40} autoComplete="off" onChange={(e) => setText(e.target.value)} />
            </label>
            <button type="submit" className="btn primary big" disabled={busy || !text.trim()}>
              Proposer
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <Countdown remaining={remaining} />
        </section>
      );
    }
    return (
      <WaitingScreen
        title={`${pub.accusedName ?? 'Quelqu’un'} est démasqué !`}
        text="L’imposteur tente de deviner le mot…"
      />
    );
  }

  // reveal
  const gained = me?.gained ?? 0;
  return (
    <section className="player-game fade-in">
      <RoleCard me={me} />
      <p className={`verdict ${gained > 0 ? 'ok' : 'ko'}`}>
        {gained > 0 ? 'Point(s) marqué(s) !' : 'Aucun point cette manche'}
      </p>
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p>
        Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}
      </p>
    </section>
  );
}
