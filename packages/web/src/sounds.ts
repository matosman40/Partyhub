import { useEffect, useSyncExternalStore } from 'react';
import { isMuted, onMuteChange, setSfxFiles } from '@partyhub/games/client';
import type { MusicSlot, SfxName } from '@partyhub/shared';
import { api } from './api.js';

/**
 * Sons choisis dans l’administration : musique de fond des menus, de l’accueil et de la fin de partie,
 * et bruitages des jeux. Chaque appareil joue ce qui concerne la page qu’il affiche.
 */

export interface PublicSounds {
  music: Record<MusicSlot, string | null>;
  /** Volume de chaque musique, de 0 à 100. */
  musicVolume: Record<MusicSlot, number>;
  sfx: Record<SfxName, string | null>;
}

let sounds: PublicSounds | null = null;
const soundListeners = new Set<() => void>();

function publishSounds(next: PublicSounds | null): void {
  sounds = next;
  setSfxFiles(next?.sfx ?? {});
  for (const listener of soundListeners) listener();
}

/** Charge les sons publics. Un échec laisse les bruitages d’origine et la musique coupée. */
export async function loadSoundSettings(): Promise<void> {
  try {
    const res = await api<{ sounds: PublicSounds }>('/api/sound-settings');
    publishSounds(res.sounds);
  } catch {
    publishSounds(null);
  }
}

export function usePublicSounds(): PublicSounds | null {
  return useSyncExternalStore(
    (listener) => {
      soundListeners.add(listener);
      return () => {
        soundListeners.delete(listener);
      };
    },
    () => sounds,
    () => null,
  );
}

/*
 * Demandes de musique : chaque page réclame un emplacement pendant qu’elle est affichée. La dernière
 * réclamation encore vivante l’emporte ; quand une page se ferme, elle libère sa place.
 */

interface Claim {
  token: symbol;
  slot: MusicSlot;
}

const claims: Claim[] = [];
const claimListeners = new Set<() => void>();

function notifyClaims(): void {
  for (const listener of claimListeners) listener();
}

/** Réclame un emplacement de musique ; renvoie la fonction qui le libère. */
export function claimMusic(slot: MusicSlot): () => void {
  const claim: Claim = { token: Symbol(slot), slot };
  claims.push(claim);
  notifyClaims();
  return () => {
    const index = claims.indexOf(claim);
    if (index >= 0) claims.splice(index, 1);
    notifyClaims();
  };
}

/** Emplacement actif : celui de la dernière réclamation vivante. */
export function activeMusicSlot(): MusicSlot | null {
  return claims.at(-1)?.slot ?? null;
}

/** Réclame un emplacement pendant la durée de la page ; `null` ne réclame rien (silence). */
export function useMusicSlot(slot: MusicSlot | null): void {
  useEffect(() => {
    if (!slot) return;
    return claimMusic(slot);
  }, [slot]);
}

export function useActiveMusicSlot(): MusicSlot | null {
  return useSyncExternalStore(
    (listener) => {
      claimListeners.add(listener);
      return () => {
        claimListeners.delete(listener);
      };
    },
    activeMusicSlot,
    () => null,
  );
}

/** Slot de musique d’un salon, selon son état : menus avant la partie, fin de partie aux résultats. */
export function musicForLobby(status: string | undefined): MusicSlot | null {
  if (status === 'ended') return 'fin';
  if (status === 'waiting' || status === 'full') return 'menus';
  return null;
}

/** Vrai quand le bouton muet est coupé (le son reste réglable depuis le bouton de la page). */
export function useMuted(): boolean {
  return useSyncExternalStore(
    (listener) => onMuteChange(() => listener()),
    () => isMuted(),
    () => false,
  );
}
