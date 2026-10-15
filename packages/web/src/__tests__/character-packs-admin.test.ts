import { describe, expect, it } from 'vitest';
import { suggestPackName } from '../admin/CharacterPacksAdmin.js';

describe('nom proposé pour un pack importé', () => {
  it('reprend le nom après « sprites » et met les mots en majuscule', () => {
    expect(suggestPackName('86b0ee2c-PartyHub-sprites-Dewi-Sri.zip')).toBe('Dewi Sri');
  });

  it('garde le nom du fichier quand il ne contient pas « sprites »', () => {
    expect(suggestPackName('lea_fille.zip')).toBe('Lea Fille');
  });
});
