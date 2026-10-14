import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, PlayingCard, TimerBar, WaitingScreen } from '../../client/ui.js';

interface Pick {
  playerId: string;
  name: string;
  bet: 'higher' | 'lower' | null;
  correct: boolean | null;
  gained: number;
}

const BET_LABEL = { higher: '▲ plus haut', lower: '▼ plus bas' } as const;

export function PlusOuMoinsHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;

  if (pub.phase === 'bet') {
    const pending: string[] = host?.pending ?? [];
    return (
      <section className="game-host fade-in" key={`b-${pub.round}`}>
        <div className="round-info">
          Carte {pub.round + 1} / {pub.total}
        </div>
        <p className="label">La carte est…</p>
        <div className="card-table">
          <PlayingCard card={pub.current} />
        </div>
        <h2 className="huge-word small">La suivante sera-t-elle plus haute ou plus basse ?</h2>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.betCount} / {pub.playerCount} pari(s)
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // reveal
  const picks: Pick[] = pub.picks ?? [];
  return (
    <section className="game-host fade-in" key={`r-${pub.round}`}>
      <div className="round-info">
        Carte {pub.round + 1} / {pub.total} · Résultat
      </div>
      <div className="card-table duo">
        <PlayingCard card={pub.current} label="Carte de départ" />
        <span className="vs">→</span>
        <PlayingCard card={pub.revealed} label="Carte suivante" />
      </div>
      <ul className="picks">
        {picks.map((p) => (
          <li key={p.playerId} className={p.correct === true ? 'ok' : p.correct === false ? 'ko' : undefined}>
            <span className="name">{p.name}</span>
            <span className="bet">{p.bet ? BET_LABEL[p.bet] : 'pas de pari'}</span>
            <span className="points">{p.correct === null ? 'égalité' : `+${p.gained}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
