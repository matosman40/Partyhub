import { describe, expect, it } from 'vitest';
import { CODE_VIEW_MESSAGE, isCodeMediaUrl } from '@partyhub/shared';
import { viewEntrySource } from '../code-games/view-entry.js';

describe('médias relayés aux vues des jeux de code', () => {
  it('ne sert que la bibliothèque, les avatars et les images générées', () => {
    expect(isCodeMediaUrl('/api/assets/3f9c2a1b')).toBe(true);
    expect(isCodeMediaUrl('/api/ai-images/portrait-1.png')).toBe(true);
    expect(isCodeMediaUrl('/api/character-packs')).toBe(true);
    expect(isCodeMediaUrl('/api/character-packs/mon-pack/looks/cowboy/atlas/visages.png')).toBe(true);
  });

  it('refuse toute autre adresse : autres routes, chemins relatifs, adresses externes', () => {
    for (const url of [
      '/api/admin/store',
      '/api/code-games/x/y/view.html',
      '/api/assets/',
      '/api/assets/../admin',
      '/api/character-packs/../../x',
      '/api/assets/a b',
      'https://evil.example/api/assets/x',
      '//evil.example/api/assets/x',
      'api/assets/x',
      '/api/assets/x\\y',
      '',
    ]) {
      expect(isCodeMediaUrl(url), url).toBe(false);
    }
  });

  it('la vue reçoit le relais des médias et la table des bruitages, sans accès réseau', () => {
    const source = viewEntrySource();
    expect(source).toContain('__partyhubMedia');
    expect(source).toContain(`"${CODE_VIEW_MESSAGE.media}"`);
    expect(source).toContain(`"${CODE_VIEW_MESSAGE.mediaReply}"`);
    expect(source).toContain('__partyhubSfxSink');
    expect(source).not.toMatch(/\bfetch\(/);
  });
});
