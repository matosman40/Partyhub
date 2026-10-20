import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, LETTERS, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';

export function ImposteurPartageHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="En attente du lancement…" text="Les rôles seront distribués sur les téléphones." />;
  }

  const pending: string[] = host?.pending ?? [];
  const header = (
    <header className="imposteur-header">
      <p className="label">
        Manche {pub.round + 1} / {pub.total} · {pub.modeLabel}
      </p>
      <h2 className="imposteur-category">Catégorie : {pub.category}</h2>
      <p className="muted">{pub.modeHint}</p>
    </header>
  );

  if (pub.phase === 'role') {
    return (
      <section className="game-host imposteur fade-in" key={`r-${pub.round}`}>
        {header}
        <p>Regardez votre téléphone : chacun découvre son rôle en privé.</p>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.ackCount} / {pub.playerCount} rôle(s) lu(s)
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  if (pub.phase === 'clue') {
    return (
      <section className="game-host imposteur fade-in" key={`c-${pub.round}`}>
        {header}
        <p>Chacun dit une phrase à voix haute, sans trahir le mot. Tapez-la sur votre téléphone.</p>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.clueCount} / {pub.playerCount} phrase(s)
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  if (pub.phase === 'vote' || pub.phase === 'guess') {
    return (
      <section className="game-host imposteur fade-in" key={`${pub.phase}-${pub.round}`}>
        {header}
        <ol className="clue-list">
          {pub.clues.map((c: { name: string; text: string }, i: number) => (
            <li key={i} className="clue-item">
              <span className="letter">{LETTERS[i]}</span>
              <span className="clue-author">{c.name}</span>
              <span className="clue-text">« {c.text} »</span>
            </li>
          ))}
        </ol>
        {pub.phase === 'vote' ? (
          <>
            <p className="label">Qui est l’imposteur ?</p>
            <TimerBar remaining={remaining} total={pub.durationMs} />
            <p className="muted">
              {pub.voteCount} / {pub.playerCount} vote(s)
              {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
            </p>
          </>
        ) : (
          <>
            <p className="label">
              {pub.ejectedName ? `${pub.ejectedName} est démasqué !` : 'Personne n’est démasqué.'}
            </p>
            {pub.ejectedName && <p>Il tente de deviner le mot de l’équipe.</p>}
            <TimerBar remaining={remaining} total={pub.durationMs} />
          </>
        )}
      </section>
    );
  }

  // result : le mot, l’imposteur, les votes.
  const impostorWon = pub.outcome === 'imposteur';
  return (
    <section className="game-host imposteur fade-in" key={`res-${pub.round}`}>
      {header}
      <p className="label">Le mot était</p>
      <h2 className="huge-word small">{pub.word}</h2>
      <p className={`imposteur-verdict ${impostorWon ? 'imposteur' : 'equipe'}`}>
        {impostorWon ? `${pub.impostorName} gagne !` : 'L’équipe gagne !'}
      </p>
      <p className="muted">
        Imposteur : {pub.impostorName}
        {pub.ejectedName ? ` · Démasqué : ${pub.ejectedName}` : ' · Personne n’a été démasqué'}
        {pub.guessText && <> · Tentative : « {pub.guessText} »</>}
      </p>
      {pub.votes.length > 0 && (
        <ul className="vote-list">
          {pub.votes.map((v: { voter: string; target: string }, i: number) => (
            <li key={i}>
              {v.voter} → {v.target}
            </li>
          ))}
        </ul>
      )}
      <h3>Classement</h3>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
