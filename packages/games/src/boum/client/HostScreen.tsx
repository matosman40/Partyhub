import type { CSSProperties } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Avatar, FinalHost, LETTERS, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';
import { CountryMap } from './CountryMap.js';

/** Écran principal de BOUM ! : annonce, saisie, vote, notation et révélation de chaque manche. */
export function BoumHost({ publicState: pub, hostState: host, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') return <WaitingScreen title="En attente du lancement…" />;

  const pending: string[] = host?.pending ?? [];
  const mode = pub.mode;
  const header = `Manche ${pub.index + 1} / ${pub.total}`;
  const style = { '--mode': mode?.color } as CSSProperties;
  const key = `${pub.phase}-${pub.index}`;

  if (pub.phase === 'announce') {
    return (
      <section className="game-host boum-host fade-in" key={key} style={style} data-effects={pub.effects}>
        <div className="round-info">{header}</div>
        <h2 className="huge-word">{mode?.title}</h2>
        <p className="muted">{mode?.brief}</p>
      </section>
    );
  }

  if (pub.phase === 'write') {
    const kind = mode?.kind;
    const counter =
      kind === 'pays'
        ? `${pub.picked} choix`
        : kind === 'reponse'
          ? `${pub.found} trouvée(s) · ${pub.written} réponse(s)`
          : kind === 'mime'
            ? `${pub.found} trouvé(s)`
            : kind === 'chanson'
              ? pub.clip
                ? `${pub.found} trouvé(s)`
                : 'Extrait en attente'
              : kind === 'chiffre'
                ? `${pub.guessed} estimation(s)`
                : kind === 'carte_vote'
                  ? `${pub.played} carte(s) jouée(s)`
                  : kind === 'mot_secret'
                    ? `${pub.written} indice(s)`
                    : `${pub.written} texte(s) envoyé(s)`;
    return (
      <section className="game-host boum-host fade-in" key={key} style={style} data-effects={pub.effects}>
        <div className="round-info">
          {header} · {mode?.title}
        </div>
        {pub.prompt && <p className="label">{pub.prompt.label}</p>}
        {pub.prompt && <h2 className="huge-word small">{pub.prompt.text}</h2>}
        {kind === 'carte_vote' && <p className="muted">Chacun joue une carte sur son téléphone.</p>}
        {kind === 'detecteur' && pub.pleader && <p className="muted">{pub.pleader} se défend.</p>}
        {kind === 'mot_secret' && pub.pleader && (
          <>
            <p className="label">{pub.pleader} devine le mot</p>
            <ul className="boum-clues">
              {(pub.clues ?? []).map((clue: string, i: number) => (
                <li key={i} className="huge-word small">
                  {clue}
                </li>
              ))}
            </ul>
          </>
        )}
        {kind === 'chanson' && pub.pleader && !pub.clip && (
          <>
            <p className="label">{pub.pleader} chante</p>
            <h2 className="huge-word small">Écoutez son extrait</h2>
            <p className="muted">Il enregistre 3 secondes sur son téléphone, sans musique.</p>
          </>
        )}
        {kind === 'chanson' && pub.clip && <audio className="boum-clip" src={pub.clip} controls autoPlay />}
        {kind === 'mime' && pub.pleader && (
          <>
            <p className="label">Mime le métier</p>
            <h2 className="huge-word small">{pub.pleader}</h2>
            <p className="muted">Pas un mot : les autres tapent le métier sur leur téléphone.</p>
          </>
        )}
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {counter}
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  if (pub.phase === 'vote') {
    const isPlayerVote = mode?.kind === 'vote_joueur';
    return (
      <section className="game-host boum-host fade-in" key={key} style={style} data-effects={pub.effects}>
        <div className="round-info">
          {header} · {mode?.title} · Vote anonyme
        </div>
        {pub.prompt && <h2 className="huge-word small">{pub.prompt.text}</h2>}
        <p className="label">
          {isPlayerVote ? 'Votez pour le joueur le plus probable' : 'Votez pour la meilleure réponse'}
        </p>
        <ol className="option-grid">
          {pub.options.map((o: { id: string; label: string }, i: number) => (
            <li key={o.id} className="option-card">
              <span className="letter">{LETTERS[i]}</span>
              <span className="option-word">{o.label}</span>
            </li>
          ))}
        </ol>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.voted} vote(s)
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  if (pub.phase === 'rate') {
    return (
      <section className="game-host boum-host fade-in" key={key} style={style} data-effects={pub.effects}>
        <div className="round-info">{header} · Mauvaise foi</div>
        <p className="label">{pub.pleader} affirme :</p>
        <h2 className="huge-word small">« {pub.excuse} »</h2>
        <p className="muted">Notez la défense de 1 à 5 étoiles sur votre téléphone.</p>
        <TimerBar remaining={remaining} total={pub.durationMs} />
        <p className="muted">
          {pub.rated} note(s)
          {pending.length > 0 && <> · En attente : {pending.join(', ')}</>}
        </p>
      </section>
    );
  }

  // Révélation
  const reveal = pub.reveal;
  return (
    <section className="game-host boum-host fade-in" key={key} style={style} data-effects={pub.effects}>
      <div className="round-info">
        {header} · {mode?.title} · Résultats
      </div>
      {pub.prompt && <h2 className="huge-word small">{pub.prompt.text}</h2>}
      {reveal?.kind === 'reponse' && (
        <>
          <p className="label">Réponse</p>
          <h3 className="reveal-answer">{reveal.answer}</h3>
          <ol className="ranking">
            {reveal.order.map((r: { name: string; gained: number }, i: number) => (
              <li key={r.name}>
                <span className="rank">{i + 1}</span>
                <Avatar name={r.name} size="sm" />
                <span className="name">{r.name}</span>
                <span className="points">+{r.gained}</span>
              </li>
            ))}
          </ol>
          {reveal.misses.length > 0 && <p className="muted">Pas trouvé : {reveal.misses.join(', ')}</p>}
        </>
      )}
      {reveal?.kind === 'pays' && (
        <>
          <p className="label">Le pays était</p>
          <h3 className="reveal-answer">{reveal.answerName}</h3>
          <CountryMap
            answer={reveal.answer}
            picks={reveal.guesses.map((g: { code: string; countryName: string }) => ({
              code: g.code,
              name: g.countryName,
            }))}
          />
          <ol className="ranking">
            {reveal.guesses.map(
              (g: { name: string; countryName: string; km: number | null; gained: number }, i: number) => (
                <li key={g.name}>
                  <span className="rank">{i + 1}</span>
                  <Avatar name={g.name} size="sm" />
                  <span className="name">
                    {g.name} : {g.countryName}
                    {g.km !== null && <span className="muted small"> · {g.km} km</span>}
                  </span>
                  <span className="points">+{g.gained}</span>
                </li>
              ),
            )}
          </ol>
          {reveal.misses.length > 0 && <p className="muted">Pas choisi : {reveal.misses.join(', ')}</p>}
        </>
      )}
      {reveal?.kind === 'mot_secret' && (
        <>
          <p className="label">Le mot était</p>
          <h3 className="reveal-answer">{reveal.word}</h3>
          <p className="muted">
            {reveal.found
              ? `Trouvé par ${reveal.guesser}, +${reveal.gainedGuesser}`
              : `${reveal.guesser ?? '?'} n’a pas trouvé`}
          </p>
          <ol className="ranking">
            {reveal.clues.map((c: { name: string; text: string; gained: number }, i: number) => (
              <li key={i}>
                <span className="rank">{i + 1}</span>
                <Avatar name={c.name} size="sm" />
                <span className="name">
                  {c.name} : « {c.text} »
                </span>
                <span className="points">+{c.gained}</span>
              </li>
            ))}
          </ol>
          {reveal.misses.length > 0 && <p className="muted">Pas d’indice : {reveal.misses.join(', ')}</p>}
        </>
      )}
      {reveal?.kind === 'chanson' && (
        <>
          <p className="label">L’artiste ou le film était</p>
          <h3 className="reveal-answer">{reveal.answer}</h3>
          <p className="muted">
            « {reveal.title} » chantée par {reveal.singer ?? '?'}, +{reveal.gainedSinger}
          </p>
          <ol className="ranking">
            {reveal.order.map((r: { name: string; gained: number }, i: number) => (
              <li key={r.name}>
                <span className="rank">{i + 1}</span>
                <Avatar name={r.name} size="sm" />
                <span className="name">{r.name}</span>
                <span className="points">+{r.gained}</span>
              </li>
            ))}
          </ol>
          {reveal.misses.length > 0 && <p className="muted">Pas trouvé : {reveal.misses.join(', ')}</p>}
        </>
      )}
      {reveal?.kind === 'mime' && (
        <>
          <p className="label">Le métier était</p>
          <h3 className="reveal-answer">{reveal.word}</h3>
          <p className="muted">
            Mimé par {reveal.mimer}, +{reveal.gainedMimer}
          </p>
          <ol className="ranking">
            {reveal.order.map((r: { name: string; gained: number }, i: number) => (
              <li key={r.name}>
                <span className="rank">{i + 1}</span>
                <Avatar name={r.name} size="sm" />
                <span className="name">{r.name}</span>
                <span className="points">+{r.gained}</span>
              </li>
            ))}
          </ol>
          {reveal.misses.length > 0 && <p className="muted">Pas trouvé : {reveal.misses.join(', ')}</p>}
        </>
      )}
      {reveal?.kind === 'chiffre' && (
        <>
          <p className="label">La réponse était</p>
          <h3 className="reveal-answer">{reveal.answer}</h3>
          <ol className="ranking">
            {reveal.guesses.map((g: { name: string; value: number; gained: number }) => (
              <li key={g.name}>
                <span className="rank">{g.value}</span>
                <Avatar name={g.name} size="sm" />
                <span className="name">{g.name}</span>
                <span className="points">+{g.gained}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {reveal?.kind === 'vote_joueur' && (
        <ol className="ranking">
          {reveal.results.map((r: { name: string; votes: number; gained: number }) => (
            <li key={r.name}>
              <Avatar name={r.name} size="sm" />
              <span className="name">{r.name}</span>
              <span className="points">
                {r.votes} vote(s) · +{r.gained}
              </span>
            </li>
          ))}
        </ol>
      )}
      {reveal?.kind === 'detecteur' && (
        <>
          <p className="label">{reveal.pleader} affirmait :</p>
          <h3 className="reveal-answer">« {reveal.excuse} »</h3>
          <p className="muted">
            {reveal.average === null ? 'Personne n’a noté.' : `Note moyenne : ${reveal.average} / 5`} · +{reveal.gained}
          </p>
        </>
      )}
      {reveal?.kind === 'texte' && (
        <ol className="option-grid revealed">
          {reveal.results.map((r: { text: string; author: string; votes: number; gained: number }, i: number) => (
            <li key={i} className={`option-card${r.votes > 0 && r.votes === reveal.results[0]?.votes ? ' top' : ''}`}>
              <span className="option-word">{r.text}</span>
              <span className="author">
                <Avatar name={r.author} size="sm" />
                {r.author}
              </span>
              <span className="option-score">
                {r.votes} vote(s) · +{r.gained}
              </span>
            </li>
          ))}
        </ol>
      )}
      <h3>Classement</h3>
      <Ranking entries={pub.ranking} limit={6} />
    </section>
  );
}
