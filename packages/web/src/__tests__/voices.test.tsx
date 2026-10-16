import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AvatarInfo, VoiceClip, VoiceEvent } from '@partyhub/shared';
import { VoiceBanner } from '../components/VoiceLayer.js';
import { enqueueVoice, voiceUrl, VOICE_QUEUE_MAX } from '../components/voiceQueue.js';
import { VoiceChoices } from '../seat/VoiceBar.js';
import { VoiceRow } from '../profile/VoicesSection.js';
import { checkVoiceFile, defaultVoiceName, pickRecordingType } from '../profile/voiceRecording.js';

/**
 * Voix de profil côté navigateur : file de lecture sur l’écran, bandeau, boutons du téléphone,
 * ligne de gestion du profil et choix de l’enregistrement (format, nom, taille et durée).
 */

const avatar: AvatarInfo = { hue: 200, emoji: '🙂', imageUrl: null };

function voice(id: string, from = 'Léa'): VoiceEvent {
  return { id: `ev-${id}`, playerId: 'p1', from, avatar, name: 'Fanfare', voiceId: id };
}

describe('File de lecture des voix', () => {
  it('garde l’ordre d’arrivée et écarte les voix au-delà de la file', () => {
    let queue: VoiceEvent[] = [];
    for (let i = 0; i < VOICE_QUEUE_MAX + 2; i++) queue = enqueueVoice(queue, voice(`v${i}`));
    expect(queue).toHaveLength(VOICE_QUEUE_MAX);
    expect(queue[0]!.voiceId).toBe('v0');
    expect(queue.at(-1)!.voiceId).toBe(`v${VOICE_QUEUE_MAX - 1}`);
  });

  it('ne modifie pas la file précédente', () => {
    const before = [voice('a')];
    const after = enqueueVoice(before, voice('b'));
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });

  it('construit une adresse de son sûre', () => {
    expect(voiceUrl('abc-123')).toBe('/api/voices/abc-123');
    expect(voiceUrl('a/b?c')).toBe('/api/voices/a%2Fb%3Fc');
  });
});

describe('Bandeau de l’écran principal', () => {
  it('dit qui parle et quelle voix joue', () => {
    const html = renderToStaticMarkup(<VoiceBanner voice={voice('x')} blocked={false} onRetry={() => undefined} />);
    expect(html).toContain('Léa');
    expect(html).toContain('« Fanfare »');
    expect(html).toContain('voice-wave');
    expect(html).not.toContain('Activer le son');
  });

  it('propose d’activer le son quand le navigateur le bloque', () => {
    const html = renderToStaticMarkup(<VoiceBanner voice={voice('x')} blocked onRetry={() => undefined} />);
    expect(html).toContain('Activer le son');
    expect(html).toContain('is-blocked');
    expect(html).not.toContain('voice-wave');
  });
});

describe('Boutons des voix sur le téléphone', () => {
  const voices: VoiceClip[] = [
    { id: 'v1', name: 'Fanfare', createdAt: '2026-10-16T10:00:00.000Z' },
    { id: 'v2', name: 'Oups', createdAt: '2026-10-16T10:01:00.000Z' },
  ];

  it('affiche un bouton par voix', () => {
    const html = renderToStaticMarkup(<VoiceChoices voices={voices} notice={null} onPlay={() => undefined} />);
    expect(html).toContain('Mes voix');
    expect(html).toContain('>Fanfare<');
    expect(html).toContain('>Oups<');
  });

  it('affiche le retour de l’envoi, bon ou refusé', () => {
    const sent = renderToStaticMarkup(
      <VoiceChoices
        voices={voices}
        notice={{ ok: true, text: '« Fanfare » envoyée à l’écran.' }}
        onPlay={() => undefined}
      />,
    );
    expect(sent).toContain('envoyée à l’écran');
    const refused = renderToStaticMarkup(
      <VoiceChoices
        voices={voices}
        notice={{ ok: false, text: 'Aucun écran principal n’est connecté' }}
        onPlay={() => undefined}
      />,
    );
    expect(refused).toContain('class="error small"');
  });
});

describe('Gestion d’une voix dans le profil', () => {
  const clip: VoiceClip = { id: 'v1', name: 'Fanfare', createdAt: '2026-10-16T10:00:00.000Z' };

  it('pré-remplit le nom et propose Écouter et Supprimer', () => {
    const html = renderToStaticMarkup(
      <VoiceRow voice={clip} onPlay={() => undefined} onRename={() => undefined} onRemove={() => undefined} />,
    );
    expect(html).toContain('value="Fanfare"');
    expect(html).toContain('Écouter');
    expect(html).toContain('Supprimer');
    expect(html).not.toContain('Renommer');
  });
});

describe('Choix de l’enregistrement', () => {
  it('prend le premier format que le navigateur sait enregistrer', () => {
    const onlyMp4 = (t: string) => t === 'audio/mp4';
    expect(pickRecordingType(onlyMp4)).toBe('audio/mp4');
    expect(pickRecordingType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecordingType(() => false)).toBe('');
  });

  it('propose le premier nom « Voix n » libre', () => {
    const named = (names: string[]): VoiceClip[] => names.map((name, i) => ({ id: `${i}`, name, createdAt: '' }));
    expect(defaultVoiceName([])).toBe('Voix 1');
    expect(defaultVoiceName(named(['Voix 1', 'Voix 3']))).toBe('Voix 2');
    expect(defaultVoiceName(named(['Voix 1', 'Voix 2', 'Voix 3', 'Voix 4', 'Voix 5']))).toBe('Voix');
  });

  it('refuse un fichier trop lourd ou trop long, et accepte un enregistrement de durée inconnue', () => {
    expect(checkVoiceFile(400 * 1024, 3)).toMatch(/300 Ko/);
    expect(checkVoiceFile(20 * 1024, 9)).toMatch(/5 secondes maximum/);
    expect(checkVoiceFile(20 * 1024, 5)).toBeNull();
    expect(checkVoiceFile(20 * 1024, Number.POSITIVE_INFINITY)).toBeNull();
    expect(checkVoiceFile(20 * 1024, Number.NaN)).toBeNull();
  });
});
