import { useEffect, useState, useSyncExternalStore } from 'react';
import { isMuted, onMuteChange, playLoopFile, setSfxFiles, setSoundLevels, stopLoopFile } from '@partyhub/games/client';
import { authHeaders, readProfileToken } from './profile/session.js';
import { SFX_NAMES, type MusicSlot, type SfxName } from '@partyhub/shared';
import { api } from './api.js';

/**
 * Sons choisis dans l’administration : musique de fond des menus, de l’accueil et de la fin de partie,
 * et bruitages des jeux. Chaque appareil joue ce qui concerne la page qu’il affiche.
 */

export interface PublicSounds {
  music: Record<MusicSlot, string | null>;
  /** Volume de chaque musique, de 0 à 100. */
  musicVolume: Record<MusicSlot, number>;
  /** Volume général des bruitages, de 0 à 100. */
  sfxVolume: number;
  sfx: Record<SfxName, string | null>;
}

/** Volume général (administration) et volume du profil connecté, en pourcentage. */
let adminSfxVolume = 100;
let profileVolume = { music: 100, sfx: 100 };

function applyVolumes(): void {
  setSoundLevels({ sfx: (adminSfxVolume * profileVolume.sfx) / 100, music: profileVolume.music });
}

/** Volume de la musique choisi par le profil, de 0 à 1 : multiplie le volume de l'emplacement. */
export function profileMusicFactor(): number {
  return profileVolume.music / 100;
}

/** Applique le volume du profil : les bruitages et la musique suivent tout de suite. */
export function setProfileSoundVolume(volume: { music: number; sfx: number }): void {
  profileVolume = volume;
  applyVolumes();
  publishSounds(sounds);
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

/**
 * Bruitages livrés avec l’application (`public/sons/bruitages/`) : ils remplacent les sons synthétisés tant que
 * l’administration n’a pas choisi de fichier pour l’emplacement.
 */
export const DEFAULT_SFX_FILES: Record<SfxName, string> = Object.fromEntries(
  SFX_NAMES.map((name) => [name, `/sons/bruitages/${name}.mp3`]),
) as Record<SfxName, string>;

/** Réglages globaux complétés par les bruitages livrés : un emplacement vide prend le fichier par défaut. Fonction pure. */
export function withDefaultSfx(global: Partial<Record<SfxName, string | null>>): Record<SfxName, string> {
  const out = { ...DEFAULT_SFX_FILES };
  for (const name of SFX_NAMES) {
    const chosen = global[name];
    if (chosen) out[name] = chosen;
  }
  return out;
}

/** Règle la table des bruitages : ceux du jeu affiché d’abord, puis les réglages globaux, puis les fichiers livrés. */
function applySfx(): void {
  setSfxFiles(mergeSfxFiles(withDefaultSfx(sounds?.sfx ?? {}), gameSfx));
}

/** Jeux intégrés qui ont une musique de partie livrée (`public/sons/musiques/<jeu>.mp3`). */
const BUILTIN_MUSIC = new Set([
  'association',
  'aventure-ia',
  'banquise',
  'bombes-party',
  'boum',
  'cartes-coco',
  'cartes-couleurs',
  'essai-appareils',
  'funambule',
  'gags-en-rafale',
  'imite-moi',
  'imposteur',
  'loups-village',
  'micro-defis',
  'mots-croises',
  'phrases-trous',
  'plus-ou-moins',
  'plutot-qui',
  'poker-texas',
  'president',
  'promoteur',
  'quiz-party',
  'rami-51',
  'reflexe',
  'sauteurs',
  'solitaire',
  'sudoku',
  'taquin',
  'tarot',
]);

/** Jeux sans piste propre : ils empruntent celle d’un jeu proche. */
const BORROWED_MUSIC: Record<string, string> = {
  'photo-mystere': 'quiz-party',
  'tirage-surprise': 'quiz-party',
};

/** Musique de partie livrée pour un jeu intégré, ou null. Fonction pure. */
export function builtinGameMusic(gameId: string): string | null {
  const id = BORROWED_MUSIC[gameId] ?? gameId;
  return BUILTIN_MUSIC.has(id) ? `/sons/musiques/${id}.mp3` : null;
}

function publishSounds(next: PublicSounds | null): void {
  sounds = next;
  adminSfxVolume = next?.sfxVolume ?? 100;
  applyVolumes();
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
  // Le volume du profil connecté (s'il y en a un) s'applique à toutes les pages.
  if (readProfileToken()) {
    try {
      const me = await api<{ profile: { soundVolume: { music: number; sfx: number } } }>('/api/profiles/me', {
        headers: authHeaders(),
      });
      setProfileSoundVolume(me.profile.soundVolume);
    } catch {
      /* sans profil valide, le volume reste celui de l'administration */
    }
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
    if (!gameId) return;
    if (!isImportedGame(gameId)) {
      // Jeu intégré : bruitages globaux, et sa musique livrée pendant la partie.
      setPartie(builtinGameMusic(gameId));
      return;
    }
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
