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
});
