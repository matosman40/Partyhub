import { describe, expect, it } from 'vitest';
import { FRAMES, SPRITE_H, SPRITE_W } from '../bombes-party/client/sprites.js';

describe('sprites du plateau : sourire', () => {
  it('le visage souriant garde la taille du personnage et ne change que la bouche', () => {
    const idle = FRAMES.front[0];
    const smile = FRAMES.smile[0];
    expect(smile).toHaveLength(SPRITE_H);
    for (const row of smile) expect(row).toHaveLength(SPRITE_W);
    // Seule la rangée de la bouche change ; le reste du personnage est identique.
    const changed = smile.map((row, y) => (row === idle[y] ? -1 : y)).filter((y) => y >= 0);
    expect(changed).toEqual([5]);
  });

  it('la danse alterne deux pas de la même taille, comme la marche', () => {
    expect(FRAMES.smile[1]).toHaveLength(SPRITE_H);
    expect(FRAMES.front[1]).toHaveLength(SPRITE_H);
  });
});
