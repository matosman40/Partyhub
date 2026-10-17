export type Platform = 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'autre';

/**
 * Système de l'appareil, d'après le navigateur. Un iPad qui se présente comme un Mac est reconnu grâce
 * à son écran tactile (plus d'un point de contact).
 */
export function detectPlatform(userAgent: string, touchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return 'autre';
}
