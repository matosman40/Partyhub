import { z } from 'zod';

/**
 * Type d'appareil. Le navigateur le déduit de sa taille, de son pointeur et de son identifiant ;
 * le serveur ne voit que l'identifiant (User-Agent) et s'en sert quand rien d'autre n'est connu.
 * L'utilisateur peut toujours corriger le choix sur son appareil.
 */
export const DEVICE_KINDS = ['phone', 'tablet', 'tv', 'desktop', 'unknown'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  phone: 'Téléphone',
  tablet: 'Tablette',
  tv: 'Écran TV',
  desktop: 'Ordinateur',
  unknown: 'Appareil',
};

export const DEVICE_KIND_ICONS: Record<DeviceKind, string> = {
  phone: '📱',
  tablet: '📲',
  tv: '📺',
  desktop: '💻',
  unknown: '❔',
};

/** Ce que l'appareil déclare de lui-même à la connexion. Indications seulement : jamais de secret. */
export interface DeviceInfo {
  kind: DeviceKind;
  /** Taille de la fenêtre, en pixels CSS. */
  width?: number;
  height?: number;
  touch?: boolean;
  orientation?: 'portrait' | 'landscape';
}

export const deviceInfoSchema = z.object({
  kind: z.enum(DEVICE_KINDS),
  width: z.number().int().min(0).max(20000).optional(),
  height: z.number().int().min(0).max(20000).optional(),
  touch: z.boolean().optional(),
  orientation: z.enum(['portrait', 'landscape']).optional(),
});

/** Signaux disponibles pour deviner le type d'appareil. Tous optionnels. */
export interface DeviceSignals {
  userAgent?: string;
  maxTouchPoints?: number;
  width?: number;
  height?: number;
  /** Le doigt est le pointeur principal (écran tactile sans souris). */
  coarsePointer?: boolean;
  /** Un pointeur fin (souris) peut survoler les éléments. */
  canHover?: boolean;
}

// Ordre important : un téléviseur peut annoncer « Android » ; une tablette « Android » n'a pas « Mobile ».
const TV_UA =
  /SmartTV|SMART-TV|Smart-TV|Tizen|Web0S|WebOS|AppleTV|GoogleTV|Android TV|BRAVIA|HbbTV|CrKey|Roku|NetCast|Viera/i;
// Un iPad ancien annonce aussi « Mobile » : la tablette doit être reconnue avant le téléphone.
const TABLET_NAMED_UA = /iPad|Tablet|PlayBook|Silk|Kindle/i;
const PHONE_UA = /iPhone|iPod|Windows Phone|Mobile/i;
// Android sans « Mobile » dans la parenthèse du système : tablette (le téléphone l'annonce).
const ANDROID_TABLET_UA = /Android(?![^)]*Mobile)/i;
const DESKTOP_UA = /Windows NT|Macintosh|X11|Linux x86_64|CrOS/i;

/** Seuil à partir duquel un écran tactile est une tablette (en pixels, côté le plus court). */
export const TABLET_MIN_SHORT_SIDE = 600;

/**
 * Devine le type d'appareil à partir des signaux disponibles.
 * Un identifiant explicite prime ; sinon la taille et le pointeur tranchent.
 */
export function classifyDevice(signals: DeviceSignals): DeviceKind {
  const ua = signals.userAgent ?? '';
  const shortSide =
    signals.width !== undefined && signals.height !== undefined ? Math.min(signals.width, signals.height) : undefined;

  if (TV_UA.test(ua)) return 'tv';
  if (TABLET_NAMED_UA.test(ua)) return 'tablet';
  if (PHONE_UA.test(ua)) return 'phone';
  if (ANDROID_TABLET_UA.test(ua)) return 'tablet';
  // iPadOS 13+ se présente comme un Mac : un « Mac » tactile est une tablette.
  if (/Macintosh/i.test(ua) && (signals.maxTouchPoints ?? 0) > 1) return 'tablet';

  if (signals.coarsePointer === true) {
    return shortSide !== undefined && shortSide >= TABLET_MIN_SHORT_SIDE ? 'tablet' : 'phone';
  }
  // Grand écran sans souris ni doigt : un téléviseur (navigateur de salon, box connectée).
  if (signals.canHover === false && (signals.width ?? 0) >= 1600) return 'tv';
  if (signals.canHover === true || DESKTOP_UA.test(ua)) return 'desktop';
  return 'unknown';
}

/** Déduit le type à partir de l'identifiant seul (ce que le serveur peut savoir à la connexion). */
export function deviceKindFromUserAgent(userAgent: string | undefined): DeviceKind {
  return classifyDevice({ userAgent: userAgent ?? '' });
}

/** Orientation déduite des dimensions. */
export function orientationOf(width: number, height: number): 'portrait' | 'landscape' {
  return width >= height ? 'landscape' : 'portrait';
}

/** Taille de base par type d'appareil : un téléviseur se regarde de loin, une tablette se tient en main. */
const BASE_SCALE: Record<DeviceKind, number> = {
  phone: 1,
  tablet: 1.1,
  desktop: 1,
  tv: 1.25,
  unknown: 1,
};

/**
 * Facteur d'affichage (taille du texte et des commandes). Il augmente avec la résolution :
 * plus l'écran a de pixels, plus l'interface est agrandie, pour rester lisible à la même distance.
 * Le calcul utilise les pixels CSS (la taille logique), pas la densité : un Mac Retina reste à 1.
 */
export function uiScaleFor(kind: DeviceKind, width: number, height: number): number {
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  let growth = 1;
  if (kind === 'tv' || kind === 'desktop' || kind === 'unknown') {
    if (longSide >= 3200) growth = 1.5;
    else if (longSide >= 2560) growth = 1.3;
    else if (longSide >= 1920) growth = 1.15;
  } else if (kind === 'phone') {
    if (shortSide >= 430) growth = 1.08;
  } else if (kind === 'tablet') {
    if (longSide >= 1366) growth = 1.12;
  }
  const scale = BASE_SCALE[kind] * growth;
  return Math.round(Math.min(1.8, Math.max(0.9, scale)) * 100) / 100;
}
