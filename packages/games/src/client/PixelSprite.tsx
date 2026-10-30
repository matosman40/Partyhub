import { useEffect, useMemo, useRef } from 'react';
import {
  PIXEL_CELL,
  PIXEL_FACES,
  PIXEL_POSES,
  bitmapToRgba,
  drawFace,
  drawPose,
  drawWalk,
  mirrorBitmap,
  type CharacterSpec,
  type PixelBitmap,
  type PixelDir,
  type PixelFace,
  type PixelPose,
} from '@partyhub/shared';

/**
 * Personnage pixel d’un joueur : un visage, une image de marche ou une pose, dessinés par le rendeur pixel de `shared`.
 * Un seul petit canvas 32 × 32, agrandi par le navigateur sans lissage (`image-rendering: pixelated`) : le sprite reste
 * net à n’importe quelle taille, et le fond est transparent.
 */

export interface PixelSpriteProps {
  spec: CharacterSpec;
  /** `face` : portrait (8 expressions) ; `walk` : marche (4 images, 3 directions) ; `pose` : corps entier (8 poses). */
  kind: 'face' | 'walk' | 'pose';
  /** Visage ou pose : numéro (0 à 7) ou nom. Absent : le premier. */
  index?: number | PixelFace | PixelPose;
  /** Marche : image du cycle (0 à 3). */
  frame?: 0 | 1 | 2 | 3;
  /** Marche : de face, de dos ou de profil vers la droite. */
  dir?: PixelDir;
  /** Agrandissement entier : un pixel du sprite occupe `scale` pixels CSS. 4 par défaut. */
  scale?: number;
  /** Miroir horizontal (profil vers la gauche, par exemple). */
  mirrored?: boolean;
  /** Texte lu par les lecteurs d’écran. Par défaut, une description du sprite. */
  label?: string;
  className?: string;
}

/** Bitmap demandé par les props (sans miroir). */
export function pixelBitmapFor(
  spec: CharacterSpec,
  kind: PixelSpriteProps['kind'],
  index: PixelSpriteProps['index'] = 0,
  frame: 0 | 1 | 2 | 3 = 0,
  dir: PixelDir = 'front',
): PixelBitmap {
  if (kind === 'walk') return drawWalk(spec, dir, frame);
  if (kind === 'pose') {
    const pose = typeof index === 'number' ? PIXEL_POSES[index] : index;
    return drawPose(spec, PIXEL_POSES.find((p) => p === pose) ?? 'repos');
  }
  const face = typeof index === 'number' ? PIXEL_FACES[index] : index;
  return drawFace(spec, PIXEL_FACES.find((f) => f === face) ?? 'neutre');
}

function describe(kind: PixelSpriteProps['kind'], index: PixelSpriteProps['index'], dir: PixelDir): string {
  if (kind === 'walk')
    return `Personnage en marche, ${dir === 'front' ? 'de face' : dir === 'back' ? 'de dos' : 'de profil'}`;
  if (kind === 'pose')
    return `Personnage en pose ${(typeof index === 'number' ? PIXEL_POSES[index] : index) ?? 'repos'}`;
  return `Visage du personnage, expression ${(typeof index === 'number' ? PIXEL_FACES[index] : index) ?? 'neutre'}`;
}

export function PixelSprite({
  spec,
  kind,
  index,
  frame = 0,
  dir = 'front',
  scale = 4,
  mirrored = false,
  label,
  className,
}: PixelSpriteProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Les pages recréent souvent l’objet `spec` à l’identique : on redessine seulement si son contenu change.
  const specKey = JSON.stringify(spec);
  const bitmap = useMemo(() => {
    const b = pixelBitmapFor(JSON.parse(specKey) as CharacterSpec, kind, index, frame, dir);
    return mirrored ? mirrorBitmap(b) : b;
  }, [specKey, kind, index, frame, dir, mirrored]);
  const size = PIXEL_CELL * Math.max(1, Math.round(scale));

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(bitmap.width, bitmap.height);
    image.data.set(bitmapToRgba(bitmap, 1, null));
    ctx.putImageData(image, 0, 0);
  }, [bitmap]);

  return (
    <canvas
      ref={ref}
      className={className}
      width={PIXEL_CELL}
      height={PIXEL_CELL}
      role="img"
      aria-label={label ?? describe(kind, index, dir)}
      data-pixel-kind={kind}
      style={{ width: size, height: size, imageRendering: 'pixelated', display: 'inline-block' }}
    />
  );
}
