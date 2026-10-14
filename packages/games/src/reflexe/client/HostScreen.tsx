import type { HostViewProps } from '../../client/types.js';
import { FinalHost, WaitingScreen } from '../../client/ui.js';

interface Result {
  playerId: string;
  name: string;
  reaction: number | null;
  falseStart: boolean;
  gained: number;
}

export function ReflexeHost({ publicState: pub, hostState: host }: HostViewProps) {
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;

  if (pub.phase === 'wait') {
    return (
      <section className="reflex-screen red fade-in" key={`w-${pub.round}`}>
        <p className="reflex-title">Manche {pub.round + 1} / {pub.total}</p>
        <p className="reflex-main">Attendez le vert…</p>
        <p className="reflex-sub">Ne touchez pas encore !</p>
      </section>
    );
  }

  if (pub.phase === 'go') {
    const pending: string[] = host?.pending ?? [];
    return (
      <section className="reflex-screen green fade-in" key={`g-${pub.round}`}>
        <p className="reflex-title">Manche {pub.round + 1} / {pub.total}</p>
        <p className="reflex-main">TOUCHEZ !</p>
        <p className="reflex-sub">
          {pub.responded} / {pub.playerCount} ont touché
          {pending.length > 0 && <> · Plus lent : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // reveal
  const results: Result[] = pub.results ?? [];
  return (
    <section className="game-host fade-in" key={`r-${pub.round}`}>
      <div className="round-info">Manche {pub.round + 1} / {pub.total} · Temps de réaction</div>
      <ol className="reaction-list">
        {results.map((r, i) => (
          <li key={r.playerId} className={r.reaction !== null && r.gained > 0 ? 'scored' : undefined}>
            <span className="rank">{r.reaction !== null ? i + 1 : '—'}</span>
            <span className="name">{r.name}</span>
            <span className="reaction-ms">
              {r.falseStart ? 'Faux départ' : r.reaction !== null ? `${Math.round(r.reaction)} ms` : 'Trop lent'}
            </span>
            <span className="points">{r.gained > 0 ? `+${r.gained}` : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
