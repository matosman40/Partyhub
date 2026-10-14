import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { LETTERS } from '../../client/ui.js';

export function QuizPlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.answerEndsAt, now);
  // Retour visuel immédiat : le choix apparaît avant la confirmation du serveur.
  const [picked, setPicked] = useState<{ index: number; choice: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!pub) return null;

  const index: number = pub.index;
  const myChoice: number | null =
    me?.myChoice ?? (picked && picked.index === index ? picked.choice : null);
  const answered = myChoice !== null;

  async function choose(choice: number) {
    if (pub.phase !== 'question' || answered) return;
    setError(null);
    setPicked({ index, choice });
    const res = await send('answer', { choice });
    if (!res.ok) {
      setPicked(null);
      setError(res.error ?? 'Réponse refusée');
    }
  }

  if (pub.phase === 'final') {
    return (
      <section className="player-game fade-in">
        <h2>Partie terminée</h2>
        <p className="big-number">{me?.points ?? 0} pts</p>
        <p>Vous êtes {me?.rank ? `${me.rank}ᵉ` : '—'} du classement.</p>
        <p className="muted">Regardez l'écran principal pour le podium final.</p>
      </section>
    );
  }

  if (pub.phase === 'ready' || !pub.question) {
    return (
      <section className="player-game fade-in">
        <p className="big">Préparez-vous !</p>
        <p className="muted">La partie va commencer, gardez les yeux sur l'écran principal.</p>
      </section>
    );
  }

  const q = pub.question;

  if (pub.phase === 'reveal') {
    const correct = me?.correct === true;
    return (
      <section className="player-game fade-in">
        <p className={`verdict ${correct ? 'ok' : 'ko'}`}>
          {myChoice === null ? 'Pas de réponse' : correct ? 'Bonne réponse !' : 'Raté…'}
        </p>
        {me?.gained > 0 && <p className="big-number">+{me.gained}</p>}
        <p>
          Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}
        </p>
        <div className="choices-stack">
          {q.choices.map((c: string, i: number) => (
            <button
              key={i}
              type="button"
              disabled
              className={`choice-btn ${i === pub.answer ? 'correct' : ''} ${
                i === myChoice && i !== pub.answer ? 'wrong' : ''
              }`}
            >
              <span className="letter">{LETTERS[i]}</span>
              {c}
            </button>
          ))}
        </div>
      </section>
    );
  }

  // question
  return (
    <section className="player-game fade-in" key={`p-${index}`}>
      <div className="round-info">
        {index + 1} / {pub.total} · {q.category} · {Math.ceil(remaining / 1000)} s
      </div>
      <h2 className="question-small">{q.text}</h2>
      <div className="choices-stack">
        {q.choices.map((c: string, i: number) => (
          <button
            key={i}
            type="button"
            className={`choice-btn ${myChoice === i ? 'selected' : ''}`}
            disabled={answered || remaining <= 0}
            onClick={() => choose(i)}
          >
            <span className="letter">{LETTERS[i]}</span>
            {c}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {answered ? (
        <p className="notice">Réponse envoyée ✔ · En attente des autres…</p>
      ) : (
        <p className="muted">Touchez votre réponse.</p>
      )}
    </section>
  );
}
