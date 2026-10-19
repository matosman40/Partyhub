import { useEffect, useState, useSyncExternalStore } from 'react';
import { isMuted, onMuteChange, playLoopFile, setSfxFiles, stopLoopFile } from '@partyhub/games/client';
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
/** Bruitages du jeu affiché (paquet importé) : ils remplacent les bruitages globaux pendant que sa salle est ouverte. */
let gameSfx: Partial<Record<SfxName, string>> = {};

/** Fusion des bruitages : ceux du jeu affiché l’emportent, les réglages globaux restent pour le reste. Fonction pure. */
export function mergeSfxFiles(
  global: Partial<Record<SfxName, string | null>>,
  game: Partial<Record<SfxName, string>>,
): Partial<Record<SfxName, string | null>> {
  return { ...global, ...game };
}

/** Règle la table des bruitages : ceux du jeu affiché d’abord, puis les réglages globaux. */
function applySfx(): void {
  setSfxFiles(mergeSfxFiles(sounds?.sfx ?? {}, gameSfx));
}

function publishSounds(next: PublicSounds | null): void {
  sounds = next;
  applySfx();
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
 * Sons d’un jeu importé (format 4) : bruitages et musique de partie, décrits par le paquet. Seuls les jeux du registre
 * importés (préfixes pkg-, pkgb-, pkgq-, pkgr-) en ont. Un jeu intégré à l’application garde les sons globaux.
 */

export interface GameSounds {
  sfx: Partial<Record<SfxName, string>>;
  music: { partie?: string };
}

const NO_GAME_SOUNDS: GameSounds = { sfx: {}, music: {} };
const IMPORTED_GAME = /^pkg[bqr]?-/;

/** Vrai pour un jeu importé d’un paquet (identifiant du registre). Les jeux intégrés n’ont pas de sons de paquet. */
export function isImportedGame(gameId: string): boolean {
  return IMPORTED_GAME.test(gameId);
}

/** Sons d’un jeu, par identifiant. Un échec laisse les sons globaux. */
export async function loadGameSounds(gameId: string): Promise<GameSounds> {
  try {
    const res = await api<GameSounds>(`/api/game-sounds/${encodeURIComponent(gameId)}`);
    return { sfx: res.sfx ?? {}, music: res.music ?? {} };
  } catch {
    return NO_GAME_SOUNDS;
  }
}

/**
 * Pendant que la salle d’un jeu importé est affichée : ses bruitages remplacent les globaux, et sa musique de partie
 * tourne quand `playing` est vrai (écran principal seulement). Tout est rendu à la sortie de la salle.
 */
export function usePackageSounds(gameId: string | null, playing: boolean): void {
  const [partie, setPartie] = useState<string | null>(null);
  useEffect(() => {
    setPartie(null);
    if (!gameId || !isImportedGame(gameId)) return;
    let current = true;
    void loadGameSounds(gameId).then((game) => {
      if (!current) return;
      gameSfx = game.sfx;
      applySfx();
      setPartie(game.music.partie ?? null);
    });
    return () => {
      current = false;
      gameSfx = {};
      applySfx();
    };
  }, [gameId]);
  useEffect(() => {
    if (!playing || !partie) return;
    playLoopFile(partie);
    return () => stopLoopFile();
  }, [playing, partie]);
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
