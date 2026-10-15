import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { PhotoCapture, SoundRecorder } from './Capture.js';

/** Consigne affichée sur le téléphone, avec son illustration quand elle existe. */
function Prompt({ title, instruction, art }: { title: string; instruction: string; art: string | null }) {
  return (
    <section className="imite-prompt">
      {art && <img className="imite-art" src={art} alt={`Illustration : ${title}`} />}
      <h2>{title}</h2>
      <p className="muted small">{instruction}</p>
    </section>
  );
}

/** Téléphone : répondre (photo, grimace ou son), voter pour une réponse anonyme, puis voir son résultat. */
export function ImitePlayer({ publicState: pub, playerState: me, send }: PlayerViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!pub) return null;

  async function run(type: string, payload: unknown, fallback: string) {
    setBusy(true);
    setError(null);
    const result = await send(type, payload);
    setBusy(false);
    if (!result.ok) setError(result.error ?? fallback);
  }

  const rank = me?.rank ? `Vous êtes ${me.rank}ᵉ` : null;

  if (pub.phase === 'ready') {
    return <p className="notice">La partie commence bientôt : la consigne arrive sur l’écran principal.</p>;
  }

  if (pub.phase === 'submit') {
    return (
      <section className="imite-play fade-in">
        <Prompt title={pub.title} instruction={pub.instruction} art={pub.art} />
        {me?.answered ? (
          <p className="notice">Réponse envoyée ✔ Attendez les autres joueurs.</p>
        ) : pub.kind === 'sound' ? (
          <SoundRecorder busy={busy} onSubmit={(url) => void run('sound', { dataUrl: url }, 'Son refusé.')} />
        ) : (
          <PhotoCapture
            mode={pub.mode === 'galerie' ? 'galerie' : 'grimace'}
            busy={busy}
            onSubmit={(url) => void run('photo', { dataUrl: url }, 'Photo refusée.')}
          />
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  if (pub.phase === 'vote') {
    const voted = me?.myVote !== null && me?.myVote !== undefined;
    return (
      <section className="imite-play fade-in">
        <h2 className="imite-title small">{pub.title}</h2>
        <p className="muted small">Votez pour la réponse la plus réussie. Les auteurs sont cachés.</p>
        <ul className="imite-grid">
          {pub.entries.map((item: { kind: string; dataUrl: string }, i: number) => {
            const mine = me?.myOption === i;
            const chosen = me?.myVote === i;
            return (
              <li key={i} className="imite-entry">
                {item.dataUrl ? (
                  item.kind === 'sound' ? (
                    <audio className="imite-audio" controls src={item.dataUrl} />
                  ) : (
                    <img className="imite-photo" src={item.dataUrl} alt={`Réponse ${i + 1}`} />
                  )
                ) : (
                  <span className="muted">Pas de réponse</span>
                )}
                <button
                  type="button"
                  className={`choice-btn ${chosen ? 'selected' : ''}`}
                  disabled={busy || voted || mine}
                  onClick={() => void run('vote', { option: i }, 'Vote refusé.')}
                >
                  {mine ? 'Votre réponse' : chosen ? 'Votre vote' : 'Voter pour celle-ci'}
                </button>
              </li>
            );
          })}
        </ul>
        {voted && <p className="notice">Vote enregistré ✔</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  if (pub.phase === 'reveal') {
    const gained = me?.gained ?? 0;
    return (
      <section className="imite-play fade-in">
        <h2 className="imite-title small">{pub.title}</h2>
        <p className="notice">
          {gained > 0 ? `+${gained} points grâce à vos votes` : 'Aucun vote pour votre réponse cette fois'}
        </p>
        {rank && <p className="muted small">{rank}</p>}
      </section>
    );
  }

  return (
    <section className="imite-play fade-in">
      <h2>Partie terminée</h2>
      {rank && (
        <p className="notice">
          {rank} · {me?.points ?? 0} points
        </p>
      )}
    </section>
  );
}
