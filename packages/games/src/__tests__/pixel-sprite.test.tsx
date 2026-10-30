import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CharacterSpec } from '@partyhub/shared';
import { PixelSprite, pixelBitmapFor } from '../client/index.js';

/** Sprite pixel : rendu statique (le dessin dans le canvas se fait côté navigateur). */

const SPEC: CharacterSpec = { body: 1, skin: 2, hair: 3, hairColor: 2, accessory: 4, facialHair: 1, eyeColor: 2 };

describe('PixelSprite', () => {
  it('rend un canvas 32 × 32 net, nommé pour les lecteurs d’écran', () => {
    const html = renderToStaticMarkup(<PixelSprite spec={SPEC} kind="face" index={2} />);
    expect(html).toContain('<canvas');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Visage du personnage, expression tres-joyeux"');
    expect(html).toContain('width="32"');
    expect(html).toContain('height="32"');
    expect(html).toContain('image-rendering:pixelated');
    expect(html).toContain('width:128px');
  });

  it('agrandit à l’entier et accepte un libellé propre', () => {
    const html = renderToStaticMarkup(
      <PixelSprite
        spec={SPEC}
        kind="walk"
        dir="side"
        frame={1}
        scale={2.4}
        mirrored
        label="Ana marche vers la gauche"
      />,
    );
    expect(html).toContain('aria-label="Ana marche vers la gauche"');
    expect(html).toContain('width:64px');
    expect(html).toContain('data-pixel-kind="walk"');
  });

  it('une pose ou un visage inconnu retombe sur le premier, sans erreur', () => {
    expect(() => renderToStaticMarkup(<PixelSprite spec={SPEC} kind="pose" index={99} />)).not.toThrow();
    expect(() => renderToStaticMarkup(<PixelSprite spec={SPEC} kind="face" index={-1} />)).not.toThrow();
    expect(Array.from(pixelBitmapFor(SPEC, 'pose', 99).pixels)).toEqual(
      Array.from(pixelBitmapFor(SPEC, 'pose', 0).pixels),
    );
  });

  it('choisit le bon dessin pour chaque genre', () => {
    const face = pixelBitmapFor(SPEC, 'face', 'surpris');
    const walk = pixelBitmapFor(SPEC, 'walk', 0, 1, 'back');
    const pose = pixelBitmapFor(SPEC, 'pose', 'coucou');
    for (const b of [face, walk, pose]) expect([b.width, b.height]).toEqual([32, 32]);
    expect(Array.from(face.pixels)).not.toEqual(Array.from(walk.pixels));
    expect(Array.from(walk.pixels)).not.toEqual(Array.from(pose.pixels));
  });
});
