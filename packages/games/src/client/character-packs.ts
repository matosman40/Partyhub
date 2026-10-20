import { useEffect, useSyncExternalStore } from 'react';
import type { CharacterPackInfo } from '@partyhub/shared';
import { loadMediaBytes } from './media-relay.js';

/**
 * Liste des packs de personnages (sprites importés dans l’administration).
 * Chargée une seule fois par page, partagée par tous les personnages affichés.
 * Sans réseau ou pack supprimé, le personnage dessiné prend le relais.
 */

type Status = 'idle' | 'loading' | 'ready' | 'error';
export interface CharacterPackState {
  status: Status;
  packs: CharacterPackInfo[];
}

const RETRY_MS = 15_000;
let state: CharacterPackState = { status: 'idle', packs: [] };
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: CharacterPackState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Charge la liste des packs. Un appel pendant un chargement réutilise la même requête. */
export function loadCharacterPacks(): Promise<void> {
  if (pending) return pending;
  publish({ ...state, status: 'loading' });
  pending = (async () => {
    try {
      const bytes = await loadMediaBytes('/api/character-packs');
      const body = JSON.parse(new TextDecoder().decode(bytes)) as { packs?: CharacterPackInfo[] };
      publish({ status: 'ready', packs: Array.isArray(body.packs) ? body.packs : [] });
    } catch {
      publish({ status: 'error', packs: state.packs });
      // Nouvelle tentative plus tard, sans boucle serrée si le réseau reste coupé.
      setTimeout(() => {
        if (state.status === 'error') void loadCharacterPacks();
      }, RETRY_MS);
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** Recharge la liste (après un import ou une suppression dans l’administration). */
export function refreshCharacterPacks(): Promise<void> {
  publish({ ...state, status: 'idle' });
  return loadCharacterPacks();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): CharacterPackState => state;
const getServerSnapshot = (): CharacterPackState => ({ status: 'idle', packs: [] });

/** État de la liste des packs ; lance le chargement la première fois. */
export function useCharacterPacks(): CharacterPackState {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (snapshot.status === 'idle') void loadCharacterPacks();
  }, [snapshot.status]);
  return snapshot;
}

/** Pack correspondant à un identifiant, ou null tant qu’il n’est pas chargé ou s’il n’existe plus. */
export function usePackInfo(id: string | null | undefined): CharacterPackInfo | null {
  const { packs } = useCharacterPacks();
  if (!id) return null;
  return packs.find((pack) => pack.id === id) ?? null;
}
