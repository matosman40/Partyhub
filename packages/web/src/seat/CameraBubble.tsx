import { useState } from 'react';
import { api } from '../api.js';
import { authHeaders } from '../profile/session.js';
import { WebcamPhoto, webcamAvailable } from '../profile/WebcamPhoto.js';

/**
 * Caméra en bulle, depuis le téléphone d’un joueur connecté à son profil : la bulle ouvre la prise de
 * photo par webcam, et la photo devient l’image du profil. La webcam demande une page sécurisée (https) :
 * sans elle, la bulle explique pourquoi elle ne s’ouvre pas.
 */
export function CameraBubble({ token }: { token?: string | null }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (!webcamAvailable()) {
    return (
      <p className="muted small camera-note">
        Caméra indisponible ici : la webcam ne fonctionne que sur une connexion sécurisée (https).
      </p>
    );
  }

  async function save(dataUrl: string) {
    setOpen(false);
    setSaving(true);
    setNotice(null);
    try {
      await api('/api/profiles/me', {
        method: 'PUT',
        headers: token ? { Authorization: `Bearer ${token}` } : authHeaders(),
        body: JSON.stringify({ avatarImage: dataUrl }),
      });
      setNotice({ ok: true, text: 'Photo enregistrée sur votre profil.' });
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="camera-zone">
      {open ? (
        <div className="camera-panel">
          <WebcamPhoto onCapture={(dataUrl) => void save(dataUrl)} onCancel={() => setOpen(false)} />
        </div>
      ) : (
        <button
          type="button"
          className="camera-bubble"
          aria-expanded={false}
          aria-label="Ouvrir la caméra pour prendre ma photo"
          disabled={saving}
          onClick={() => {
            setNotice(null);
            setOpen(true);
          }}
        >
          <span aria-hidden="true">📷</span>
          <span className="camera-bubble-text">{saving ? 'Un instant…' : 'Ma photo'}</span>
        </button>
      )}
      {notice && (
        <p className={notice.ok ? 'muted small' : 'error small'} role="status">
          {notice.text}
        </p>
      )}
    </div>
  );
}
