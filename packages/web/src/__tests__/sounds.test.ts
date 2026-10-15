import { describe, expect, it } from 'vitest';
import { activeMusicSlot, claimMusic, musicForLobby } from '../sounds.js';

describe('Musique : emplacement actif', () => {
  it('le salon choisit menus avant la partie, fin de partie aux résultats, rien pendant le jeu', () => {
    expect(musicForLobby('waiting')).toBe('menus');
    expect(musicForLobby('full')).toBe('menus');
    expect(musicForLobby('ended')).toBe('fin');
    expect(musicForLobby('in_game')).toBeNull();
    expect(musicForLobby(undefined)).toBeNull();
  });

  it('la dernière réclamation vivante l’emporte, et la libération rend la place à la précédente', () => {
    expect(activeMusicSlot()).toBeNull();
    const home = claimMusic('accueil');
    expect(activeMusicSlot()).toBe('accueil');
    const join = claimMusic('menus');
    expect(activeMusicSlot()).toBe('menus');
    join();
    expect(activeMusicSlot()).toBe('accueil');
    home();
    expect(activeMusicSlot()).toBeNull();
  });
});
