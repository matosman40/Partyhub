import { useCallback, useEffect, useState } from 'react';

/**
 * Micro et caméra choisis sur cet appareil. Le choix est propre à l'appareil, pas au compte :
 * un téléphone a souvent deux caméras, une tablette un autre micro. Il est gardé dans le navigateur.
 * `null` signifie « appareil par défaut ».
 */
export interface MediaPrefs {
  microphoneId: string | null;
  cameraId: string | null;
}

export const MEDIA_PREFS_KEY = 'ph:media';

export const EMPTY_MEDIA_PREFS: MediaPrefs = { microphoneId: null, cameraId: null };

/** Lit les réglages enregistrés ; toute valeur inattendue retombe sur « appareil par défaut ». */
export function parseMediaPrefs(raw: string | null): MediaPrefs {
  if (!raw) return EMPTY_MEDIA_PREFS;
  try {
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') return EMPTY_MEDIA_PREFS;
    return {
      microphoneId: typeof data.microphoneId === 'string' && data.microphoneId ? data.microphoneId : null,
      cameraId: typeof data.cameraId === 'string' && data.cameraId ? data.cameraId : null,
    };
  } catch {
    return EMPTY_MEDIA_PREFS;
  }
}

export function readMediaPrefs(): MediaPrefs {
  try {
    return parseMediaPrefs(localStorage.getItem(MEDIA_PREFS_KEY));
  } catch {
    // Stockage refusé (navigation privée, données bloquées) : appareil par défaut.
    return EMPTY_MEDIA_PREFS;
  }
}

export function saveMediaPrefs(prefs: MediaPrefs): void {
  try {
    localStorage.setItem(MEDIA_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Le choix vaut alors pour cette page seulement.
  }
}

/**
 * Contraintes getUserMedia pour le micro. `ideal` et non `exact` : si le micro choisi a été
 * débranché, le navigateur prend le micro par défaut au lieu d'échouer.
 */
export function audioConstraints(prefs: MediaPrefs): MediaTrackConstraints | true {
  return prefs.microphoneId ? { deviceId: { ideal: prefs.microphoneId } } : true;
}

/**
 * Contraintes getUserMedia pour la caméra. Une caméra choisie prime sur le sens (avant ou arrière),
 * qui ne sert qu'à défaut de choix.
 */
export function videoConstraints(prefs: MediaPrefs, facing?: 'user' | 'environment'): MediaTrackConstraints | true {
  if (prefs.cameraId) return { deviceId: { ideal: prefs.cameraId } };
  if (facing) return { facingMode: facing };
  return true;
}

/** Vrai si le navigateur sait demander le micro ou la caméra (le contexte doit être HTTPS). */
export function canUseMedia(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** Demande le micro choisi sur cet appareil. Rejette si l'accès est refusé ou impossible. */
export function requestMicrophone(prefs: MediaPrefs): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraints(prefs), video: false });
}

/** Demande la caméra choisie sur cet appareil. Rejette si l'accès est refusé ou impossible. */
export function requestCamera(prefs: MediaPrefs, facing?: 'user' | 'environment'): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: videoConstraints(prefs, facing), audio: false });
}

/**
 * Réglages micro et caméra de l'appareil, avec mise à jour immédiate dans les autres onglets.
 * Les jeux l'utilisent pour demander le bon appareil ; le choix se fait dans le profil ou le tiroir d'angle.
 */
export function useMediaPrefs(): [MediaPrefs, (patch: Partial<MediaPrefs>) => void] {
  const [prefs, setPrefs] = useState<MediaPrefs>(readMediaPrefs);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === MEDIA_PREFS_KEY) setPrefs(parseMediaPrefs(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((patch: Partial<MediaPrefs>) => {
    setPrefs((previous) => {
      // L'enregistrement est idempotent : sans effet de bord visible si React rejoue ce calcul.
      const next = { ...previous, ...patch };
      saveMediaPrefs(next);
      return next;
    });
  }, []);

  return [prefs, update];
}
