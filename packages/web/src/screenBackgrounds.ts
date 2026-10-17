import { useSyncExternalStore } from 'react';
import { api } from './api.js';

/**
 * Fonds d’écran choisis dans l’administration : une image de la médiathèque par écran.
 * Les adresses publiques viennent de /api/screen-backgrounds ; sans réponse, le décor d’origine reste.
 */

export const SCREEN_KEYS = ['home', 'join', 'tv', 'player', 'spectator', 'profile'] as const;
export type ScreenKey = (typeof SCREEN_KEYS)[number];

/** Adresse publique d’image (ou null pour le décor d’origine), par écran. */
export type ScreenBackgroundUrls = Record<ScreenKey, string | null>;

export const SCREEN_LABELS: Record<ScreenKey, string> = {
  home: 'Accueil',
  join: 'Rejoindre une salle',
  tv: 'Écran principal (salon et partie)',
  player: 'Téléphone et tablette (joueur)',
  spectator: 'Spectateur',
  profile: 'Profil',
};

let current: ScreenBackgroundUrls | null = null;
const listeners = new Set<() => void>();

function publish(next: ScreenBackgroundUrls | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Charge les fonds publics. Un échec laisse le décor d’origine partout. */
export async function loadScreenBackgrounds(): Promise<void> {
  try {
    const res = await api<{ backgrounds: ScreenBackgroundUrls }>('/api/screen-backgrounds');
    publish(res.backgrounds);
  } catch {
    publish(null);
  }
}

export function useScreenBackgrounds(): ScreenBackgroundUrls | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Écran affiché pour une adresse ; null pour les pages sans fond à personnaliser. */
export function screenForPath(pathname: string): ScreenKey | null {
  if (pathname === '/') return 'home';
  if (pathname === '/join') return 'join';
  if (pathname.startsWith('/tv/')) return 'tv';
  if (pathname.startsWith('/j/')) return 'player';
  if (pathname.startsWith('/spectate/')) return 'spectator';
  if (pathname === '/profil') return 'profile';
  return null;
}

/** Adresse de l’image d’un écran, ou null si l’écran garde son décor d’origine. */
export function backgroundFor(backgrounds: ScreenBackgroundUrls | null, screen: ScreenKey | null): string | null {
  if (!backgrounds || !screen) return null;
  return backgrounds[screen];
}
