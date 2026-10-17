import { useState, type FormEvent } from 'react';
import type { RecipePhase, ScreenBlock } from '@partyhub/shared';
import { Countdown, LETTERS, Ranking, TimerBar, type RankRow } from '../../client/ui.js';

/**
 * Rendu des blocs d'écran d'une recette. Le serveur dit quels blocs afficher, dans quel ordre, et pour quelle
 * phase ; ce fichier ne fait que les dessiner. Le texte des joueurs est toujours affiché comme du texte.
 */

type Send = (type: string, payload?: unknown) => Promise<{ ok: boolean; error?: string }>;

/** Résultat d'un mot à la révélation (getPublicState de vote-sur-consigne.ts). */
export interface RecipeResult {
  word: string;
  author: string;
  votes: number;
  gained: number;
}

/** Ce que le serveur publie pour une recette. Seuls les champs utilisés par les blocs sont listés. */
export interface RecipePublic {
  title: string;
  phase: RecipePhase;
  round: number;
  total: number;
  playerCount: number;
  ranking: RankRow[];
  motMax: number;
  prompt: string | null;
  durationMs?: number;
  writtenCount?: number;
  voteCount?: number;
  options?: string[];
  results?: RecipeResult[];
}

/** Ce que le serveur donne à un joueur (getPlayerState de vote-sur-consigne.ts). */
export interface RecipeMe {
  points: number;
  rank: number | null;
  myWord: string | null;
  myOption: number | null;
  myVote: number | null;
  answered: boolean;
  gained: number | null;
}

interface TvBlockProps {
  block: ScreenBlock;
  pub: RecipePublic;
  remaining: number;
  pending: string[];
}

/** Blocs de l'écran principal. Les blocs de saisie n'existent que sur le téléphone. */
export function TvBlock({ block, pub, remaining, pending }: TvBlockProps) {
  switch (block) {
    case 'titre':
      return <h2 className="recipe-title">{pub.title}</h2>;
    case 'consigne':
      return (
        <div className="recipe-prompt">
          {pub.total > 0 && (
            <p className="label">
              Manche {pub.round + 1} / {pub.total}
            </p>
          )}
          <h2 className="huge-word">{pub.prompt}</h2>
        </div>
      );
    case 'minuteur':
      return pub.durationMs ? <TimerBar remaining={remaining} total={pub.durationMs} /> : null;
    case 'attente':
      return (
        <p className="muted">
          {pending.length > 0 ? `En attente : ${pending.join(', ')}` : 'Tout le monde a répondu.'}
        </p>
      );
    case 'vote':
      return (
        <ol className="recipe-options">
          {(pub.options ?? []).map((word: string, i: number) => (
            <li key={i}>
              <span className="recipe-letter">{LETTERS[i]}</span> {word}
            </li>
          ))}
        </ol>
      );
    case 'resultat':
      return (
        <ul className="recipe-results">
          {(pub.results ?? []).map((r: { word: string; author: string; votes: number; gained: number }, i: number) => (
            <li key={i}>
              <span className="recipe-word">« {r.word} »</span>
              <span className="muted">
                {' '}
                de {r.author} · {r.votes} vote{r.votes > 1 ? 's' : ''}
                {r.gained > 0 ? ` · +${r.gained}` : ''}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'classement':
      return <Ranking entries={pub.ranking ?? []} />;
    case 'saisie-texte':
      return null;
    default:
      return null;
  }
}

interface PhoneBlockProps {
  block: ScreenBlock;
  pub: RecipePublic;
  remaining: number;
  me: RecipeMe | null;
  send: Send;
}

/** Blocs du téléphone du joueur : la saisie et le vote, plus les mêmes textes que l'écran principal. */
export function PhoneBlock({ block, pub, remaining, me, send }: PhoneBlockProps) {
  switch (block) {
    case 'titre':
      return <h2 className="recipe-title">{pub.title}</h2>;
    case 'consigne':
      return (
        <div className="recipe-prompt">
          {pub.total > 0 && (
            <p className="label">
              Manche {pub.round + 1} / {pub.total}
            </p>
          )}
          <p className="recipe-prompt-text">{pub.prompt}</p>
        </div>
      );
    case 'minuteur':
      return <Countdown remaining={remaining} />;
    case 'attente': {
      const done = pub.phase === 'vote' ? pub.voteCount : pub.writtenCount;
      return (
        <p className="muted">
          {done ?? 0} / {pub.playerCount} ont répondu
        </p>
      );
    }
    case 'saisie-texte':
      return <WordForm max={pub.motMax} answered={Boolean(me?.answered)} myWord={me?.myWord ?? null} send={send} />;
    case 'vote':
      return (
        <VoteChoices
          options={pub.options ?? []}
          myOption={me?.myOption ?? null}
          myVote={me?.myVote ?? null}
          send={send}
        />
      );
    case 'resultat':
      return (
        <ul className="recipe-results">
          {(pub.results ?? []).map((r: { word: string; author: string; votes: number; gained: number }, i: number) => (
            <li key={i}>
              <span className="recipe-word">« {r.word} »</span>
              <span className="muted">
                {' '}
                · {r.votes} vote{r.votes > 1 ? 's' : ''}
              </span>
              {r.gained > 0 && <span className="recipe-gain"> · +{r.gained}</span>}
            </li>
          ))}
        </ul>
      );
    case 'classement':
      return <Ranking entries={pub.ranking ?? []} />;
    default:
      return null;
  }
}

function WordForm({
  max,
  answered,
  myWord,
  send,
}: {
  max: number;
  answered: boolean;
  myWord: string | null;
  send: Send;
}) {
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (answered) {
    return <p className="recipe-sent">Mot envoyé ✔ : « {myWord ?? ''} »</p>;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = word.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const res = await send('word', { word: value });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Mot refusé');
  }

  return (
    <form className="recipe-form" onSubmit={submit}>
      <label htmlFor="recipe-word">Votre mot</label>
      <input
        id="recipe-word"
        name="word"
        autoComplete="off"
        maxLength={max}
        value={word}
        onChange={(e) => setWord(e.target.value)}
      />
      <button type="submit" className="btn primary big" disabled={busy || word.trim().length === 0}>
        Envoyer
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}

function VoteChoices({
  options,
  myOption,
  myVote,
  send,
}: {
  options: string[];
  myOption: number | null;
  myVote: number | null;
  send: Send;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (myVote !== null) {
    return <p className="recipe-sent">Vote enregistré ✔</p>;
  }

  async function choose(option: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await send('vote', { option });
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Vote refusé');
  }

  return (
    <div className="recipe-choices">
      {options.map((word, i) => {
        const own = i === myOption;
        return (
          <button key={i} type="button" className="btn big" disabled={busy || own} onClick={() => choose(i)}>
            <span className="recipe-letter">{LETTERS[i]}</span> {word}
            {own && <span className="muted"> (votre mot)</span>}
          </button>
        );
      })}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
