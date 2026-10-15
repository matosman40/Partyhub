import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  audioConstraints,
  MEDIA_PREFS_EVENT,
  MEDIA_PREFS_KEY,
  parseMediaPrefs,
  readMediaPrefs,
  saveMediaPrefs,
  videoConstraints,
} from '@partyhub/games/client';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal('localStorage', impl);
}

describe('parseMediaPrefs', () => {
  it('retombe sur l’appareil par défaut sans valeur ou avec une valeur invalide', () => {
    expect(parseMediaPrefs(null)).toEqual({ microphoneId: null, cameraId: null });
    expect(parseMediaPrefs('pas du json')).toEqual({ microphoneId: null, cameraId: null });
    expect(parseMediaPrefs('null')).toEqual({ microphoneId: null, cameraId: null });
    expect(parseMediaPrefs('"texte"')).toEqual({ microphoneId: null, cameraId: null });
  });

  it('ignore les identifiants vides ou d’un mauvais type', () => {
    expect(parseMediaPrefs(JSON.stringify({ microphoneId: '', cameraId: 42 }))).toEqual({
      microphoneId: null,
      cameraId: null,
    });
  });

  it('garde les identifiants valides', () => {
    expect(parseMediaPrefs(JSON.stringify({ microphoneId: 'mic-1', cameraId: 'cam-2' }))).toEqual({
      microphoneId: 'mic-1',
      cameraId: 'cam-2',
    });
  });
});

describe('contraintes getUserMedia', () => {
  it('utilise le micro par défaut quand aucun n’est choisi', () => {
    expect(audioConstraints({ microphoneId: null, cameraId: null })).toBe(true);
  });

  it('demande le micro choisi sans l’imposer (ideal) pour éviter un échec s’il est débranché', () => {
    expect(audioConstraints({ microphoneId: 'mic-1', cameraId: null })).toEqual({ deviceId: { ideal: 'mic-1' } });
  });

  it('préfère la caméra choisie au sens avant ou arrière', () => {
    expect(videoConstraints({ microphoneId: null, cameraId: 'cam-2' }, 'environment')).toEqual({
      deviceId: { ideal: 'cam-2' },
    });
  });

  it('utilise le sens demandé quand aucune caméra n’est choisie', () => {
    expect(videoConstraints({ microphoneId: null, cameraId: null }, 'environment')).toEqual({
      facingMode: 'environment',
    });
    expect(videoConstraints({ microphoneId: null, cameraId: null })).toBe(true);
  });
});

describe('stockage des réglages', () => {
  it('relit ce qui a été enregistré', () => {
    const store = new Map<string, string>();
    stubStorage({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    saveMediaPrefs({ microphoneId: 'mic-9', cameraId: null });
    expect(store.get(MEDIA_PREFS_KEY)).toBe(JSON.stringify({ microphoneId: 'mic-9', cameraId: null }));
    expect(readMediaPrefs()).toEqual({ microphoneId: 'mic-9', cameraId: null });
  });

  it('ne plante pas quand le stockage est refusé et garde le choix pour la page', () => {
    stubStorage({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => saveMediaPrefs({ microphoneId: 'mic-1', cameraId: 'cam-1' })).not.toThrow();
    expect(readMediaPrefs()).toEqual({ microphoneId: 'mic-1', cameraId: 'cam-1' });
  });

  it('diffuse chaque écriture dans la page pour que les composants restent d’accord', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    const received: unknown[] = [];
    target.addEventListener(MEDIA_PREFS_EVENT, (e) => received.push((e as CustomEvent).detail));
    saveMediaPrefs({ microphoneId: 'mic-2', cameraId: null });
    expect(received).toEqual([{ microphoneId: 'mic-2', cameraId: null }]);
  });
});
