import { describe, expect, it } from 'vitest';
import {
  activeMusicSlot,
  builtinGameMusic,
  claimMusic,
  DEFAULT_SFX_FILES,
  isImportedGame,
  mergeSfxFiles,
  musicForLobby,
  withDefaultSfx,
} from '../sounds.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

describe('Sons d’un jeu importé', () => {
  it('reconnaît les jeux importés par leur préfixe, et pas les jeux intégrés', () => {
    expect(isImportedGame('pkg-paquet-sons')).toBe(true);
    expect(isImportedGame('pkgb-plateau')).toBe(true);
    expect(isImportedGame('pkgq-quiz')).toBe(true);
    expect(isImportedGame('pkgr-recette')).toBe(true);
    expect(isImportedGame('banquise')).toBe(false);
    expect(isImportedGame('pkgz-inconnu')).toBe(false);
  });

  it('le jeu affiché remplace le son global de même nom, et les autres bruitages restent globaux', () => {
    const global = { place: null, die: 'https://example.test/global-die.ogg', win: null };
    const game = { place: '/api/packages/x/assets/sons/sfx-place.ogg' };
    expect(mergeSfxFiles(global, game)).toEqual({
      place: '/api/packages/x/assets/sons/sfx-place.ogg',
      die: 'https://example.test/global-die.ogg',
      win: null,
    });
  });

  it('sans sons de jeu, les réglages globaux ne changent pas', () => {
    const global = { place: 'https://example.test/place.ogg' };
    expect(mergeSfxFiles(global, {})).toEqual(global);
  });
});

describe('Sons livrés avec l’application', () => {
  const publicDir = fileURLToPath(new URL('../../public', import.meta.url));

  it('chaque bruitage a son fichier livré, et un choix de l’administration l’emporte', () => {
    for (const url of Object.values(DEFAULT_SFX_FILES)) expect(existsSync(publicDir + url)).toBe(true);
    const sfx = withDefaultSfx({ click: 'media-123', card: null });
    expect(sfx.click).toBe('media-123');
    expect(sfx.card).toBe('/sons/bruitages/card.mp3');
    expect(sfx.turn).toBe('/sons/bruitages/turn.mp3');
  });

  it('un jeu intégré a sa musique de partie, un jeu inconnu n’en a pas', () => {
    expect(builtinGameMusic('tarot')).toBe('/sons/musiques/tarot.mp3');
    expect(builtinGameMusic('tirage-surprise')).toBe('/sons/musiques/quiz-party.mp3');
    expect(builtinGameMusic('jeu-inconnu')).toBeNull();
    for (const id of ['tarot', 'banquise', 'photo-mystere', 'sudoku']) {
      expect(existsSync(publicDir + builtinGameMusic(id))).toBe(true);
    }
  });
});
