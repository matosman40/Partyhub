import { describe, expect, it } from 'vitest';
import { forbiddenReason, validateEntry } from '../boum/bank/validate.js';

describe('Insultes dures', () => {
  it('refuse une insulte entière, quelle que soit la casse et les accents', () => {
    expect(forbiddenReason('Tu es vraiment un CONNARD')).not.toBeNull();
    expect(forbiddenReason('Quel enculé !')).not.toBeNull();
    expect(validateEntry({ type: 'situation', level: 'doux', text: 'Tu es une salope.' }).ok).toBe(false);
  });

  it('laisse passer les mots proches qui ne sont pas une insulte', () => {
    expect(forbiddenReason('Un pédalo sur le lac')).toBeNull();
    expect(forbiddenReason('Le contenu du frigo')).toBeNull();
    expect(forbiddenReason('Un con de bois')).toBeNull();
    expect(validateEntry({ type: 'metier', level: 'doux', text: 'Conducteur de pédalo' }).ok).toBe(true);
  });
});
