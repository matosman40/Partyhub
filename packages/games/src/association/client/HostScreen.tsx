import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, FinalHost, LETTERS, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';

export function AssociationHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;

  const pending: string[] = host?.pending ?? [];

  if (pub.phase === 'write') {
    return (
      <section className="game-host fade-in" key={`w-${pub.round}`}>
        <div className="round-info">Manche {pub.round + 1} / {pub.total}</div>
        <p className="label">Le mot de la manche</p>
        <h2 className="huge-word">{pub.prompt}</h2>
        <p className="muted">Écrivez le premier mot qui vous vient à l’esprit, sur votre téléphone.</p>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.writtenCount} / {pub.playerCount} mot(s) envoyé(s)
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  if (pub.phase === 'vote') {
    return (
      <section className="game-host fade-in" key={`v-${pub.round}`}>
        <div className="round-info">Manche {pub.round + 1} / {pub.total} · Vote anonyme</div>
        <h2 className="huge-word small">{pub.prompt}</h2>
        <p className="label">Votez pour le mot le plus drôle</p>
        <ol className="option-grid">
          {pub.options.map((word: string, i: number) => (
            <li key={i} className="option-card">
              <span className="letter">{LETTERS[i]}</span>
              <span className="option-word">{word}</span>
            </li>
          ))}
        </ol>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.voteCount} / {pub.playerCount} ont voté
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // reveal
  const top = Math.max(0, ...pub.results.map((r: { votes: number }) => r.votes));
  return (
    <section className="game-host fade-in" key={`r-${pub.round}`}>
      <div className="round-info">Manche {pub.round + 1} / {pub.total} · Résultats</div>
      <h2 className="huge-word small">{pub.prompt}</h2>
      <ol className="option-grid revealed">
        {pub.results.map(
          (r: { word: string; author: string; votes: number; gained: number }, i: number) => (
            <li key={i} className={`option-card${r.votes > 0 && r.votes === top ? ' top' : ''}`}>
              <span className="option-word">{r.word}</span>
              <span className="author">
                <Avatar name={r.author} size="sm" />
                {r.author}
              </span>
              <span className="option-score">
                {r.votes} vote{r.votes > 1 ? 's' : ''} · +{r.gained}
              </span>
            </li>
          ),
        )}
      </ol>
      {pub.results.length === 0 && <p className="muted">Pas assez de mots pour voter cette fois.</p>}
      <h3>Classement</h3>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
