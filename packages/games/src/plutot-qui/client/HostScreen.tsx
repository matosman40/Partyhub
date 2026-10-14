import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, FinalHost, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';

export function PlutotQuiHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;

  if (pub.phase === 'vote') {
    const pending: string[] = host?.pending ?? [];
    return (
      <section className="game-host fade-in" key={`v-${pub.round}`}>
        <div className="round-info">Question {pub.round + 1} / {pub.total}</div>
        <p className="label">Plutôt qui ?</p>
        <h2 className="huge-word">{pub.prompt}</h2>
        <p className="muted">Votez en secret sur votre téléphone. Suivez la majorité pour marquer !</p>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.voteCount} / {pub.candidates.length} ont voté
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // reveal
  return (
    <section className="game-host fade-in" key={`r-${pub.round}`}>
      <div className="round-info">Question {pub.round + 1} / {pub.total} · Résultats</div>
      <h2 className="huge-word small">{pub.prompt}</h2>
      <ol className="tally">
        {pub.tally.map((t: { playerId: string; name: string; votes: number; voters: string[] }) => (
          <li key={t.playerId} className={pub.winners.includes(t.name) && t.votes > 0 ? 'top' : undefined}>
            <Avatar name={t.name} />
            <span className="tally-name">{t.name}</span>
            <span className="tally-bar" style={{ width: `${Math.min(100, t.votes * 25)}%` }} />
            <span className="tally-count">
              {t.votes} vote{t.votes > 1 ? 's' : ''}
              {t.voters.length > 0 && <small> · {t.voters.join(', ')}</small>}
            </span>
          </li>
        ))}
      </ol>
      <h3>Classement</h3>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
