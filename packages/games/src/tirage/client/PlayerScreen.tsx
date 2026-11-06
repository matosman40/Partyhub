import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { TimerBar } from '../../client/ui.js';

/** Téléphone de Tirage surprise : une estimation à taper, ou un choix à toucher, puis le résultat. */
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
  const identification = pub.kind === 'identifier';
  const choix: string[] = pub.choices ?? [];
  const monChoix = me?.myGuess !== null && me?.myGuess !== undefined ? choix[me.myGuess] : undefined;

  return (
    <section className="player-game fade-in">
      <div className="round-info">
        {pub.round} / {pub.total}
      </div>
      <h2 className="question-small">{pub.question}</h2>
      {!revealed && (
        <>
          <TimerBar remaining={remaining} total={pub.guessSeconds * 1000} />
          {identification ? (
            me?.guessed ? (
              <p className="notice">Choix enregistré : {monChoix ?? '…'}</p>
            ) : (
              <ul className="stack tirage-reponses" aria-label="Réponses possibles">
                {choix.map((texte, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className="btn"
                      disabled={remaining <= 0}
                      onClick={() => void send('choose', { choix: index })}
                    >
                      {texte}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : me?.guessed ? (
            <p className="notice">
              Estimation enregistrée : {me.myGuess?.toLocaleString('fr-FR')} {pub.unit}
            </p>
          ) : (
            <EstimationForm
              unit={pub.unit}
              draft={draft}
              setDraft={setDraft}
              disabled={remaining <= 0}
              onSubmit={(valeur) => void send('estimate', { valeur })}
            />
          )}
        </>
      )}
      {revealed && pub.answer && !identification && (
        <p className="pm-status">
          Réponse : {pub.answer.valeur?.toLocaleString('fr-FR')} {pub.unit} · +{me?.points ?? 0} points au total
        </p>
      )}
      {revealed && pub.answer && identification && (
        <p className="pm-status">
          Réponse : {pub.answer.reponse} · +{me?.points ?? 0} points au total
        </p>
      )}
    </section>
  );
}

function EstimationForm({
  unit,
  draft,
  setDraft,
  disabled,
  onSubmit,
}: {
  unit: string | null;
  draft: string;
  setDraft: (value: string) => void;
  disabled: boolean;
  onSubmit: (valeur: number) => void;
}) {
  const valeur = Number(draft.replace(/\s/g, ''));
  const valide = draft.trim() !== '' && Number.isInteger(valeur) && valeur >= 0;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (valide) onSubmit(valeur);
      }}
    >
      <label className="field">
        <span>Votre estimation ({unit})</span>
        <input inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={disabled} />
      </label>
      <button type="submit" className="btn primary" disabled={!valide || disabled}>
        Valider
      </button>
    </form>
  );
}
