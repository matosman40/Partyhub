import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { TimerBar } from '../../client/ui.js';
import { PhotoMap, type MapMarker } from '../../photo-mystere/client/PhotoMap.js';

/** Téléphone de Tirage surprise : une estimation à taper, un choix à toucher, ou un lieu à placer sur la carte. */
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
  const choix: string[] = pub.choices ?? [];
  const monChoix = me?.myGuess !== null && me?.myGuess !== undefined ? choix[me.myGuess] : undefined;
  const localisation = pub.kind === 'localiser';
  const choixPossible = pub.kind === 'identifier';

  return (
    <section className="player-game fade-in">
      <div className="round-info">
        {pub.round} / {pub.total}
      </div>
      <h2 className="question-small">{pub.question}</h2>
      {localisation && pub.image && <img className="tirage-photo-tel" src={pub.image} alt="Lieu à placer" />}
      {!revealed && (
        <>
          <TimerBar remaining={remaining} total={pub.guessSeconds * 1000} />
          {localisation && (
            <>
              <PhotoMap
                label="Carte : touchez l’endroit où se trouve le lieu"
                markers={monPoint(me?.myPin)}
                onPick={remaining > 0 ? (lat, lon) => void send('locate', { lat, lon }) : undefined}
              />
              <p className="muted">
                {me?.myPin
                  ? 'Point placé. Touchez la carte pour le déplacer.'
                  : 'Touchez la carte pour placer le lieu.'}
              </p>
            </>
          )}
          {choixPossible &&
            (me?.guessed ? (
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
            ))}
          {pub.kind === 'estimer' &&
            (me?.guessed ? (
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
            ))}
        </>
      )}
      {revealed && pub.answer && pub.kind === 'estimer' && (
        <p className="pm-status">
          Réponse : {pub.answer.valeur?.toLocaleString('fr-FR')} {pub.unit} · +{me?.points ?? 0} points au total
        </p>
      )}
      {revealed && pub.answer && choixPossible && (
        <p className="pm-status">
          Réponse : {pub.answer.reponse} · +{me?.points ?? 0} points au total
        </p>
      )}
      {revealed && pub.answer && localisation && pub.target && (
        <>
          <PhotoMap
            label="Carte : le lieu et votre point"
            markers={[
              ...monPoint(me?.myPin),
              { key: 'lieu', name: pub.answer.reponse ?? 'Lieu', ...pub.target, tone: 'answer' },
            ]}
            links={
              me?.myPin
                ? [
                    {
                      from: { key: 'moi', name: 'Vous', ...me.myPin, tone: 'me' },
                      to: { key: 'lieu', name: 'Lieu', ...pub.target, tone: 'answer' },
                    },
                  ]
                : undefined
            }
          />
          <p className="pm-status">
            Réponse : {pub.answer.reponse} · +{me?.points ?? 0} points au total
          </p>
        </>
      )}
    </section>
  );
}

function monPoint(pin: { lat: number; lon: number } | null | undefined): MapMarker[] {
  return pin ? [{ key: 'moi', name: 'Vous', lat: pin.lat, lon: pin.lon, tone: 'me' }] : [];
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
