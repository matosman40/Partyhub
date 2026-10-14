import type { GameCategory, GameNotice, ScoreEntry } from './game-types.js';
import type { GameDetails } from './schemas.js';
import type { DeviceInfo, DeviceKind } from './devices.js';
import type { SettingsBounds } from './settings-form.js';
import type { CharacterSpec } from './characters.js';

export type { DeviceInfo, DeviceKind };

export type { ScoreEntry, GameCategory, GameNotice };

export type RoomStatus = 'waiting' | 'full' | 'in_game' | 'ended';

export interface GameInfo {
  id: string;
  category: GameCategory;
  notice: GameNotice;
  name: string;
  description: string;
  icon: string;
  version: string;
  minPlayers: number;
  maxPlayers: number;
  durationMin: number;
  /** Bornes des réglages numériques : le formulaire les affiche telles quelles. */
  settingsBounds: SettingsBounds;
}

/** Apparence d'un joueur : image de profil si elle existe, sinon emoji sur une teinte. */
export interface AvatarInfo {
  hue: number;
  emoji: string;
  imageUrl: string | null;
  /** Personnage dessiné. Absent ou null : le joueur garde l'emoji (anciens profils). */
  character?: CharacterSpec | null;
}

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  bot: boolean;
  /** Vrai si le joueur est connecté à un profil enregistré. */
  profile: boolean;
  avatar: AvatarInfo;
  /** Types des appareils connectés à cette place (un par socket). Vide pour un robot ou une place absente. */
  devices: DeviceKind[];
}

/** Nombre et types des observateurs (personnes qui regardent sans jouer). */
export interface ObserverSummary {
  count: number;
  devices: DeviceKind[];
}

/** Message de discussion ou réaction, relayé à toute la salle (rien n'est conservé côté serveur). */
export interface ChatMessage {
  id: string;
  from: string;
  avatar: AvatarInfo;
  text: string;
  at: number;
}

export interface ReactionEvent {
  id: string;
  from: string;
  emoji: string;
}

export interface LobbyView {
  code: string;
  status: RoomStatus;
  game: GameInfo;
  gameSettings: Record<string, unknown>;
  practice: boolean;
  maxPlayers: number;
  players: PublicPlayer[];
  readyCount: number;
  observers: ObserverSummary;
}

export interface HostRoomView {
  now: number;
  lobby: LobbyView;
  game: { public: unknown; host: unknown } | null;
}

export interface PlayerRoomView {
  now: number;
  lobby: LobbyView;
  you: { id: string; name: string; ready: boolean; avatar: AvatarInfo; profile: boolean };
  game: { public: unknown; player: unknown } | null;
}

/**
 * Vue d'un observateur : le salon et l'état public de la partie, jamais l'état réservé à
 * l'hôte (bonnes réponses, rôles secrets, mains cachées).
 */
export interface ObserverRoomView {
  now: number;
  lobby: LobbyView;
  game: { public: unknown } | null;
}

/** D'où vient le jeu : code de l'application, jeu de cartes, questions médias, plateau ou paquet importé. */
export type GameOrigin = 'builtin' | 'cards' | 'media' | 'board' | 'package';

export interface CatalogGame extends GameInfo {
  enabled: boolean;
  /** D'où vient le jeu : code de l'application, jeu de cartes ou jeu de questions médias. */
  origin: GameOrigin;
  /** Notice affichée (défaut du jeu ou surcharge de l'administration). */
  notice: GameNotice;
  /** Notice par défaut du code, pour pouvoir la restaurer. */
  defaultNotice: GameNotice;
  customNotice: boolean;
  /** Nom, icône et description du code, pour pouvoir les restaurer. */
  defaultDetails: GameDetails;
  /** Vrai si l'administrateur a modifié le nom, l'icône ou la description. */
  customDetails: boolean;
  /** Réglages effectifs : ceux de l'administration s'ils existent, sinon ceux du jeu. */
  settings: Record<string, unknown>;
  /** Réglages par défaut du code du jeu, pour pouvoir les restaurer. */
  defaultSettings: Record<string, unknown>;
  /** Vrai si l'administrateur a enregistré des réglages par défaut pour ce jeu. */
  customSettings: boolean;
  /** Vrai si des réglages enregistrés ne correspondent plus au schéma du jeu : ils sont ignorés. */
  settingsStale: boolean;
}

export interface ProfileStats {
  played: number;
  wins: number;
  points: number;
  perGame: { gameId: string; name: string; played: number; wins: number; points: number }[];
}

export interface ProfileView {
  /** Vrai si la photo est visible des autres joueurs pendant les parties. */
  avatarShared: boolean;
  id: string;
  username: string;
  displayName: string;
  avatar: AvatarInfo;
  createdAt: string;
  stats: ProfileStats;
}

/** Réponse à une commande. Toujours `ok` + éventuelle erreur lisible. */
export type Ack<T extends object = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  // Hôte (écran principal) — réservé au socket qui a présenté le jeton d'hôte
  'host:connect': (p: { code: string; hostToken: string }, ack: Ack) => void;
  'host:configure': (p: { gameSettings: Record<string, unknown> }, ack: Ack) => void;
  'host:start': (ack: Ack) => void;
  'host:next': (ack: Ack) => void;
  'host:end': (ack: Ack) => void;
  'host:replay': (ack: Ack) => void;
  'host:kick': (p: { playerId: string }, ack: Ack) => void;
  'host:close': (ack: Ack) => void;
  'host:addBot': (ack: Ack) => void;
  'host:removeBot': (p: { playerId: string }, ack: Ack) => void;
  'host:chat': (p: { text: string }, ack: Ack) => void;
  'host:reaction': (p: { emoji: string }, ack: Ack) => void;

  // Joueurs (smartphones)
  'player:join': (
    p: { code: string; name: string; token?: string; profileToken?: string; device?: DeviceInfo },
    ack: Ack<{ playerId: string; token: string }>,
  ) => void;
  'player:ready': (p: { ready: boolean }, ack: Ack) => void;
  'player:action': (
    p: { commandId: string; type: string; payload?: unknown },
    ack: Ack<{ duplicate: boolean }>,
  ) => void;
  'player:leave': (ack: Ack) => void;
  'player:chat': (p: { text: string }, ack: Ack) => void;
  'player:reaction': (p: { emoji: string }, ack: Ack) => void;

  // Observateurs (regardent le plateau sans jouer ; aucune action de jeu)
  'observer:join': (p: { code: string; device?: DeviceInfo }, ack: Ack) => void;
  'observer:chat': (p: { text: string }, ack: Ack) => void;
  'observer:reaction': (p: { emoji: string }, ack: Ack) => void;
  'observer:leave': (ack: Ack) => void;
}

export interface ServerToClientEvents {
  'room:host': (view: HostRoomView) => void;
  'room:player': (view: PlayerRoomView) => void;
  'room:observer': (view: ObserverRoomView) => void;
  'room:closed': (p: { reason: 'closed' | 'kicked' | 'inactive' }) => void;
  'room:chat': (m: ChatMessage) => void;
  'room:reaction': (r: ReactionEvent) => void;
}
