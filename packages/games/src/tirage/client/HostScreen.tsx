import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Ranking, TimerBar, type RankRow } from '../../client/ui.js';

/** Écran principal de Tirage surprise : la question, le temps, puis la bonne valeur et les estimations. */
export function TirageHost({ publicState: pub, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') {
    return (
      <section className="pm-host fade-in final">
        <h2 className="big-title">Classement final</h2>
        <Ranking entries={pub.ranking as RankRow[]} />
      </section>
    );
  }

  if (pub.phase === 'ready' || !pub.question) {
    return (
      <section className="pm-host fade-in">
        <h2 className="big-title">Tirage surprise</h2>
        <p className="muted">Devinez des chiffres réels, au plus près.</p>
      </section>
    );
  }

  const revealed = pub.phase === 'reveal';
  return (
    <section className="pm-host fade-in">
      <div className="round-info">
        Question {pub.round} / {pub.total}
      </div>
      <h2 className="question-title">{pub.question}</h2>
      {!revealed && (
        <>
          <TimerBar remaining={remaining} total={pub.guessSeconds * 1000} />
          <p className="muted">
            {pub.answered} / {pub.playerCount} ont répondu
          </p>
        </>
      )}
      {revealed && pub.answer && (
        <>
          <p className="pm-answer">
            {pub.answer.valeur.toLocaleString('fr-FR')} {pub.unit}
          </p>
          <p className="pm-credit">Source : {pub.answer.source}</p>
          <ul className="pm-results" aria-label="Estimations">
            {pub.placements.map((p: { playerId: string; name: string; guess: number | null; gained: number }) => (
              <li key={p.playerId}>
                <span>{p.name}</span>
                <span className="muted">{p.guess === null ? 'pas d’estimation' : p.guess.toLocaleString('fr-FR')}</span>
                <span className="pm-gain">+{p.gained}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
