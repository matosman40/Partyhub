/** Emojis proposés comme avatar par défaut. Liste fermée : rien d'autre n'est accepté. */
export const AVATAR_EMOJIS = [
  '🦊',
  '🐙',
  '🐸',
  '🦄',
  '🐼',
  '🐵',
  '🤖',
  '👾',
  '🐧',
  '🦉',
  '🐯',
  '🐨',
  '🦖',
  '🐝',
  '🍕',
  '🎃',
] as const;

export type AvatarEmoji = (typeof AVATAR_EMOJIS)[number];

/** Teinte stable dérivée d'un texte (pseudo, identifiant) : même texte, même couleur partout. */
export function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Avatar par défaut pour un texte donné (emoji et teinte déterministes). */
export function defaultAvatarFor(seed: string): { emoji: AvatarEmoji; hue: number } {
  const h = hashText(seed);
  return { emoji: AVATAR_EMOJIS[h % AVATAR_EMOJIS.length]!, hue: (h >>> 8) % 360 };
}
