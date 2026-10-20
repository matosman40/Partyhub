import { useEffect, useState, type FormEvent } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Countdown, WaitingScreen } from '../../client/ui.js';
import { DESCRIPTION_MAX_LENGTH, SENTENCE_MAX_LENGTH } from '../info.js';
import type { Stroke } from '../module.js';
import { Drawing } from './Drawing.js';
import { DrawPad } from './DrawPad.js';

export function TelephonePlayer({ publicState: pub, playerState: me, now, send }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Chaque étape repart d’un champ vide.
  useEffect(() => {
    setText('');
    setError(null);
  }, [pub?.round]);

  if (!pub) return null;

  if (pub.phase === 'final') {
    return (
      <section className="player-game fade-in">
        <h2>Partie terminée</h2>
        <p className="muted">Regardez l’écran principal pour lire toutes les chaînes.</p>
      </section>
    );
  }

  if (pub.phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="Vous recevrez une phrase à dessiner ou à décrire." />;
  }

  if (!me?.task) {
    return <WaitingScreen title="Partie en cours" text="Vous rejoindrez la prochaine partie." />;
  }

  if (me.answered) {
    return <WaitingScreen title="Réponse envoyée ✔" text="En attente des autres joueurs…" />;
  }

  const task = me.task;
  const timed = pub.durationMs != null;
  const timeUp = timed && remaining <= 0;

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

  // Le champ ne se vide qu’une fois la réponse acceptée : une erreur garde le texte.
  function textSubmit(type: 'sentence' | 'describe', limit: number) {
    return async (e: FormEvent) => {
      e.preventDefault();
      const value = text.trim().slice(0, limit);
      if (!value) return;
      if (await run(type, { text: value }, 'Réponse refusée')) setText('');
    };
  }

  async function sendDrawing(strokes: Stroke[]) {
    await run('draw', { strokes }, 'Dessin refusé');
  }

  const header = (
    <div className="round-info">
      Étape {pub.round + 1} / {pub.total}
    </div>
  );
  const clock = timed ? <Countdown remaining={remaining} /> : null;
  const errorLine = error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;

  if (task.kind === 'sentence') {
    return (
      <section className="player-game telephone fade-in">
        {header}
        <h2 className="question-small">
          {task.instruction} {clock}
        </h2>
        <form className="stack" onSubmit={textSubmit('sentence', SENTENCE_MAX_LENGTH)}>
          <label className="field big-field">
            <span>Votre phrase</span>
            <input
              value={text}
              maxLength={SENTENCE_MAX_LENGTH}
              autoComplete="off"
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button type="submit" className="btn primary big" disabled={busy || timeUp || !text.trim()}>
            Envoyer
          </button>
        </form>
        {errorLine}
      </section>
    );
  }

  if (task.kind === 'draw') {
    return (
      <section className="player-game telephone fade-in">
        {header}
        <h2 className="question-small">
          {task.instruction} {clock}
        </h2>
        <p className="telephone-prompt">« {task.previousText ?? '…'} »</p>
        <p className="muted">{task.previousBy ? `Écrite par ${task.previousBy}` : 'Phrase tirée au hasard'}</p>
        <DrawPad key={pub.round} disabled={busy || timeUp} onSubmit={(strokes) => void sendDrawing(strokes)} />
        {errorLine}
      </section>
    );
  }

  // describe : on décrit le dessin reçu.
  return (
    <section className="player-game telephone fade-in">
      {header}
      <h2 className="question-small">
        {task.instruction} {clock}
      </h2>
      <Drawing strokes={task.previousStrokes} label="Dessin à décrire" />
      <p className="muted">{task.previousBy ? `Dessiné par ${task.previousBy}` : 'Dessin anonyme'}</p>
      <form className="stack" onSubmit={textSubmit('describe', DESCRIPTION_MAX_LENGTH)}>
        <label className="field big-field">
          <span>Votre description</span>
          <input
            value={text}
            maxLength={DESCRIPTION_MAX_LENGTH}
            autoComplete="off"
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button type="submit" className="btn primary big" disabled={busy || timeUp || !text.trim()}>
          Envoyer
        </button>
      </form>
      {errorLine}
    </section>
  );
}
