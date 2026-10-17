import { useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { LETTERS } from '../../client/ui.js';
import { KeywordForm } from '../../common/client/keywords-ui.js';
import { BLANK } from '../rules.js';

/**
 * Téléphone des phrases à trous : on pose une carte de sa main dans le trou, puis on vote pour la phrase la plus
 * drôle (jamais la sienne). Les choix apparaissent tout de suite ; le serveur confirme ensuite.
 */
export function PhrasesPlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [picked, setPicked] = useState<{ index: number; card: string } | null>(null);
  const [voted, setVoted] = useState<{ index: number; option: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!pub) return null;

  if (pub.phase === 'final') {
    return (
      <section className="player-game fade-in">
        <h2>Partie terminée</h2>
        <p className="big-number">{me?.points ?? 0} pts</p>
        <p>Vous êtes {me?.rank ? `${me.rank}ᵉ` : '—'} du classement.</p>
        <p className="muted">Regardez l’écran principal pour le vainqueur.</p>
      </section>
    );
  }

  if (pub.phase === 'ready') {
    return (
      <section className="player-game fade-in">
        <p className="big">Préparez-vous !</p>
        <p className="muted">La partie va commencer, gardez les yeux sur l’écran principal.</p>
      </section>
    );
  }

  if (pub.phase === 'topics') {
    return (
      <KeywordForm
        myTurn={me?.myTurn === true}
        current={pub.topics?.current ?? null}
        remaining={remaining}
        send={send}
      />
    );
  }

  if (pub.phase === 'generating') {
    return (
      <section className="player-game fade-in">
        <p className="big">L’IA écrit vos phrases…</p>
        <p className="muted">Les mots-clés de chacun servent de thème. Regardez l’écran principal.</p>
      </section>
    );
  }

  const roundLabel = `Tour ${pub.index + 1} / ${pub.total}`;

  if (pub.phase === 'fill') {
    const played: string | null = me?.played ?? (picked && picked.index === pub.index ? picked.card : null);
    const hand: string[] = me?.hand ?? [];

    async function play(card: string) {
      if (played !== null || remaining <= 0) return;
      setError(null);
      setPicked({ index: pub.index, card });
      const res = await send('play', { card });
      if (!res.ok) {
        setPicked(null);
        setError(res.error ?? 'Carte refusée');
      }
    }

    return (
      <section className="player-game fade-in" key={`f-${pub.index}`}>
        <div className="round-info">
          {roundLabel} · {Math.ceil(remaining / 1000)} s
        </div>
        <p className="phrase-small">
          {(pub.sentence as string).split(BLANK)[0]}
          <span className="hole">{played ?? '______'}</span>
          {(pub.sentence as string).split(BLANK).slice(1).join(BLANK)}
        </p>
        {played !== null ? (
          <p className="notice">Carte posée ✔ · En attente des autres…</p>
        ) : (
          <>
            <p className="muted">Touchez une carte pour la poser dans le trou.</p>
            <div className="card-hand">
              {hand.map((card, i) => (
                <button
                  key={`${card}-${i}`}
                  type="button"
                  className="card-btn"
                  disabled={remaining <= 0}
                  aria-label={`Poser la carte ${card}`}
                  onClick={() => play(card)}
                >
                  {card}
                </button>
              ))}
            </div>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  if (pub.phase === 'vote') {
    const ownOption: number | null = me?.ownOption ?? null;
    const myVote: number | null = me?.myVote ?? (voted && voted.index === pub.index ? voted.option : null);

    async function vote(option: number) {
      if (myVote !== null || remaining <= 0) return;
      setError(null);
      setVoted({ index: pub.index, option });
      const res = await send('vote', { option });
      if (!res.ok) {
        setVoted(null);
        setError(res.error ?? 'Vote refusé');
      }
    }

    return (
      <section className="player-game fade-in" key={`v-${pub.index}`}>
        <div className="round-info">
          {roundLabel} · {Math.ceil(remaining / 1000)} s
        </div>
        <h2 className="question-small">Votez pour la phrase la plus drôle</h2>
        <div className="choices-stack">
          {(pub.options as Array<{ text: string }>).map((o, i) => (
            <button
              key={i}
              type="button"
              className={`choice-btn ${myVote === i ? 'selected' : ''}`}
              disabled={myVote !== null || ownOption === i || remaining <= 0}
              onClick={() => vote(i)}
            >
              <span className="letter">{LETTERS[i]}</span>
              {o.text}
              {ownOption === i && <span className="muted"> (la vôtre)</span>}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {myVote !== null ? (
          <p className="notice">Vote envoyé ✔</p>
        ) : ownOption !== null ? (
          <p className="muted">Votre phrase ne peut pas recevoir votre vote.</p>
        ) : (
          <p className="muted">Vous n’avez pas posé de carte : votez pour la plus drôle.</p>
        )}
      </section>
    );
  }

  // Révélation : le résultat de la manche.
  const correct = me?.correct === true;
  const gained = me?.gained ?? 0;
  return (
    <section className="player-game fade-in" key={`r-${pub.index}`}>
      <p className={`verdict ${correct ? 'ok' : 'ko'}`}>
        {me?.played == null
          ? 'Pas de carte posée'
          : correct
            ? 'Votre carte complétait juste le trou !'
            : 'Votre carte ne complétait pas le trou.'}
      </p>
      {me?.auto && <p className="muted">Carte choisie au hasard, faute de temps.</p>}
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p>
        Votes reçus : {me?.votesReceived ?? 0} · Total : {me?.points ?? 0} pts
        {me?.rank ? ` · ${me.rank}ᵉ` : ''}
      </p>
    </section>
  );
}
