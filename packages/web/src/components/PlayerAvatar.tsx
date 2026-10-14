import { useState } from 'react';
import type { AvatarInfo } from '@partyhub/shared';

/**
 * Avatar d'un joueur : photo de profil si elle existe, sinon emoji sur une teinte stable.
 * Si l'image ne charge pas, l'emoji prend le relais.
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
      ) : (
        avatar.emoji
      )}
    </span>
  );
}
