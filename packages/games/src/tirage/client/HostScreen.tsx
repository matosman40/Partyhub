import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Ranking, TimerBar, type RankRow } from '../../client/ui.js';

/** Écran principal de Tirage surprise : la question (et l'image ou les choix), le temps, puis la révélation. */
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
        <p className="muted">Devinez des chiffres réels, ou reconnaissez l’auteur d’un tableau.</p>
      </section>
    );
  }

  const revealed = pub.phase === 'reveal';
  const identification = pub.kind === 'identifier';
  return (
    <section className="pm-host fade-in">
      <div className="round-info">
        Question {pub.round} / {pub.total}
      </div>
      <h2 className="question-title">{pub.question}</h2>
      {identification && pub.image && (
        <figure className="tirage-image">
          <img src={pub.image} alt="Tableau à identifier" />
        </figure>
      )}
      {!revealed && (
        <>
          <TimerBar remaining={remaining} total={pub.guessSeconds * 1000} />
          {identification && pub.choices && (
            <ol className="tirage-choix" aria-label="Réponses possibles">
              {(pub.choices as string[]).map((texte) => (
                <li key={texte}>{texte}</li>
              ))}
            </ol>
          )}
          <p className="muted">
            {pub.answered} / {pub.playerCount} ont répondu
          </p>
        </>
      )}
      {revealed && pub.answer && !identification && (
        <p className="pm-answer">
          {pub.answer.valeur?.toLocaleString('fr-FR')} {pub.unit}
        </p>
      )}
      {revealed && pub.answer && identification && <p className="pm-answer">{pub.answer.reponse}</p>}
      {revealed && pub.answer && (
        <>
          <p className="pm-credit">Source : {pub.answer.source}</p>
          {pub.answer.credit && <p className="pm-credit">Crédit : {pub.answer.credit}</p>}
          <ul className="pm-results" aria-label="Réponses">
            {pub.placements.map(
              (p: { playerId: string; name: string; guess: number | null; choice: string | null; gained: number }) => (
                <li key={p.playerId}>
                  <span>{p.name}</span>
                  <span className="muted">
                    {identification
                      ? (p.choice ?? 'pas de réponse')
                      : p.guess === null
                        ? 'pas d’estimation'
                        : p.guess.toLocaleString('fr-FR')}
                  </span>
                  <span className="pm-gain">+{p.gained}</span>
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </section>
  );
}
