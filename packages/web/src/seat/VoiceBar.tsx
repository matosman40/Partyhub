import { useEffect, useRef, useState } from 'react';
import type { VoiceClip } from '@partyhub/shared';
import { api } from '../api.js';
import type { AppSocket } from '../realtime.js';
import { authHeaders } from '../profile/session.js';
import { voiceUrl } from '../components/voiceQueue.js';

/** En-têtes du profil du siège (ou du profil actif de l'appareil, à défaut). */
const headersFor = (token?: string | null): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : authHeaders();

/**
 * Voix du profil, depuis le téléphone. « Écouter » joue la voix sur ce téléphone seulement ;
 * le nom de la voix l'envoie à l'écran principal. Sans voix enregistrée, la barre n'apparaît pas.
 */
export function VoiceBar({ socket, token }: { socket: AppSocket; token?: string | null }) {
  const [voices, setVoices] = useState<VoiceClip[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ voices: VoiceClip[] }>('/api/profiles/me/voices', { headers: headersFor(token) })
      .then((r) => {
        if (alive) setVoices(r.voices);
      })
      .catch(() => {
        // Sans liste, la barre ne s'affiche pas : le reste de la page reste utilisable.
      });
    return () => {
      alive = false;
      previewRef.current?.pause();
    };
  }, [token]);

  if (voices.length === 0) return null;

  function play(voice: VoiceClip) {
    setNotice(null);
    socket.emit('player:voice', { id: voice.id }, (res) => {
      setNotice(res.ok ? { ok: true, text: `« ${voice.name} » envoyée à l’écran.` } : { ok: false, text: res.error });
    });
  }

  function preview(voice: VoiceClip) {
    setNotice(null);
    previewRef.current?.pause();
    const el = new Audio(voiceUrl(voice.id));
    previewRef.current = el;
    el.play().catch(() => {
      setNotice({ ok: false, text: 'Impossible d’écouter cette voix sur ce téléphone.' });
    });
  }

  return <VoiceChoices voices={voices} notice={notice} onPlay={play} onPreview={preview} />;
}

/**
 * Boutons des voix, avec le retour de l’envoi (« envoyée à l’écran » ou la raison du refus).
 * `onPreview` ajoute un bouton « Écouter » qui joue la voix sur ce téléphone.
 */
export function VoiceChoices({
  voices,
  notice,
  onPlay,
  onPreview,
}: {
  voices: VoiceClip[];
  notice: { ok: boolean; text: string } | null;
  onPlay: (voice: VoiceClip) => void;
  onPreview?: (voice: VoiceClip) => void;
}) {
  return (
    <section className="voice-bar" aria-label="Mes voix">
      <p className="voice-bar-title">Mes voix</p>
      {onPreview && <p className="muted small">Écouter : sur ce téléphone. Nom : envoyer à l’écran.</p>}
      <div className="voice-buttons">
        {voices.map((voice) => (
          <span key={voice.id} className="voice-pair">
            {onPreview && (
              <button
                type="button"
                className="btn small ghost"
                aria-label={`Écouter « ${voice.name} » sur ce téléphone`}
                onClick={() => onPreview(voice)}
              >
                Écouter
              </button>
            )}
            <button type="button" className="btn small" onClick={() => onPlay(voice)}>
              {voice.name}
            </button>
          </span>
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
