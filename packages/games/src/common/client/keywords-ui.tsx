import { useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { TimerBar } from '../../client/ui.js';

/**
 * Affichage commun des mots-clés tirés à tour de rôle (quiz à thème, phrases à trous) : tableau des tours sur
 * l’écran principal, et formulaire de saisie sur le téléphone de celui qui parle.
 */

export interface KeywordTurnView {
  name: string;
  keywords: string[];
  state: 'done' | 'current' | 'waiting';
}

export interface KeywordTurnsView {
  current: string | null;
  turnMs: number;
  turns: KeywordTurnView[];
}

/** Écran principal : à qui le tour, qui a déjà proposé quoi, et le temps restant. */
export function KeywordTurnsBoard({
  topics,
  remaining,
  generating,
}: {
  topics: KeywordTurnsView | null;
  remaining: number;
  generating: boolean;
}) {
  return (
    <section className="keyword-board fade-in">
      {generating ? (
        <>
          <h2 className="question-title">L’IA écrit les questions…</h2>
          <p className="big">Elle s’appuie sur les mots-clés de chacun.</p>
        </>
      ) : (
        <>
          <h2 className="question-title">
            {topics?.current ? `À ${topics.current} de proposer ses mots-clés` : 'Tous les mots-clés sont donnés'}
          </h2>
          {topics?.current && <TimerBar remaining={remaining} total={topics.turnMs || 1} />}
        </>
      )}
      <ul className="topic-turns" aria-label="Mots-clés de chaque joueur">
        {(topics?.turns ?? []).map((t) => (
          <li key={t.name} className={`topic-turn is-${t.state}`}>
            <span className="name">{t.name}</span>
            <span className="keywords">
              {t.keywords.length > 0
                ? t.keywords.join(' · ')
                : t.state === 'current'
                  ? 'à vous…'
                  : t.state === 'done'
                    ? 'passé'
                    : 'en attente'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Téléphone : saisie des mots-clés pour celui dont c’est le tour. Les autres voient seulement qui parle.
 * La validation (tour, nombre de mots) est faite par le serveur ; ici on ne fait que l’affichage.
 */
export function KeywordForm({
  myTurn,
  current,
  remaining,
  send,
  action = 'keywords',
}: {
  myTurn: boolean;
  current: string | null;
  remaining: number;
  send: PlayerViewProps['send'];
  action?: string;
}) {
  const [words, setWords] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = myTurn && !sent;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!active || words.trim() === '') return;
    setError(null);
    const res = await send(action, { words });
    if (res.ok) setSent(true);
    else setError(res.error ?? 'Saisie refusée');
  }

  if (active) {
    return (
      <section className="player-game fade-in">
        <p className="big">À vous !</p>
        <p className="muted">
          Donnez de 1 à 5 mots-clés, séparés par des virgules. L’IA s’en servira pour écrire les questions.
        </p>
        <form className="stack" onSubmit={submit}>
          <input
            value={words}
            maxLength={160}
            placeholder="volcans, lave, Islande"
            aria-label="Mots-clés"
            autoFocus
            onChange={(e) => setWords(e.target.value)}
          />
          <button type="submit" className="btn primary big" disabled={words.trim() === ''}>
            Envoyer
          </button>
        </form>
        <p className="muted">{Math.ceil(remaining / 1000)} s</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="player-game fade-in">
      <p className="big">{sent ? 'Mots-clés envoyés ✔' : `${current ?? '…'} propose ses mots-clés`}</p>
      <p className="muted">{sent ? 'En attente des autres…' : 'Patientez, votre tour viendra.'}</p>
    </section>
  );
}
