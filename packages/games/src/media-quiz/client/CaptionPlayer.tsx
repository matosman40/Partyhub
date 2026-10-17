import { useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';

/** Téléphone des sous-titres : on écrit la réplique, puis on vote pour la plus drôle. */
export function CaptionPlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<{ index: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pub) return null;

  const index: number = pub.index;
  const myCaption: string | null = me?.myCaption ?? (sent && sent.index === index ? sent.text : null);
  const wrote = myCaption !== null;
  const voted = me?.myVote !== null && me?.myVote !== undefined;

  async function submitCaption(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pub.phase !== 'write' || wrote || busy) return;
    setError(null);
    setBusy(true);
    setSent({ index, text });
    const res = await send('caption', { text });
    setBusy(false);
    if (!res.ok) {
      setSent(null);
      setError(res.error ?? 'Réplique refusée');
      return;
    }
    setDraft('');
  }

  async function vote(option: number) {
    if (busy || voted || pub.phase !== 'vote') return;
    setError(null);
    setBusy(true);
    const res = await send('vote', { option });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Vote refusé');
  }

  if (pub.phase === 'final') {
    return (
      <section className="player-game fade-in">
        <h2>Partie terminée</h2>
        <p className="big-number">{me?.points ?? 0} pts</p>
        <p>Vous êtes {me?.rank ? `${me.rank}ᵉ` : '—'} du classement.</p>
        <p className="muted">Regardez l’écran principal pour le podium final.</p>
      </section>
    );
  }

  if (pub.phase === 'ready') {
    return (
      <section className="player-game fade-in">
        <p className="big">Préparez-vous !</p>
        <p className="muted">Les sous-titres vont commencer. Gardez les yeux sur l’écran principal.</p>
      </section>
    );
  }

  if (pub.phase === 'reveal') {
    return (
      <section className="player-game fade-in">
        <p className={`verdict mq-verdict ${me?.gained > 0 ? 'ok' : 'ko'}`}>
          {me?.gained > 0 ? 'Vos voix !' : 'Pas de vote cette fois'}
        </p>
        {me?.gained > 0 && <p className="big-number">+{me.gained}</p>}
        {wrote && <p className="mq-sent">Votre réplique : « {myCaption} »</p>}
        {pub.answer && (
          <p className="mq-answer-recap">
            Traduction de référence : <strong>{pub.answer}</strong>
          </p>
        )}
        <p>
          Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}
        </p>
      </section>
    );
  }

  if (pub.phase === 'vote') {
    const options: string[] = pub.options ?? [];
    return (
      <section className="player-game fade-in" key={`v-${index}`}>
        <div className="round-info">
          {index + 1} / {pub.total} · Vote · {Math.ceil(remaining / 1000)} s
        </div>
        <h2 className="question-small">Quelle réplique est la plus drôle ?</h2>
        {voted ? (
          <p className="notice">Vote envoyé ✔ · En attente des autres…</p>
        ) : (
          <ul className="mq-choices">
            {options.map((text, i) => {
              const own = me?.myOption === i;
              return (
                <li key={i}>
                  <button
                    type="button"
                    className="mq-option-btn"
                    disabled={own || busy || remaining <= 0}
                    onClick={() => vote(i)}
                  >
                    <span>« {text} »</span>
                    {own && <span className="muted small"> (la vôtre)</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  // Phase d’écriture.
  return (
    <section className="player-game fade-in" key={`w-${index}`}>
      <div className="round-info">
        {index + 1} / {pub.total} · Sous-titres · {Math.ceil(remaining / 1000)} s
      </div>
      <h2 className="question-small">{pub.prompt}</h2>
      {pub.hint && <p className="mq-hint">Indice : {pub.hint}</p>}
      {wrote ? (
        <>
          <p className="mq-sent">« {myCaption} »</p>
          <p className="notice">Réplique envoyée ✔ · En attente des autres…</p>
        </>
      ) : (
        <form className="mq-form" onSubmit={submitCaption}>
          <label className="sr-only" htmlFor="mq-caption">
            Votre réplique
          </label>
          <input
            id="mq-caption"
            className="mq-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={remaining <= 0}
            maxLength={120}
            autoComplete="off"
            autoCapitalize="sentences"
            spellCheck
            enterKeyHint="send"
            placeholder="Écrivez la réplique…"
            autoFocus
          />
          <button type="submit" className="btn primary big" disabled={!draft.trim() || remaining <= 0 || busy}>
            Envoyer
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
