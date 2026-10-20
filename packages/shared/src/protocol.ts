import type { LobbyMoodChoice, LobbyMoodEvent, LobbyPosition, LobbyPositionEvent } from './lobby-presence.js';
import type { GameCategory, GameNotice, GameRelease, ScoreEntry } from './game-types.js';
import type { GameDetails } from './schemas.js';
import type { DeviceInfo, DeviceKind } from './devices.js';
import type { SettingsBounds } from './settings-form.js';
import type { CharacterSpec } from './characters.js';
import type { SensorEvent, SensorSample } from './sensors.js';

export type { DeviceInfo, DeviceKind };

export type { ScoreEntry, GameCategory, GameNotice, GameRelease };

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
  /** Le jeu s’appuie sur une IA quand elle est configurée (filtre « Avec IA » du catalogue). */
  ai: boolean;
  /** Jeu de code : adresse de son bundle de vues (iframe). Absent pour les autres jeux. */
  codeView?: { url: string; sha256: string };
  /** Journal des versions, la plus récente en premier. Absent pour un jeu sans journal (paquets importés). */
  changelog?: readonly GameRelease[];
}

/** Apparence d’un joueur : image de profil si elle existe, sinon emoji sur une teinte. */
export interface AvatarInfo {
  hue: number;
  emoji: string;
  imageUrl: string | null;
  /** Personnage dessiné. Absent ou null : le joueur garde l’emoji (anciens profils). */
  character?: CharacterSpec | null;
}

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  /** Place du personnage dans le salon ; absent ou null tant que le joueur n’a pas bougé. */
  position?: LobbyPosition | null;
  bot: boolean;
  /** Vrai si le joueur est connecté à un profil enregistré. */
  profile: boolean;
  avatar: AvatarInfo;
  /** Types des appareils connectés à cette place (un par socket). Vide pour un robot ou une place absente. */
  devices: DeviceKind[];
  /** Équipe du joueur (indice dans `series.teams`), ou null quand il n’y a pas d’équipes. */
  team: number | null;
}

/** Réglages du championnat du salon : nombre de manches (1 = partie unique) et d’équipes (0 = sans équipes). */
export interface ChampionshipSettings {
  length: number;
  teams: number;
}

/** Rang de progression d’un joueur pendant le championnat (Recrue, Habitué, …). */
export interface SeriesTierView {
  id: string;
  label: string;
  icon: string;
}

/** Icône de victoire gagnée pendant le championnat. */
export interface SeriesBadgeView {
  id: string;
  icon: string;
  label: string;
}

export interface SeriesStandingView {
  playerId: string;
  name: string;
  points: number;
  rank: number;
  wins: number;
  podiums: number;
  played: number;
  tier: SeriesTierView;
  badges: SeriesBadgeView[];
  team: number | null;
}

export interface SeriesTeamView {
  index: number;
  name: string;
  icon: string;
  color: string;
  points: number;
  rank: number;
  members: string[];
}

export interface SeriesHistoryView {
  index: number;
  game: string;
  winners: string[];
}

/** Championnat du salon, tel qu’il est affiché : classements, équipes, historique et vainqueur. */
export interface SeriesView {
  length: number;
  played: number;
  finished: boolean;
  standings: SeriesStandingView[];
  teams: SeriesTeamView[] | null;
  history: SeriesHistoryView[];
  /** Vainqueur quand le championnat est terminé : un ou plusieurs noms (ex æquo), ou l’équipe gagnante. */
  champion: { names: string[]; team: number | null } | null;
}

/** Classement de la dernière partie terminée : le podium à médailles s’affiche pour n’importe quel jeu. */
export interface LastResultView {
  game: string;
  ranking: Array<{ playerId: string; name: string; points: number; rank: number }>;
}

/** Nombre et types des observateurs (personnes qui regardent sans jouer). */
export interface ObserverSummary {
  count: number;
  devices: DeviceKind[];
}

/** Message de discussion ou réaction, relayé à toute la salle (rien n’est conservé côté serveur). */
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

/** Voix jouée sur l’écran principal, déclenchée depuis le téléphone d’un joueur. */
export interface VoiceEvent {
  id: string;
  playerId: string;
  from: string;
  avatar: AvatarInfo;
  /** Nom donné à la voix par le joueur (affiché sur l’écran). */
  name: string;
  /** Identifiant de la voix : l’écran la télécharge depuis /api/voices/:id. */
  voiceId: string;
}

