import type { AvatarInfo } from '@partyhub/shared';
import { defaultAvatarFor } from '@partyhub/shared';

/** Avatar d'un joueur sans profil : emoji et teinte dérivés de son pseudo. */
export function guestAvatar(name: string): AvatarInfo {
  const { emoji, hue } = defaultAvatarFor(name);
  return { emoji, hue, imageUrl: null };
}
