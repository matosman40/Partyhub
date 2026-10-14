import { describe, expect, it } from 'vitest';
import { openRoomsText } from '../admin/messages.js';

describe('message après modification d’un jeu intégré', () => {
  it('sans salle ouverte : les prochaines salles utilisent la version', () => {
    expect(openRoomsText(0)).toMatch(/prochaines salles/);
  });

  it('au singulier et au pluriel', () => {
    expect(openRoomsText(1)).toBe('1 salle déjà ouverte garde l’ancienne version jusqu’à leur fin.');
    expect(openRoomsText(3)).toBe('3 salles déjà ouvertes gardent l’ancienne version jusqu’à leur fin.');
  });
});
