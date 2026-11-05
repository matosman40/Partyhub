import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { TimerBar } from '../../client/ui.js';

/** Téléphone de Tirage surprise : une question, un champ pour l'estimation, puis le résultat. */
export function TiragePlayer({ publicState: pub, playerState: me, send, now }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [draft, setDraft] = useState('');
  if (!pub) return null;

  if (pub.phase === 'final') {
    return (
      <section className="player-game fade-in">
        <h2 className="question-small">Fin de partie</h2>
        <p>
          {me?.points ?? 0} points{me?.rank ? ` · ${me.rank}ᵉ` : ''}
        </p>
      </section>
    );
  }

  if (!pub.question) {
    return (
      <section className="player-game fade-in">
        <p className="muted">La partie va commencer, regardez l’écran principal.</p>
      </section>
    );
  }

  const revealed = pub.phase === 'reveal';
  const valeur = Number(draft.replace(/\s/g, ''));
  const valide = draft.trim() !== '' && Number.isInteger(valeur) && valeur >= 0;

  return (
    <section className="player-game fade-in">
      <div className="round-info">
        {pub.round} / {pub.total}
      </div>
      <h2 className="question-small">{pub.question}</h2>
      {!revealed && (
        <>
          <TimerBar remaining={remaining} total={pub.guessSeconds * 1000} />
          {me?.guessed ? (
            <p className="notice">
              Estimation enregistrée : {me.myGuess?.toLocaleString('fr-FR')} {pub.unit}
            </p>
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (valide) void send('estimate', { valeur });
              }}
            >
              <label className="field">
                <span>Votre estimation ({pub.unit})</span>
                <input
                  inputMode="numeric"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={remaining <= 0}
                />
              </label>
              <button type="submit" className="btn primary" disabled={!valide || remaining <= 0}>
                Valider
              </button>
            </form>
          )}
        </>
      )}
      {revealed && pub.answer && (
        <p className="pm-status">
          Réponse : {pub.answer.valeur.toLocaleString('fr-FR')} {pub.unit} · +{me?.points ?? 0} points au total
        </p>
      )}
    </section>
  );
}
