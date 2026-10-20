import type {
  CharacterExpression,
  CharacterMood,
  CharacterPackAtlasName,
  CharacterPackInfo,
  CharacterPackLook,
} from '@partyhub/shared';
import { MediaImage } from './media-relay.js';

/**
 * Affichage d’un look de pack de sprites. La case de la planche est découpée par un viewBox SVG : le dessin
 * se redimensionne comme le personnage dessiné (même balise racine, même ratio).
 *
 * Correspondance attitude → case, selon les noms proposés dans le pack (voir docs/PERSONNAGES-PACK.md).
 * Une case absente retombe sur la case par défaut de la planche.
 */

/** Portrait (avatars) : planche « visages ». */
export const PACK_BUST_FACE: Record<CharacterMood, string> = {
  idle: 'neutre',
  joy: 'tres_joyeuse',
  sad: 'triste',
  wave: 'clin_doeil',
  dance: 'contente',
};

/**
 * Visages demandés (émotions du salon, expression du profil) → case de la planche « visages ».
 * Une case absente du pack retombe sur l’attitude du moment.
 */
export const PACK_FACE_CASE: Record<CharacterExpression, string> = {
  calme: 'neutre',
  souriant: 'contente',
  rieur: 'tres_joyeuse',
  clin: 'clin_doeil',
  triste: 'triste',
  etonne: 'surpris',
};

/** Corps entier : planche « poses ». */
export const PACK_FULL_POSE: Record<CharacterMood, string> = {
  idle: 'repos',
  joy: 'joie',
  sad: 'triste',
  wave: 'coucou',
  dance: 'victoire',
};

const DEFAULT_CASE: Record<CharacterPackAtlasName, string> = { visages: 'neutre', poses: 'repos', marche: 'face1' };

/** Adresse PNG d’une planche d’un look. Revalidée à chaque affichage : un look peut être remplacé. */
export function packAtlasUrl(packId: string, lookId: string, atlas: CharacterPackAtlasName): string {
  return `/api/character-packs/${encodeURIComponent(packId)}/looks/${encodeURIComponent(lookId)}/atlas/${atlas}.png`;
}

export interface PackFigureProps {
  pack: CharacterPackInfo;
  look: CharacterPackLook;
  mood?: CharacterMood;
  /** Visage à montrer sur le portrait (absent : celui de l’attitude). */
  face?: CharacterExpression;
  framing?: 'full' | 'bust';
  label?: string;
  className?: string;
}

export function PackFigure({ pack, look, mood = 'idle', face, framing = 'full', label, className }: PackFigureProps) {
  const wantsBust = framing === 'bust';
  const atlasName: CharacterPackAtlasName | null = wantsBust
    ? look.atlases.visages
      ? 'visages'
      : look.atlases.poses
        ? 'poses'
        : null
    : look.atlases.poses
      ? 'poses'
      : look.atlases.visages
        ? 'visages'
        : null;
  const atlas = atlasName ? look.atlases[atlasName] : undefined;
  if (!atlasName || !atlas) return null;

  const wanted = atlasName === 'visages' ? (face ? PACK_FACE_CASE[face] : PACK_BUST_FACE[mood]) : PACK_FULL_POSE[mood];
  const image =
    atlas.images.find((img) => img.name === wanted) ??
    atlas.images.find((img) => img.name === DEFAULT_CASE[atlasName]) ??
    atlas.images[0];
  if (!image) return null;

  return (
    <svg
      className={`chara chara--${mood} chara-pack${className ? ` ${className}` : ''}`}
      viewBox={`${image.x} ${image.y} ${image.w} ${image.h}`}
      style={{ width: '100%', height: 'auto', display: 'block', aspectRatio: `${image.w} / ${image.h}` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-pack={pack.id}
      data-look={look.id}
    >
      <MediaImage
        url={packAtlasUrl(pack.id, look.id, atlasName)}
        x={0}
        y={0}
        width={atlas.width}
        height={atlas.height}
      />
    </svg>
  );
}
