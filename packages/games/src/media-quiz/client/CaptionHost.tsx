import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';
import { MediaStage } from './MediaStage.js';

interface CaptionResult {
  text: string;
  author: string;
  votes: number;
  gained: number;
}

/** Écran principal des sous-titres : la scène, les répliques anonymes, puis les auteurs. */
export function CaptionHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;

  if (pub.phase === 'ready') {
    return (
      <WaitingScreen
        title="Sous-titres : en attente du lancement…"
        text={`${pub.total} scène(s) · ${pub.playerCount} joueur(s)`}
      />
    );
  }

  const media = host?.media ?? null;
  const pending: string[] = host?.pending ?? [];
  const label = `${pub.index + 1} / ${pub.total}`;

  if (pub.phase === 'write') {
    return (
      <section className="mq-host fade-in" key={`write-${pub.index}`}>
        <div className="round-info">
          Scène {label} · <span className="tag">{pub.kindLabel}</span>
        </div>
        <h2 className="mq-prompt">{pub.prompt}</h2>
        {pub.hint && <p className="mq-hint">Indice : {pub.hint}</p>}
        <MediaStage media={media} active kind={pub.kind} />
        <TimerBar remaining={remaining} total={pub.durationMs || 1} />
        <p className="muted">
          {Math.ceil(remaining / 1000)} s · {pub.writtenCount} / {pub.playerCount} ont écrit
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  if (pub.phase === 'vote') {
    return (
      <section className="mq-host fade-in" key={`vote-${pub.index}`}>
        <div className="round-info">
          Scène {label} · <span className="tag">Vote</span>
        </div>
        <h2 className="mq-prompt">Quelle réplique est la plus drôle ?</h2>
        <MediaStage media={media} active={false} kind={pub.kind} />
        <ol className="mq-options">
          {pub.options.map((text: string, i: number) => (
            <li key={i} className="mq-option-line">
              <span className="mq-option-number">{i + 1}</span>
              <span>« {text} »</span>
            </li>
          ))}
        </ol>
        <TimerBar remaining={remaining} total={pub.durationMs || 1} />
        <p className="muted">
          {Math.ceil(remaining / 1000)} s · {pub.voteCount} / {pub.playerCount} ont voté
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // Révélation : traduction de référence, auteurs, votes et classement.
  const results: CaptionResult[] = pub.results ?? [];
  return (
    <section className="mq-host fade-in" key={`reveal-${pub.index}`}>
      <div className="round-info">
        Scène {label} · <span className="tag">{pub.kindLabel}</span>
      </div>
      <div className="mq-reveal">
        <MediaStage media={media} active={false} kind={pub.kind} />
        {pub.answer && (
          <div className="mq-answer">
            <p className="label">Traduction de référence</p>
            <h2 className="mq-answer-title">{pub.answer}</h2>
          </div>
        )}
      </div>
      <div className="reveal-grid">
        <div>
          <h3>Répliques</h3>
          <ul className="results">
            {results.map((r, i) => (
              <li key={i} className={r.votes > 0 ? 'ok' : ''}>
                <span className="points">{r.votes} vote(s)</span>
                <span className="name">
                  « {r.text} » <span className="muted small">— {r.author}</span>
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
