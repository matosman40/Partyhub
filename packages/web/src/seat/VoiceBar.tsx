import { useEffect, useState } from 'react';
import type { VoiceClip } from '@partyhub/shared';
import { api } from '../api.js';
import type { AppSocket } from '../realtime.js';
import { authHeaders } from '../profile/session.js';

/**
 * Voix du profil, déclenchables depuis le téléphone : chaque bouton envoie la voix à l'écran principal.
 * Rien ne joue sur le téléphone lui-même ; sans voix enregistrée, la barre n'apparaît pas.
 */
export function VoiceBar({ socket }: { socket: AppSocket }) {
  const [voices, setVoices] = useState<VoiceClip[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ voices: VoiceClip[] }>('/api/profiles/me/voices', { headers: authHeaders() })
      .then((r) => {
        if (alive) setVoices(r.voices);
      })
      .catch(() => {
        // Sans liste, la barre ne s'affiche pas : le reste de la page reste utilisable.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (voices.length === 0) return null;

  function play(voice: VoiceClip) {
    setNotice(null);
    socket.emit('player:voice', { id: voice.id }, (res) => {
      setNotice(res.ok ? { ok: true, text: `« ${voice.name} » envoyée à l’écran.` } : { ok: false, text: res.error });
    });
  }

  return <VoiceChoices voices={voices} notice={notice} onPlay={play} />;
}

/** Boutons des voix, avec le retour de l’envoi (« envoyée à l’écran » ou la raison du refus). */
export function VoiceChoices({
  voices,
  notice,
  onPlay,
}: {
  voices: VoiceClip[];
  notice: { ok: boolean; text: string } | null;
  onPlay: (voice: VoiceClip) => void;
}) {
  return (
    <section className="voice-bar" aria-label="Mes voix">
      <p className="voice-bar-title">Mes voix</p>
      <div className="voice-buttons">
        {voices.map((voice) => (
          <button key={voice.id} type="button" className="btn small" onClick={() => onPlay(voice)}>
            {voice.name}
          </button>
        ))}
      </div>
      {notice && (
        <p className={notice.ok ? 'muted small' : 'error small'} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}
