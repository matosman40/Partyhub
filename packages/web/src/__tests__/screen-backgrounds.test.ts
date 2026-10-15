import { describe, expect, it } from 'vitest';
import { backgroundFor, screenForPath, SCREEN_KEYS, type ScreenBackgroundUrls } from '../screenBackgrounds.js';

/** Fonds d'écran : chaque adresse de l'application correspond à un écran administrable. */

describe('Écran affiché pour une adresse', () => {
  it('reconnaît les pages principales et leurs codes de salle', () => {
    expect(screenForPath('/')).toBe('home');
    expect(screenForPath('/join')).toBe('join');
    expect(screenForPath('/tv/4472')).toBe('tv');
    expect(screenForPath('/j/4472')).toBe('player');
    expect(screenForPath('/spectate/4472')).toBe('spectator');
    expect(screenForPath('/profil')).toBe('profile');
  });

  it('ne personnalise ni l’administration, ni la page de test, ni les pages inconnues', () => {
    expect(screenForPath('/admin')).toBeNull();
    expect(screenForPath('/test-appareils')).toBeNull();
    expect(screenForPath('/n-existe-pas')).toBeNull();
  });
});

describe('Adresse du fond d’un écran', () => {
  const backgrounds: ScreenBackgroundUrls = {
    home: '/api/assets/aaa',
    join: null,
    tv: '/api/assets/bbb',
    player: null,
    spectator: null,
    profile: null,
  };

  it('donne l’image de l’écran, ou rien s’il garde son décor', () => {
    expect(backgroundFor(backgrounds, 'home')).toBe('/api/assets/aaa');
    expect(backgroundFor(backgrounds, 'join')).toBeNull();
    expect(backgroundFor(backgrounds, null)).toBeNull();
    expect(backgroundFor(null, 'home')).toBeNull();
  });

  it('couvre tous les écrans administrables', () => {
    expect(Object.keys(backgrounds).sort()).toEqual([...SCREEN_KEYS].sort());
  });
});
