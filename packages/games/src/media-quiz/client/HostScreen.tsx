import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';
import { MediaStage } from './MediaStage.js';
import { CaptionHost } from './CaptionHost.js';

/** Écran principal d'un jeu de questions médias : l'extrait, le compte à rebours, la révélation. */
export function MediaQuizHost(props: HostViewProps) {
  const pub = props.publicState;
  if (pub?.mode === 'sous-titres') return <CaptionHost {...props} />;
  return <MediaQuizQuiz {...props} />;
}

function MediaQuizQuiz({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.answerEndsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') {
    return <FinalHost ranking={pub.ranking} />;
  }

  if (pub.phase === 'ready') {
    return (
      <WaitingScreen
        title={`${pub.kindLabel} : en attente du lancement…`}
        text={`${pub.total} extrait(s) · ${pub.playerCount} joueur(s)`}
      />
    );
  }

  const media = host?.media ?? null;
  const pending: string[] = host?.pending ?? [];
  const label = `${pub.index + 1} / ${pub.total}`;

  if (pub.phase === 'playing') {
    const total = pub.answerMs || 1;
    return (
      <section className="mq-host fade-in" key={`play-${pub.index}`}>
        <div className="round-info">
          Extrait {label} · <span className="tag">{pub.kindLabel}</span>
        </div>
        <h2 className="mq-prompt">{pub.prompt}</h2>
        <MediaStage media={media} active kind={pub.kind} />
        <TimerBar remaining={remaining} total={total} />
        <p className="muted">
          {Math.ceil(remaining / 1000)} s · {pub.answeredCount} / {pub.playerCount} ont répondu
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // Révélation : la réponse, qui a trouvé, et le classement.
  return (
    <section className="mq-host fade-in" key={`reveal-${pub.index}`}>
      <div className="round-info">
        Extrait {label} · <span className="tag">{pub.kindLabel}</span>
      </div>
      <div className="mq-reveal">
        <MediaStage media={media} active={false} kind={pub.kind} />
        <div className="mq-answer">
          <p className="label">C’était</p>
          <h2 className="mq-answer-title">{pub.answer}</h2>
          {pub.detail && <p className="muted">{pub.detail}</p>}
        </div>
      </div>
      <div className="reveal-grid">
        <div>
          <h3>Réponses</h3>
          <ul className="results">
            {pub.results.map((r: { playerId: string; name: string; text: string | null; correct: boolean; gained: number }) => (
              <li key={r.playerId} className={r.correct ? 'ok' : 'ko'}>
                <span>{r.correct ? '✔' : '✘'}</span>
                <span className="name">
                  {r.name}
                  {r.text && <span className="muted small"> « {r.text} »</span>}
                </span>
                <span className="points">+{r.gained}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Classement</h3>
          <Ranking entries={pub.ranking} limit={6} />
        </div>
      </div>
    </section>
  );
}
