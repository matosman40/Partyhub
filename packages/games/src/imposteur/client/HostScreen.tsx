import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';

interface Clue {
  playerId: string;
  name: string;
  text: string;
}

function ClueList({ clues }: { clues: Clue[] }) {
  if (clues.length === 0) return <p className="muted">Les indices apparaîtront ici…</p>;
  return (
    <ul className="clue-list">
      {clues.map((c) => (
        <li key={c.playerId}>
          <span className="clue-author">{c.name}</span>
          <span className="clue-text">« {c.text} »</span>
        </li>
      ))}
    </ul>
  );
}

export function ImposteurHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;

  const pending: string[] = host?.pending ?? [];
  const clues: Clue[] = pub.clues ?? [];

  if (pub.phase === 'clues' || pub.phase === 'vote') {
    const isClues = pub.phase === 'clues';
    return (
      <section className="game-host fade-in" key={`${pub.phase}-${pub.round}`}>
        <div className="round-info">
          Manche {pub.round + 1} / {pub.total}
        </div>
        <p className="label">Catégorie</p>
        <h2 className="huge-word small">{pub.category}</h2>
        <p className="muted">
          {isClues
            ? 'Chacun donne un indice sur le mot secret. Un imposteur se cache parmi vous !'
            : 'Qui est l’imposteur ? Votez en secret sur votre téléphone.'}
        </p>
        <ClueList clues={clues} />
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {isClues
            ? `${pub.clueCount} / ${pub.playerCount} indice(s)`
            : `${pub.voteCount} / ${pub.playerCount} vote(s)`}
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  if (pub.phase === 'guess') {
    return (
      <section className="game-host fade-in" key={`g-${pub.round}`}>
        <div className="round-info">
          Manche {pub.round + 1} / {pub.total}
        </div>
        <h2 className="huge-word small">{pub.accusedName} est démasqué !</h2>
        <p className="muted">
          {host?.guessing
            ? `${host.guessing} tente de deviner le mot secret…`
            : 'L’imposteur tente de deviner le mot secret…'}
        </p>
        <TimerBar remaining={remaining} total={pub.durationMs} />
      </section>
    );
  }

  // reveal
  return (
    <section className="game-host fade-in" key={`r-${pub.round}`}>
      <div className="round-info">
        Manche {pub.round + 1} / {pub.total} · Révélation
      </div>
      <p className="label">Le mot était</p>
      <h2 className="huge-word small">{pub.word}</h2>
      <p className={`verdict-host ${pub.caught ? 'ok' : 'ko'}`}>
        {pub.caught
          ? `${pub.impostorName} était l’imposteur${pub.guessed ? ' — et a deviné le mot !' : ' — démasqué !'}`
          : `${pub.impostorName} était l’imposteur — il a échappé au groupe !`}
      </p>
      <ul className="results">
        {pub.tally.map((t: { name: string; votes: number }) => (
          <li key={t.name}>
            <span className="name">{t.name}</span>
            <span className="points">{t.votes} voix</span>
          </li>
        ))}
      </ul>
      <h3>Classement</h3>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
