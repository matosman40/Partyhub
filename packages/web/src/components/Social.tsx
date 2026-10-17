import { useEffect, useState, type FormEvent } from 'react';
import { REACTION_EMOJIS, type ChatMessage } from '@partyhub/shared';
import type { AppSocket } from '../realtime.js';
import { PlayerAvatar } from './PlayerAvatar.js';

/** Boutons de réaction : un tap envoie l’emoji à toute la salle. */
export function EmoteBar({ onPick, disabled = false }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  return (
    <div className="emote-bar" role="group" aria-label="Réactions">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          disabled={disabled}
          onClick={() => onPick(emoji)}
          aria-label={`Envoyer ${emoji}`}
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Fil de discussion de la salle. Les messages ne sont jamais conservés côté serveur. */
export function ChatPanel({
  messages,
  onSend,
  error,
  compact = false,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  error?: string | null;
  compact?: boolean;
}) {
  const [text, setText] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    onSend(clean);
    setText('');
  }

  return (
    <section className="chat" aria-label="Discussion de la salle">
      <ul className="chat-list" aria-live="polite">
        {messages.length === 0 && <li className="muted small">Pas encore de message. Dites bonjour !</li>}
        {messages.map((m) => (
          <li key={m.id} className="chat-msg">
            <PlayerAvatar avatar={m.avatar} name={m.from} size="sm" />
            <span>
              <strong>{m.from}</strong>
              {m.text}
              {!compact && <span className="time">{clock(m.at)}</span>}
            </span>
          </li>
        ))}
      </ul>
      <form className="chat-form" onSubmit={submit}>
        <input
          value={text}
          maxLength={120}
          placeholder="Votre message"
          aria-label="Votre message"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn small" disabled={!text.trim()}>
          Envoyer
        </button>
      </form>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

interface FloatingReaction {
  id: string;
  emoji: string;
  left: number;
}

/**
 * Réactions reçues de la salle, affichées en flottant sur l’écran principal.
 * Elles disparaissent d’elles-mêmes ; rien n’est gardé après.
 */
export function ReactionLayer({ socket }: { socket: AppSocket }) {
  const [items, setItems] = useState<FloatingReaction[]>([]);

  useEffect(() => {
    const onReaction = (r: { id: string; emoji: string }) => {
      const item: FloatingReaction = { id: r.id, emoji: r.emoji, left: 8 + Math.random() * 84 };
      setItems((list) => [...list.slice(-30), item]);
      window.setTimeout(() => {
        setItems((list) => list.filter((x) => x.id !== item.id));
      }, 2800);
    };
    socket.on('room:reaction', onReaction);
    return () => {
      socket.off('room:reaction', onReaction);
    };
  }, [socket]);

  return (
    <div className="reaction-layer" aria-hidden="true">
      {items.map((r) => (
        <span key={r.id} className="float-emoji" style={{ left: `${r.left}%` }}>
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
