import { useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, FinalScreen, WaitingScreen } from '../../client/ui.js';
import { CLUE_MAX_LENGTH, GUESS_MAX_LENGTH } from '../info.js';

interface RoleView {
  isImpostor: boolean;
  view: { kind: 'word' | 'category' | 'none'; value: string | null } | null;
  word: string | null;
  category: string;
  forbidden: string | null;
}

/** Rôle privé : le mot pour l’équipe, ou ce que l’imposteur sait de la manche. */
function RoleCard({ role, mode }: { role: RoleView; mode: string | null }) {
  if (!role.isImpostor) {
    return (
      <div className="role-card crew">
        <p className="label">Le mot de l’équipe</p>
        <h2 className="role-word">{role.word}</h2>
        <p className="muted">Catégorie : {role.category}</p>
        {role.forbidden && (
          <p className="forbidden">
            Interdit de dire : <strong>{role.forbidden}</strong>
          </p>
        )}
      </div>
    );
  }

  const view = role.view;
  let text = 'Vous n’avez aucun mot : improvisez.';
  if (view?.kind === 'word' && mode === 'espion') text = `Un mot proche de celui de l’équipe : « ${view.value} »`;
  if (view?.kind === 'word' && mode !== 'espion') text = `Votre mot, d’une autre catégorie : « ${view.value} »`;
  if (view?.kind === 'category') text = `Vous ne connaissez que la catégorie : ${view.value}.`;

  return (
    <div className="role-card impostor">
      <p className="label">Vous êtes l’imposteur</p>
      <p className="role-hint">{text}</p>
    </div>
  );
}

export function ImposteurPartagePlayer({ publicState: pub, playerState: me, playerId, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="Les rôles arrivent sur votre téléphone." />;
  }

  const header = (
    <div className="round-info">
      Manche {pub.round + 1} / {pub.total} · {pub.modeLabel}
    </div>
  );

  /** Envoie une action ; renvoie vrai si le serveur l’a acceptée. */
  async function run(type: string, payload: unknown, fallback: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const res = await send(type, payload);
    setBusy(false);
    if (!res.ok) setError(res.error ?? fallback);
    return res.ok;
  }

  function formSubmit(type: string, limit: number, fallback: string) {
    return async (e: FormEvent) => {
      e.preventDefault();
      const value = text.trim().slice(0, limit);
      if (!value) return;
      // Le champ ne se vide qu’une fois la phrase acceptée : une erreur (mot interdit…) garde le texte.
      if (await run(type, { text: value }, fallback)) setText('');
    };
  }

  if (pub.phase === 'role') {
    if (!me?.role) return <WaitingScreen title="Rôle en préparation…" />;
    return (
      <section className="player-game imposteur fade-in">
        {header}
        <RoleCard role={me.role} mode={pub.mode} />
        {me.answered ? (
          <p className="notice">Rôle lu ✔ · En attente des autres…</p>
        ) : (
          <button type="button" className="btn primary big" disabled={busy} onClick={() => run('ack', {}, 'Refusé')}>
            J’ai lu mon rôle
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  if (pub.phase === 'clue') {
    if (me?.answered) {
      return <WaitingScreen title="Phrase envoyée ✔" text={me.myClue ? `« ${me.myClue} »` : undefined} />;
    }
    return (
      <section className="player-game imposteur fade-in">
        {header}
        {me?.role && <p className="muted">{me.role.isImpostor ? 'Vous êtes l’imposteur.' : `Mot : ${me.role.word}`}</p>}
        <h2 className="question-small">
          Dites une phrase sans trahir le mot · <Countdown remaining={remaining} />
        </h2>
        <form className="stack" onSubmit={formSubmit('clue', CLUE_MAX_LENGTH, 'Phrase refusée')}>
          <label className="field big-field">
            <span>Votre phrase</span>
            <input
              value={text}
              maxLength={CLUE_MAX_LENGTH}
              autoComplete="off"
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button type="submit" className="btn primary big" disabled={busy || !text.trim() || remaining <= 0}>
            Envoyer
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  if (pub.phase === 'vote') {
    const candidates = (pub.clues as Array<{ id: string; name: string; text: string }>).filter(
      (c) => c.id !== playerId,
    );
    return (
      <section className="player-game imposteur fade-in">
        {header}
        <p className="label">
          Qui est l’imposteur ? · <Countdown remaining={remaining} />
        </p>
        <div className="choices-stack">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`choice-btn${me?.myVote === c.id ? ' selected' : ''}`}
              disabled={me?.answered || busy || remaining <= 0}
              onClick={() => void run('vote', { target: c.id }, 'Vote refusé')}
            >
              {c.name} <span className="muted">« {c.text} »</span>
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {me?.answered ? (
          <p className="notice">Vote enregistré ✔ · En attente des autres…</p>
        ) : (
          <p className="muted">Votez pour celui que vous soupçonnez.</p>
        )}
      </section>
    );
  }

  if (pub.phase === 'guess') {
    if (me?.canGuess) {
      return (
        <section className="player-game imposteur fade-in">
          {header}
          <p className="label">
            Vous êtes démasqué ! Devinez le mot de l’équipe · <Countdown remaining={remaining} />
          </p>
          <form className="stack" onSubmit={formSubmit('guess', GUESS_MAX_LENGTH, 'Tentative refusée')}>
            <label className="field big-field">
              <span>Le mot de l’équipe</span>
              <input
                value={text}
                maxLength={GUESS_MAX_LENGTH}
                autoComplete="off"
                autoFocus
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary big" disabled={busy || !text.trim()}>
              Deviner
            </button>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      );
    }
    return (
      <WaitingScreen title="L’imposteur tente de deviner le mot…" text="Attendez le résultat sur l’écran principal." />
    );
  }

  // result
  const gained = me?.gained ?? 0;
  const won = me?.outcome === 'imposteur' ? me.wasImpostor === true : me?.wasImpostor === false;
  return (
    <section className="player-game imposteur fade-in">
      <p className={`verdict ${won ? 'ok' : ''}`}>
        {won ? 'Vous avez gagné cette manche !' : 'Cette manche est perdue.'}
      </p>
      {gained > 0 && <p className="big-number">+{gained}</p>}
      <p>
        Total : {me?.points ?? 0} pts · {me?.rank ? `${me.rank}ᵉ` : ''}
      </p>
    </section>
  );
}
