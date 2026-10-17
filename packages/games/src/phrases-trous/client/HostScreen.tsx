import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Ranking, TimerBar, LETTERS, type RankRow } from '../../client/ui.js';
import { KeywordTurnsBoard } from '../../common/client/keywords-ui.js';
import { BLANK } from '../rules.js';

/** Écran TV des phrases à trous : la phrase au centre, le trou qui se remplit, les votes, puis les points. */
export function PhrasesHost({ publicState: pub, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);

  if (!pub) return null;

  if (pub.phase === 'final') {
    const winners = pub.ranking.filter((e: RankRow) => e.rank === 1);
    return (
      <section className="phrases-host fade-in final">
        <h2 className="big-title">Classement final</h2>
        <p className="winner">
          {winners.length > 1 ? 'Ex æquo en tête : ' : 'Vainqueur : '}
          {winners.map((w: RankRow) => w.name).join(', ')} 🏆
        </p>
        <Ranking entries={pub.ranking} />
      </section>
    );
  }

  if (pub.phase === 'ready') return <p className="center big">En attente du lancement…</p>;

  if (pub.phase === 'topics' || pub.phase === 'generating') {
    return <KeywordTurnsBoard topics={pub.topics} remaining={remaining} generating={pub.phase === 'generating'} />;
  }

  const roundInfo = (
    <div className="round-info">
      Tour {pub.index + 1} / {pub.total}
    </div>
  );

  if (pub.phase === 'fill') {
    return (
      <section className="phrases-host fade-in" key={`f-${pub.index}`}>
        {roundInfo}
        <Sentence sentence={pub.sentence} />
        <TimerBar remaining={remaining} total={pub.limitMs || 1} />
        <ul className="roster" aria-label="Qui a posé sa carte">
          {(pub.played as string[]).map((name) => (
            <li key={`p-${name}`} className="answered">
              ✔ {name}
            </li>
          ))}
          {(pub.waiting as string[]).map((name) => (
            <li key={`w-${name}`} className="waiting">
              {name}…
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (pub.phase === 'vote') {
    return (
      <section className="phrases-host fade-in" key={`v-${pub.index}`}>
        {roundInfo}
        <h2 className="question-title">Quelle phrase vous fait le plus rire ?</h2>
        <ol className="phrase-options">
          {(pub.options as Array<{ text: string }>).map((o, i) => (
            <li key={i} className="phrase-option">
              <span className="letter">{LETTERS[i]}</span>
              <span className="phrase-text">{o.text}</span>
            </li>
          ))}
        </ol>
        <TimerBar remaining={remaining} total={pub.limitMs || 1} />
        <p className="muted">
          {pub.voted} / {pub.voters} ont voté
          {(pub.pending as string[]).length > 0 && <> · En attente : {(pub.pending as string[]).join(', ')}</>}
        </p>
      </section>
    );
  }

  // Révélation : auteurs, votes, points, et la réponse attendue.
  const options = pub.options as Array<{
    text: string;
    author: string;
    auto: boolean;
    votes: number;
    points: number;
    correct: boolean;
  }>;
  return (
    <section className="phrases-host fade-in" key={`r-${pub.index}`}>
      {roundInfo}
      <p className="explanation">
        Réponse attendue : <strong>{pub.answer}</strong>
      </p>
      <ol className="phrase-options">
        {options.map((o, i) => (
          <li key={i} className={`phrase-option ${o.correct ? 'correct' : ''}`}>
            <span className="letter">{LETTERS[i]}</span>
            <span className="phrase-text">{o.text}</span>
            <span className="phrase-meta">
              {o.author}
              {o.auto ? ' · au hasard' : ''} · {o.votes} vote{o.votes > 1 ? 's' : ''}
              {o.correct ? ' · bonne réponse' : ''} · +{o.points}
            </span>
          </li>
        ))}
      </ol>
      <div className="reveal-grid">
        <div>
          <h3>Classement</h3>
          <Ranking entries={pub.ranking} limit={6} />
        </div>
      </div>
    </section>
  );
}

/** Phrase avec son trou. Le trou reste vide tant que la carte n’est pas posée. */
function Sentence({ sentence }: { sentence: string }) {
  const parts = sentence.split(BLANK);
  return (
    <h2 className="question-title phrase-sentence">
      {parts[0]}
      <span className="hole" role="img" aria-label="Trou à compléter">
        {'      '}
      </span>
      {parts.slice(1).join(BLANK)}
    </h2>
  );
}
