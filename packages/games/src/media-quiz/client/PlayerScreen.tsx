import { useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { CaptionPlayer } from './CaptionPlayer.js';

/** Téléphone : on tape le titre pendant que l'extrait joue sur l'écran principal. */
export function MediaQuizPlayer(props: PlayerViewProps) {
  if (props.publicState?.mode === 'sous-titres') return <CaptionPlayer {...props} />;
  return <MediaQuizQuizPlayer {...props} />;
}

function MediaQuizQuizPlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.answerEndsAt, now);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<{ index: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!pub) return null;

  const index: number = pub.index;
  const myText: string | null = me?.myText ?? (sent && sent.index === index ? sent.text : null);
  const answered = myText !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pub.phase !== 'playing' || answered) return;
    setError(null);
    setSent({ index, text });
    const res = await send('answer', { text });
    if (!res.ok) {
      setSent(null);
      setError(res.error ?? 'Réponse refusée');
      return;
    }
    setDraft('');
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
        <p className="muted">{pub.kindLabel} va commencer. Gardez les yeux sur l’écran principal.</p>
      </section>
    );
  }

  if (pub.phase === 'reveal') {
    const correct = me?.correct === true;
    return (
      <section className="player-game fade-in">
        <p className={`verdict mq-verdict ${correct ? 'ok' : 'ko'}`}>
          {myText === null ? 'Pas de réponse' : correct ? 'Bonne réponse !' : 'Raté…'}
        </p>
        {me?.gained > 0 && <p className="big-number">+{me.gained}</p>}
        <p className="mq-answer-recap">
          C’était <strong>{pub.answer}</strong>
        </p>
        {pub.detail && <p className="muted small">{pub.detail}</p>}
        <p>
          Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}
        </p>
      </section>
    );
  }

  // Phase de réponse.
  return (
    <section className="player-game fade-in" key={`p-${index}`}>
      <div className="round-info">
        {index + 1} / {pub.total} · {pub.kindLabel} · {Math.ceil(remaining / 1000)} s
      </div>
      <h2 className="question-small">{pub.prompt}</h2>
      {answered ? (
        <>
          <p className="mq-sent">« {myText} »</p>
          <p className="notice">Réponse envoyée ✔ · En attente des autres…</p>
        </>
      ) : (
        <form className="mq-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="mq-answer">
            Votre réponse
          </label>
          <input
            id="mq-answer"
            className="mq-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={remaining <= 0}
            maxLength={80}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            placeholder="Tapez le titre…"
            autoFocus
          />
          <button type="submit" className="btn primary big" disabled={!draft.trim() || remaining <= 0}>
            Envoyer
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!answered && <p className="muted small">Une seule réponse par extrait. L’article de début est facultatif.</p>}
    </section>
  );
}
