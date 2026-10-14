import { useMemo } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { MoodsContext } from '../../client/avatar-context.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, LETTERS, Ranking, TimerBar, type RankRow } from '../../client/ui.js';
import { quizMoods } from './moods.js';

/** Écran TV du quiz : les personnages réagissent à la phase (salut, joie, tristesse, danse). */
export function QuizHost(props: HostViewProps) {
  const pub = props.publicState;
  const host = props.hostState;
  const moods = useMemo(() => (pub ? quizMoods(pub, host?.pending ?? []) : {}), [pub, host]);
  return (
    <MoodsContext.Provider value={moods}>
      <QuizBoard {...props} />
    </MoodsContext.Provider>
  );
}

function QuizBoard({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.answerEndsAt, now);

  if (!pub) return null;

  if (pub.phase === 'final') {
    const winners = pub.ranking.filter((e: RankRow) => e.rank === 1);
    return (
      <section className="quiz-host fade-in final">
        <h2 className="big-title">Classement final</h2>
        <p className="winner">
          {winners.length > 1 ? 'Ex æquo en tête : ' : 'Vainqueur : '}
          {winners.map((w: RankRow) => w.name).join(', ')} 🏆
        </p>
        <Ranking entries={pub.ranking} />
      </section>
    );
  }

  if (pub.phase === 'ready') {
    return <p className="center big">En attente du lancement…</p>;
  }

  const q = pub.question;
  if (!q) return null;

  if (pub.phase === 'question') {
    const total = pub.answerMs || 1;
    const pending: string[] = host?.pending ?? [];
    return (
      <section className="quiz-host fade-in" key={`q-${pub.index}`}>
        <div className="round-info">
          Question {pub.index + 1} / {pub.total} · <span className="tag">{q.category}</span>
        </div>
        <h2 className="question-title">{q.text}</h2>
        <ol className="choices-grid">
          {q.choices.map((c: string, i: number) => (
            <li key={i} className="choice">
              <span className="letter">{LETTERS[i]}</span>
              <span>{c}</span>
            </li>
          ))}
        </ol>
        <TimerBar remaining={remaining} total={total} />
        <ul className="answer-roster" aria-label="Qui a répondu">
          {pub.ranking.map((e: RankRow) => (
            <li key={e.playerId} className={pending.includes(e.name) ? 'waiting' : 'answered'}>
              <Avatar name={e.name} size="md" />
              <span className="name">{e.name}</span>
            </li>
          ))}
        </ul>
        <p className="muted">
          {Math.ceil(remaining / 1000)} s · {pub.answeredCount} / {pub.playerCount} ont répondu
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // reveal
  const maxCount = Math.max(1, ...(pub.counts as number[]));
  return (
    <section className="quiz-host fade-in" key={`r-${pub.index}`}>
      <div className="round-info">
        Question {pub.index + 1} / {pub.total} · <span className="tag">{q.category}</span>
      </div>
      <h2 className="question-title">{q.text}</h2>
      <ol className="choices-grid">
        {q.choices.map((c: string, i: number) => {
          const isAnswer = i === pub.answer;
          return (
            <li key={i} className={`choice ${isAnswer ? 'correct' : 'dim'}`}>
              <span className="letter">{LETTERS[i]}</span>
              <span className="choice-label">{c}</span>
              <span className="bar" style={{ width: `${(pub.counts[i] / maxCount) * 100}%` }} />
              <span className="count">{pub.counts[i]}</span>
            </li>
          );
        })}
      </ol>
      {host?.explanation && <p className="explanation">💡 {host.explanation}</p>}
      <div className="reveal-grid">
        <div>
          <h3>Résultats de la question</h3>
          <ul className="results">
            {pub.results.map((r: { playerId: string; name: string; correct: boolean; gained: number }) => (
              <li key={r.playerId} className={r.correct ? 'ok' : 'ko'}>
                <span>{r.correct ? '✔' : '✘'}</span>
                <Avatar name={r.name} size="md" />
                <span className="name">{r.name}</span>
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
