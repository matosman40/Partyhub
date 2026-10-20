import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, LETTERS, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';

const VERDICT_LABEL: Record<string, string> = {
  acquittee: 'Acquittée',
  condamnee: 'Condamnée',
};

export function TribunalHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Le tribunal se réunit…" text="La partie va commencer sur cet écran." />;
  }

  const pending: string[] = host?.pending ?? [];
  const docket = (
    <header className="tribunal-docket">
      <p className="label">
        Affaire {pub.round + 1} / {pub.total} · {pub.modeLabel}
      </p>
      <h2 className="tribunal-case">{pub.situation}</h2>
      <p className="muted">{pub.hint}</p>
    </header>
  );

  if (pub.phase === 'write') {
    return (
      <section className="game-host tribunal fade-in" key={`w-${pub.round}`}>
        {docket}
        <p className="muted">Chacun écrit sa défense sur son téléphone.</p>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.writtenCount} / {pub.playerCount} défense(s) écrite(s)
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  if (pub.phase === 'vote') {
    return (
      <section className="game-host tribunal fade-in" key={`v-${pub.round}`}>
        {docket}
        <p className="label">Le jury vote pour la meilleure défense</p>
        <ol className="option-grid">
          {pub.options.map((defense: string, i: number) => (
            <li key={i} className="option-card defense-card">
              <span className="letter">{LETTERS[i]}</span>
              <span className="option-word">{defense}</span>
            </li>
          ))}
        </ol>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.voteCount} / {pub.playerCount} vote(s)
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // reveal : auteurs, votes et verdicts.
  return (
    <section className="game-host tribunal fade-in" key={`r-${pub.round}`}>
      {docket}
      <ol className="option-grid revealed">
        {pub.results.map(
          (
            r: { defense: string; author: string; votes: number; gained: number; verdict: string | null },
            i: number,
          ) => (
            <li key={i} className={`option-card defense-card${r.verdict === 'acquittee' ? ' top' : ''}`}>
              <span className="option-word">{r.defense}</span>
              <span className="author">{r.author}</span>
              {r.verdict && <span className={`verdict-badge ${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span>}
              <span className="option-score">
                {r.votes} vote{r.votes > 1 ? 's' : ''} · +{r.gained}
              </span>
            </li>
          ),
        )}
      </ol>
      {pub.results.length === 0 && <p className="muted">Pas assez de défenses pour un verdict.</p>}
      <h3>Classement</h3>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