export interface LobbyView {
  code: string;
  status: RoomStatus;
  /** Vrai pendant une pause de l’écran principal : l’horloge de la partie est figée. */
  paused: boolean;
  game: GameInfo;
  gameSettings: Record<string, unknown>;
  practice: boolean;
  maxPlayers: number;
  players: PublicPlayer[];
  readyCount: number;
  observers: ObserverSummary;
  championship: ChampionshipSettings;
  series: SeriesView | null;
  lastResult: LastResultView | null;
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
 * Vue d’un observateur : le salon et l’état public de la partie, jamais l’état réservé à
 * l’hôte (bonnes réponses, rôles secrets, mains cachées).
 */
export interface ObserverRoomView {
  now: number;
  lobby: LobbyView;
  game: { public: unknown } | null;
}

/** D’où vient le jeu : code de l’application, jeu de cartes, questions médias, plateau ou paquet importé. */
export type GameOrigin = 'builtin' | 'cards' | 'media' | 'board' | 'package';

export interface CatalogGame extends GameInfo {
  enabled: boolean;
  /** Faux pour un outil (plateau de test) : il n’est proposé qu’à l’administration. */
  listed: boolean;
  /** D’où vient le jeu : code de l’application, jeu de cartes ou jeu de questions médias. */
  origin: GameOrigin;
  /** Notice affichée (défaut du jeu ou surcharge de l’administration). */
  notice: GameNotice;
  /** Notice par défaut du code, pour pouvoir la restaurer. */
  defaultNotice: GameNotice;
  customNotice: boolean;
  /** Nom, icône et description du code, pour pouvoir les restaurer. */
  defaultDetails: GameDetails;
  /** Vrai si l’administrateur a modifié le nom, l’icône ou la description. */
  customDetails: boolean;
  /** Réglages effectifs : ceux de l’administration s’ils existent, sinon ceux du jeu. */
  settings: Record<string, unknown>;
  /** Réglages par défaut du code du jeu, pour pouvoir les restaurer. */
  defaultSettings: Record<string, unknown>;
  /** Vrai si l’administrateur a enregistré des réglages par défaut pour ce jeu. */
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

/** Message renvoyé quand le jeton de profil n’est plus valable : le téléphone retire alors ce profil. */
export const PROFILE_SESSION_EXPIRED = 'Votre session de profil a expiré. Choisissez un profil sur cet appareil.';

export interface ProfileView {
  /** Vrai si la photo est visible des autres joueurs pendant les parties. */
  avatarShared: boolean;
  /** Faux pour un profil « nom seul » : pas de mot de passe, donc pas de changement de mot de passe. */
  hasPassword: boolean;
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
  // Hôte (écran principal) — réservé au socket qui a présenté le jeton d’hôte
  /** screen : cet écran est l’écran principal de la salle (il joue les voix). */
  'host:connect': (p: { code: string; hostToken: string; screen?: boolean }, ack: Ack) => void;
  /** Code à 6 chiffres pour ouvrir l’écran hôte sur un autre appareil (valable 3 minutes, une fois). */
  'host:handoff': (ack: Ack<{ code: string; expiresAt: number }>) => void;
  /** Un téléphone saisit le code de transfert : il reçoit le jeton d’hôte de la salle. */
  'host:claim': (p: { code: string; handoffCode: string }, ack: Ack<{ hostToken: string }>) => void;
  'host:configure': (p: { gameSettings: Record<string, unknown> }, ack: Ack) => void;
  /** Championnat du salon (avant la partie) : nombre de manches et d’équipes. */
  'host:championship': (p: ChampionshipSettings, ack: Ack) => void;
  'host:start': (ack: Ack) => void;
  'host:next': (ack: Ack) => void;
  'host:end': (ack: Ack) => void;
  'host:replay': (ack: Ack) => void;
  /** Met la partie en pause (décomptes, robots et actions des joueurs suspendus), ou la reprend. */
  'host:pause': (p: { paused: boolean }, ack: Ack) => void;
  'host:kick': (p: { playerId: string }, ack: Ack) => void;
  'host:close': (ack: Ack) => void;
  'host:addBot': (ack: Ack) => void;
  'host:removeBot': (p: { playerId: string }, ack: Ack) => void;
  'host:chat': (p: { text: string }, ack: Ack) => void;
  'host:reaction': (p: { emoji: string }, ack: Ack) => void;
  /** Action du jeu demandée par l’écran principal (ex. générer des personnages), sans joueur attribué. */
  'host:game-action': (p: { type: string; payload?: unknown }, ack: Ack) => void;

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
  'player:lobby-move': (p: LobbyPosition, ack: Ack) => void;
  'player:lobby-mood': (p: LobbyMoodChoice, ack: Ack) => void;
  'player:voice': (p: { id: string }, ack: Ack) => void;
  /** Capteurs du téléphone : pas d’accusé, relayé seulement aux écrans pendant une partie. */
  'player:sensor': (p: SensorSample) => void;

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
  'room:lobby-mood': (e: LobbyMoodEvent) => void;
  'room:lobby-position': (e: LobbyPositionEvent) => void;
  'room:voice': (e: VoiceEvent) => void;
  'room:sensor': (e: SensorEvent) => void;
}
