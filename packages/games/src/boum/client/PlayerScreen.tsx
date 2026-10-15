import { useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, FinalScreen, WaitingScreen } from '../../client/ui.js';
import { COUNTRY_CODES } from '../bank/countries.js';
import { COUNTRY_NAMES_FR } from '../geo/countries-data.js';
import { SoundRecorder } from '../../imite-moi/client/Capture.js';

/** Pays proposés au téléphone, triés par nom français. */
const COUNTRY_OPTIONS: [string, string][] = COUNTRY_CODES.map(
  (code) => [code, COUNTRY_NAMES_FR[code] ?? code] as [string, string],
).sort((a, b) => a[1].localeCompare(b[1], 'fr'));

/** Téléphone de BOUM ! : une seule action attendue par manche, selon le mode. */
export function BoumPlayer({ publicState: pub, playerState: me, playerId, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [text, setText] = useState('');
  const [number, setNumber] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  const kind: string | undefined = pub.mode?.kind;
  const title = pub.mode?.title ?? '';

  async function run(type: string, payload: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Action refusée');
  }

  const notice = error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;

  if (pub.phase === 'announce') {
    return <WaitingScreen title={title} text={pub.mode?.brief} />;
  }

  if (pub.phase === 'write') {
    if (kind === 'mot_secret' && me?.isPleader) {
      const clues: string[] = pub.clues ?? [];
      return (
        <section className="player-game fade-in">
          <div className="round-info">
            {title} · <Countdown remaining={remaining} />
          </div>
          <p className="label">Votre mot secret : faites-le deviner</p>
          <h2 className="question-small">{me.secretWord}</h2>
          {clues.length > 0 && (
            <ul className="boum-clues">
              {clues.map((clue, i) => (
                <li key={i}>{clue}</li>
              ))}
            </ul>
          )}
          <form
            className="stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const value = text.trim();
              if (!value) return;
              setText('');
              void run('answer', { text: value });
            }}
          >
            <label className="field big-field">
              <span>Votre proposition</span>
              <input
                value={text}
                maxLength={25}
                autoComplete="off"
                autoFocus
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary big" disabled={busy || !text.trim() || remaining <= 0}>
              Deviner
            </button>
          </form>
          {notice}
        </section>
      );
    }
    if (kind === 'chanson' && me?.secretWord) {
      return (
        <section className="player-game fade-in">
          <div className="round-info">
            {title} · <Countdown remaining={remaining} />
          </div>
          <p className="label">Chantez cet extrait, sans musique</p>
          <h2 className="question-small">{me.secretWord}</h2>
          {pub.clip ? (
            <p className="muted">Extrait envoyé. Les autres cherchent l’artiste ou le film.</p>
          ) : (
            <SoundRecorder busy={busy} onSubmit={(dataUrl) => void run('clip', { dataUrl })} />
          )}
          {notice}
        </section>
      );
    }
    if (kind === 'chanson' && !me?.secretWord && !pub.clip) {
      return <WaitingScreen title="Écoutez" text="Le chanteur prépare son extrait. Regardez l’écran principal." />;
    }
    if (kind === 'mime' && me?.secretWord) {
      return (
        <section className="player-game fade-in">
          <div className="round-info">
            {title} · <Countdown remaining={remaining} />
          </div>
          <p className="label">Mimez ce métier, sans parler</p>
          <h2 className="question-small">{me.secretWord}</h2>
          {notice}
        </section>
      );
    }
    if (me?.mustAct === false) {
      return <WaitingScreen title="Envoyé ✔" text="En attente des autres… Regardez l’écran principal." />;
    }

    const promptText = pub.prompt?.text ?? '';

    if (kind === 'pays') {
      return (
        <section className="player-game fade-in">
          <div className="round-info">
            {title} · <Countdown remaining={remaining} />
          </div>
          <h2 className="question-small">{promptText}</h2>
          <form
            className="stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!country) return;
              void run('country', { code: country });
            }}
          >
            <label className="field big-field">
              <span>Votre pays</span>
              <select value={country} onChange={(e) => setCountry(e.target.value)} autoFocus>
                <option value="">Choisissez un pays</option>
                {COUNTRY_OPTIONS.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn primary big" disabled={busy || !country || remaining <= 0}>
              Valider ce pays
            </button>
          </form>
          {notice}
        </section>
      );
    }

    if (kind === 'reponse' || kind === 'mime' || kind === 'chanson' || kind === 'mot_secret') {
      return (
        <section className="player-game fade-in">
          <div className="round-info">
            {title} · <Countdown remaining={remaining} />
          </div>
          <h2 className="question-small">
            {kind === 'mot_secret'
              ? 'Donnez un indice d’un seul mot, sans dire le mot'
              : kind === 'mime'
                ? `${pub.pleader ?? 'Quelqu’un'} mime le métier`
                : kind === 'chanson'
                  ? `${pub.pleader ?? 'Quelqu’un'} chante : artiste ou film ?`
                  : promptText}
          </h2>
          <form
            className="stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const value = text.trim();
              if (!value) return;
              setText('');
              void run('answer', { text: value });
            }}
          >
            <label className="field big-field">
              <span>{kind === 'mot_secret' ? 'Votre indice' : 'Votre réponse'}</span>
              <input
                value={text}
                maxLength={25}
                autoComplete="off"
                autoFocus
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary big" disabled={busy || !text.trim() || remaining <= 0}>
              Envoyer
            </button>
          </form>
          {notice}
        </section>
      );
    }

    if (kind === 'chiffre') {
      return (
        <section className="player-game fade-in">
          <div className="round-info">
            {title} · <Countdown remaining={remaining} />
          </div>
          <h2 className="question-small">{promptText}</h2>
          <form
            className="stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const value = Number(number);
              if (!Number.isInteger(value) || value < 0) {
                setError('Entrez un nombre entier positif');
                return;
              }
              setNumber('');
              void run('guess', { value });
            }}
          >
            <label className="field big-field">
              <span>Votre estimation</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={number}
                autoFocus
                onChange={(e) => setNumber(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary big" disabled={busy || number === '' || remaining <= 0}>
              Envoyer
            </button>
          </form>
          {notice}
        </section>
      );
    }

    if (kind === 'carte_vote') {
      return (
        <section className="player-game fade-in">
          <div className="round-info">
            {title} · <Countdown remaining={remaining} />
          </div>
          <h2 className="question-small">{promptText}</h2>
          <ol className="choices-stack" aria-label="Votre main">
            {(me?.hand ?? []).map((card: string, i: number) => (
              <li key={i}>
                <button
                  type="button"
                  className="btn big"
                  disabled={busy || remaining <= 0}
                  onClick={() => run('pick', { card: i })}
                >
                  {card}
                </button>
              </li>
            ))}
          </ol>
          {notice}
        </section>
      );
    }

    // Écriture libre (texte) et détecteur (plaideur) : même saisie.
    return (
      <section className="player-game fade-in">
        <div className="round-info">
          {title} · <Countdown remaining={remaining} />
        </div>
        {promptText && <h2 className="question-small">{promptText}</h2>}
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const value = text.trim();
            if (!value) return;
            setText('');
            void run('answer', { text: value });
          }}
        >
          <label className="field big-field">
            <span>{kind === 'detecteur' ? 'Votre défense' : 'Votre texte'}</span>
            <input
              value={text}
              maxLength={200}
              autoComplete="off"
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button type="submit" className="btn primary big" disabled={busy || !text.trim() || remaining <= 0}>
            Envoyer
          </button>
        </form>
        {notice}
      </section>
    );
  }

  if (pub.phase === 'vote') {
    if (me?.myVote !== null && me?.myVote !== undefined) {
      return <WaitingScreen title="Vote envoyé ✔" text="En attente des autres…" />;
    }
    const isPlayerVote = kind === 'vote_joueur';
    return (
      <section className="player-game fade-in">
        <div className="round-info">
          Vote · <Countdown remaining={remaining} />
        </div>
        <h2 className="question-small">{isPlayerVote ? pub.prompt?.text : 'Quelle réponse est la meilleure ?'}</h2>
        <ol className="choices-stack">
          {pub.options.map((o: { id: string; label: string }, i: number) => {
            const isOwn = isPlayerVote ? o.id === playerId : String(me?.ownOption) === String(i);
            if (isOwn) return null;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  className="btn big"
                  disabled={busy || remaining <= 0}
                  onClick={() => run('vote', isPlayerVote ? { player: o.id } : { option: i })}
                >
                  {o.label}
                </button>
              </li>
            );
          })}
        </ol>
        {notice}
      </section>
    );
  }

  if (pub.phase === 'rate') {
    if (me?.isPleader) return <WaitingScreen title="Votre défense est notée" text="Regardez l’écran principal." />;
    if (me?.myRating !== null && me?.myRating !== undefined) {
      return <WaitingScreen title={`Note envoyée : ${me.myRating} ★`} text="En attente des autres…" />;
    }
    return (
      <section className="player-game fade-in">
        <div className="round-info">
          Mauvaise foi · <Countdown remaining={remaining} />
        </div>
        <h2 className="question-small">Cette défense est-elle crédible ?</h2>
        <div className="choices-stack" role="group" aria-label="Note de 1 à 5 étoiles">
          {[1, 2, 3, 4, 5].map((stars) => (
            <button
              key={stars}
              type="button"
              className="btn big"
              disabled={busy || remaining <= 0}
              onClick={() => run('rate', { stars })}
            >
              {'★'.repeat(stars)} {stars}
            </button>
          ))}
        </div>
        {notice}
      </section>
    );
  }

  // Révélation
  return (
    <WaitingScreen
      title={me?.points !== undefined ? `Vous avez ${me.points} pt(s)` : 'Résultats'}
      text="Les réponses sont sur l’écran principal."
    />
  );
}
