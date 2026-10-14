import { useState } from 'react';
import type { AvatarInfo } from '@partyhub/shared';
import { Character } from '@partyhub/games/client';

/**
 * Avatar d'un joueur : photo de profil si elle existe, sinon son personnage sur sa couleur de fond.
 * Si l'image ne charge pas, le personnage (ou l'emoji, pour un ancien profil) prend le relais.
 */
export function PlayerAvatar({
  avatar,
  name,
  size = 'md',
  highlight = false,
}: {
  avatar: AvatarInfo;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  highlight?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!avatar.imageUrl && !broken;
  return (
    <span
      className={`avatar avatar-${size}${highlight ? ' is-you' : ''}`}
      style={{ background: `hsl(${avatar.hue} 85% 66%)` }}
      aria-hidden="true"
      title={name}
    >
      {showImage ? (
        <img src={avatar.imageUrl ?? ''} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : avatar.character ? (
        <Character spec={avatar.character} framing="bust" />
      ) : (
        avatar.emoji
      )}
    </span>
  );
}
