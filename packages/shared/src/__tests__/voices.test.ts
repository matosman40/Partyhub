import { describe, expect, it } from 'vitest';
import { sniffAudioMime, voiceNameSchema, VOICE_NAME_MAX } from '../voices.js';

/**
 * Voix de profil : le format du son se reconnaît à ses premiers octets, et le nom saisi est court et lisible.
 */

const bytes = (...values: number[]) => Uint8Array.from([...values, ...new Array(16).fill(0)]);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

describe('Reconnaissance du format audio', () => {
  it('reconnaît WebM, OGG, WAV, MP4, MP3', () => {
    expect(sniffAudioMime(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('audio/webm');
    expect(sniffAudioMime(bytes(...ascii('OggS')))).toBe('audio/ogg');
    expect(sniffAudioMime(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBe('audio/wav');
    expect(sniffAudioMime(bytes(0, 0, 0, 0x20, ...ascii('ftypM4A ')))).toBe('audio/mp4');
    expect(sniffAudioMime(bytes(...ascii('ID3'), 4))).toBe('audio/mpeg');
    expect(sniffAudioMime(bytes(0xff, 0xfb, 0x90))).toBe('audio/mpeg');
  });

  it('refuse un texte, une image et un fichier trop court', () => {
    expect(sniffAudioMime(bytes(...ascii('hello')))).toBeNull();
    expect(sniffAudioMime(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffAudioMime(Uint8Array.from([0x1a, 0x45, 0xdf]))).toBeNull();
  });
});

describe('Nom d’une voix', () => {
  it('supprime les espaces autour et accepte les accents', () => {
    expect(voiceNameSchema.parse('  Bonne nuit  ')).toBe('Bonne nuit');
    expect(voiceNameSchema.parse('Vive la fête !')).toBe('Vive la fête !');
  });

  it('refuse un nom vide, trop long ou avec un caractère de contrôle', () => {
    expect(voiceNameSchema.safeParse('   ').success).toBe(false);
    expect(voiceNameSchema.safeParse('x'.repeat(VOICE_NAME_MAX + 1)).success).toBe(false);
    expect(voiceNameSchema.safeParse('a\u0007b').success).toBe(false);
  });
});
