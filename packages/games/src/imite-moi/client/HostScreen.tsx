import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';

interface Shown {
  kind: string;
  dataUrl: string;
}

/** Une réponse : photo ou son. Le son se lance au clic sur l'écran principal. */
function Answer({ item, alt }: { item: Shown; alt: string }) {
  if (!item.dataUrl) return <span className="muted">Pas de réponse</span>;
  if (item.kind === 'sound') return <audio className="imite-audio" controls src={item.dataUrl} />;
  return <img className="imite-photo" src={item.dataUrl} alt={alt} />;
}

function Timer({ percent }: { percent: number }) {
  return (
    <div className="imite-timer" aria-hidden="true">
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Écran principal : consigne, réponses anonymes pendant le vote, auteurs et points à la révélation. */
export function ImiteHost({ publicState: pub, hostState, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'ready') {
    return (
      <section className="imite-host card fade-in">
        <h2>{pub.name}</h2>
        <p className="muted">Chacun imite, photographie ou enregistre la scène, puis tout le monde vote.</p>
      </section>
    );
  }

  if (pub.phase === 'final') {
    return (
      <section className="imite-host card fade-in">
        <h2>Classement final</h2>
        <ol className="imite-ranking">
          {pub.ranking.map((entry: { playerId: string; name: string; points: number; rank: number }) => (
            <li key={entry.playerId}>
              <span>{entry.name}</span>
              <strong>{entry.points} pts</strong>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const durationMs = Number(pub.durationMs ?? 0);
  const percent = durationMs > 0 ? Math.max(0, Math.min(100, (remaining / durationMs) * 100)) : 0;
  const pending: string[] = hostState?.pending ?? [];

  return (
    <section className="imite-host fade-in">
      <p className="muted small">
        Manche {pub.index + 1} / {pub.total} · {pub.modeLabel}
      </p>

      {pub.phase === 'submit' && (
        <>
          <div className="imite-scene">
            {pub.art ? <img src={pub.art} alt={`Illustration : ${pub.title}`} /> : <span aria-hidden="true">🔊</span>}
          </div>
          <h2 className="imite-title">{pub.title}</h2>
          <p className="imite-instruction">{pub.instruction}</p>
          <Timer percent={percent} />
          <p className="muted">
            {pub.submittedCount} / {pub.playerCount} réponses
            {pending.length > 0 && ` · en attente : ${pending.join(', ')}`}
          </p>
        </>
      )}

      {pub.phase === 'vote' && (
        <>
          <h2 className="imite-title small">{pub.title}</h2>
          <Timer percent={percent} />
          <ul className="imite-grid">
            {pub.entries.map((item: Shown, i: number) => (
              <li key={i} className="imite-entry">
                <Answer item={item} alt={`Réponse ${i + 1}`} />
                <span className="imite-label">Réponse {i + 1}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            {pub.voteCount} / {pub.playerCount} votes
            {pending.length > 0 && ` · en attente : ${pending.join(', ')}`}
          </p>
        </>
      )}

      {pub.phase === 'reveal' && (
        <>
          <h2 className="imite-title small">{pub.title}</h2>
          <ul className="imite-grid">
            {pub.results.map((item: Shown & { author: string; votes: number; gained: number }, i: number) => (
              <li key={i} className="imite-entry">
                <Answer item={item} alt={`Réponse de ${item.author}`} />
                <span className="imite-label">{item.author}</span>
                <span className="muted small">
                  {item.votes} vote{item.votes > 1 ? 's' : ''}
                  {item.gained > 0 && ` · +${item.gained}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
