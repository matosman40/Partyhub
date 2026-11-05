import { describe, expect, it } from 'vitest';
import { EMPTY_SOUND_SETTINGS, MUSIC_SLOTS, SFX_NAMES, parseSoundSettings, soundSettingsSchema } from '../sounds.js';

describe('Réglages des sons', () => {
  it('lit un réglage complet, et redonne le vide pour tout ce qui ne se lit pas', () => {
    expect(parseSoundSettings(undefined)).toEqual(EMPTY_SOUND_SETTINGS);
    expect(parseSoundSettings('pas du json')).toEqual(EMPTY_SOUND_SETTINGS);
    expect(parseSoundSettings('{"music":{"accueil":42}}')).toEqual(EMPTY_SOUND_SETTINGS);
  });

  it('complète les emplacements absents par null sans perdre les autres', () => {
    const parsed = parseSoundSettings(JSON.stringify({ music: { fin: 'abc' } }));
    expect(parsed.music.fin).toBe('abc');
    expect(parsed.music.accueil).toBeNull();
    expect(Object.keys(parsed.sfx).sort()).toEqual([...SFX_NAMES].sort());
  });

  it('couvre exactement les emplacements prévus', () => {
    expect(Object.keys(EMPTY_SOUND_SETTINGS.music).sort()).toEqual([...MUSIC_SLOTS].sort());
    expect(Object.keys(EMPTY_SOUND_SETTINGS.sfx).sort()).toEqual([...SFX_NAMES].sort());
    expect(soundSettingsSchema.safeParse(EMPTY_SOUND_SETTINGS).success).toBe(true);
  });

  it('règle le volume de chaque musique entre 0 et 100, 50 par défaut', () => {
    expect(EMPTY_SOUND_SETTINGS.musicVolume.accueil).toBe(50);
    const parsed = parseSoundSettings(JSON.stringify({ musicVolume: { accueil: 80, menus: 101, fin: -3 } }));
    expect(parsed.musicVolume.accueil).toBe(80);
    expect(parsed.musicVolume.menus).toBe(50);
    expect(parsed.musicVolume.fin).toBe(50);
    expect(
      soundSettingsSchema.safeParse({
        ...EMPTY_SOUND_SETTINGS,
        musicVolume: { ...EMPTY_SOUND_SETTINGS.musicVolume, fin: 101 },
      }).success,
    ).toBe(false);
  });
});

describe('Volume général des bruitages', () => {
  it('vaut 100 par défaut, soit le niveau d’origine', () => {
    expect(EMPTY_SOUND_SETTINGS.sfxVolume).toBe(100);
    expect(parseSoundSettings(undefined).sfxVolume).toBe(100);
    expect(
      soundSettingsSchema.parse({
        music: EMPTY_SOUND_SETTINGS.music,
        musicVolume: EMPTY_SOUND_SETTINGS.musicVolume,
        sfx: EMPTY_SOUND_SETTINGS.sfx,
      }).sfxVolume,
    ).toBe(100);
  });

  it('lit une valeur valide et ignore une valeur hors plage', () => {
    expect(parseSoundSettings(JSON.stringify({ sfxVolume: 40 })).sfxVolume).toBe(40);
    expect(parseSoundSettings(JSON.stringify({ sfxVolume: 150 })).sfxVolume).toBe(100);
    expect(parseSoundSettings(JSON.stringify({ sfxVolume: 'fort' })).sfxVolume).toBe(100);
  });
});
