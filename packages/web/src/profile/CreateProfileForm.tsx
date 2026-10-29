import { useState, type FormEvent } from 'react';
import { PLAYER_NAME_MAX, type ProfileView } from '@partyhub/shared';
import { api } from '../api.js';
import { rememberDeviceProfile } from './session.js';

/**
 * Création d’un profil avec le seul pseudo. Pas de mot de passe : le profil reste sur cet appareil,
 * et le jeton de session le retrouve. Le nouveau profil devient le profil actif.
 */
export function CreateProfileForm({
  title = 'Comment vous appelez-vous ?',
  activate = true,
  onCreated,
}: {
  title?: string;
  /** Faux : le nouveau profil ne remplace pas le profil actif (profil d’un autre joueur de l’appareil). */
  activate?: boolean;
  onCreated: (profile: ProfileView, token: string) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const displayName = name.trim();
    if (!displayName) {
      setError('Entrez votre nom.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; profile: ProfileView }>('/api/profiles/register', {
        method: 'POST',
        body: JSON.stringify({ displayName }),
      });
      rememberDeviceProfile({ token: res.token, id: res.profile.id, name: res.profile.displayName }, activate);
      onCreated(res.profile, res.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack create-profile" onSubmit={submit}>
      <h2>{title}</h2>
      <p className="muted small">
        Un nom suffit, sans mot de passe. Votre profil reste sur cet appareil : votre personnage et vos sons le suivent
        dans chaque salle.
      </p>
      <label className="field big-field">
        <span>Votre nom</span>
        <input
          value={name}
          maxLength={PLAYER_NAME_MAX}
          autoComplete="nickname"
          autoFocus
          aria-describedby="create-profile-name-count"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p
        id="create-profile-name-count"
        className={`muted small${name.length >= PLAYER_NAME_MAX ? ' warn' : ''}`}
        aria-live="polite"
      >
        {name.length >= PLAYER_NAME_MAX
          ? `Limite atteinte : ${PLAYER_NAME_MAX} caractères au maximum (un émoji en compte deux).`
          : `${name.length} / ${PLAYER_NAME_MAX} caractères`}
      </p>
      <button type="submit" className="btn primary big" disabled={busy || !name.trim()}>
        {busy ? 'Création…' : 'Continuer'}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
