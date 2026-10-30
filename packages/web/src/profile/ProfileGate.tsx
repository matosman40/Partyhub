import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ProfileView } from '@partyhub/shared';
import { api } from '../api.js';
import { CreateProfileForm } from './CreateProfileForm.js';
import {
  activeDeviceProfile,
  forgetDeviceProfile,
  PROFILE_CHANGED,
  readDeviceProfiles,
  readProfileToken,
  rememberDeviceProfile,
  switchDeviceProfile,
} from './session.js';

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** Vrai tant que le navigateur se dit connecté (l'application s'ouvre aussi hors ligne, depuis le cache). */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

type Status = 'checking' | 'ready' | 'create' | 'offline';

/**
 * Vérifie le profil actif auprès du serveur. Un jeton refusé (session perdue) retire le profil de
 * l’appareil, et on essaie le suivant. Sans profil valable, il faut créer le sien.
 */
async function resolveProfile(): Promise<'ready' | 'create' | 'offline'> {
  for (let attempt = 0; attempt < 20; attempt++) {
    let token = readProfileToken();
    if (!token) {
      const first = readDeviceProfiles()[0];
      if (!first) return 'create';
      switchDeviceProfile(first.token);
      token = first.token;
    }
    try {
      const res = await api<{ profile: ProfileView }>('/api/profiles/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const known = readDeviceProfiles().find((p) => p.token === token);
      if (!known || known.name !== res.profile.displayName || known.id !== res.profile.id) {
        rememberDeviceProfile({ token, id: res.profile.id, name: res.profile.displayName });
      }
      return 'ready';
    } catch (err) {
      if ((err as Error & { status?: number }).status === 401) {
        forgetDeviceProfile(token);
        continue;
      }
      return 'offline';
    }
  }
  return 'create';
}

/**
 * Porte d’entrée : sans profil valable sur cet appareil, on demande d’abord un nom.
 * Les écrans du joueur (accueil, saisie du code, téléphone) ne s’ouvrent qu’ensuite.
 */
export function ProfileGate({ children }: { children: ReactNode }) {
  const online = useOnline();
  const [status, setStatus] = useState<Status>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setStatus('checking');
    void resolveProfile().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  // Le dernier profil de l’appareil vient d’être retiré : on redemande un nom.
  useEffect(() => {
    const onChanged = () => {
      if (!activeDeviceProfile() && readDeviceProfiles().length === 0) setStatus('create');
    };
    window.addEventListener(PROFILE_CHANGED, onChanged);
    return () => window.removeEventListener(PROFILE_CHANGED, onChanged);
  }, []);

  if (status === 'checking') {
    return (
      <main className="page center">
        <p>Vérification du profil…</p>
      </main>
    );
  }

  if (status === 'offline') {
    return (
      <main className="page center fade-in">
        <h1>Connexion impossible</h1>
        <p className="muted">Votre profil n’a pas pu être vérifié. Vérifiez le réseau, puis réessayez.</p>
        <button type="button" className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
          Réessayer
        </button>
      </main>
    );
  }

  if (status === 'create') {
    return (
      <main className="page center fade-in" style={{ maxWidth: 520 }}>
        {!online && (
          <p className="notice offline-notice" role="status">
            Hors ligne : l’application s’ouvre, mais votre profil ne peut pas être créé sans connexion. Reconnectez-vous
            au réseau, puis appuyez sur Continuer.
          </p>
        )}
        <CreateProfileForm onCreated={() => setStatus('ready')} />
      </main>
    );
  }

  return <>{children}</>;
}
