import { clampLobbyPosition, type LobbyPosition } from '@partyhub/shared';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { settingsIssueMessage, type DeviceKind, type ObserverRoomView, type ObserverSummary } from '@partyhub/shared';
import type {
  AvatarInfo,
  AiClient,
  GameInfo,
  GameJob,
  GameModule,
  GameNotice,
  GameResult,
  HostRoomView,
  JobOutcome,
  LobbyView,
  PlayerRef,
  PlayerRoomView,
  PublicPlayer,
  RoomStatus,
  ScoreEntry,
} from '@partyhub/shared';
import type { Logger } from '../logger.js';
import { gameInfo } from '../catalog.js';
import { guestAvatar } from '../avatars.js';

/** Résultat d'une commande sans données particulières. */
export type Outcome = { ok: true } | { ok: false; error: string };
/** Résultat d'une commande qui renvoie des données. */
export type Result<T extends object> = ({ ok: true } & T) | { ok: false; error: string };

export interface RoomPlayer {
  id: string;
  name: string;
  token: string;
  ready: boolean;
  /** Sockets actuellement rattachées (un joueur peut avoir plusieurs onglets ou appareils). */
  sockets: Set<string>;
  /** Identifiants de commandes déjà traitées, pour ignorer les doublons. */
  seenCommands: Set<string>;
  graceTimer?: NodeJS.Timeout;
  /** Robot du mode test : aucune socket, il joue seul via le moteur. */
  bot: boolean;
  /** Profil enregistré relié à ce joueur, sinon null (invité). */
  profileId: string | null;
  avatar: AvatarInfo;
}

export interface RoomEnv {
  now: () => number;
  random: () => number;
  logger: Logger;
  maxPlayers: () => number;
  graceMs: () => number;
  /** Notice affichée pour un jeu (défaut du code ou surcharge de l'administration). */
  notice: (gameId: string) => GameNotice;
  /** Client d'IA générative, absent si aucune clé n'est configurée. Seul le lanceur de travaux s'en sert. */
  ai?: AiClient;
}

export interface RoomHooks {
  onChange: (room: Room) => void;
  onGameStarted: (room: Room) => void;
  onGameEnded: (room: Room) => void;
}

export interface JoinProfile {
  id: string;
  displayName: string;
  avatar: AvatarInfo;
}

export interface RoomOptions {
  practice: boolean;
}

const MAX_SEEN_COMMANDS = 200;
/** Nombre maximal d'observateurs par salle : ils regardent, sans peser sur la partie. */
export const MAX_OBSERVERS = 20;
const BOT_NAMES = ['Robo', 'Bip', 'Clic', 'Zed', 'Pixel', 'Ouistiti'];
const BOT_MIN_DELAY_MS = 700;
const BOT_JITTER_MS = 1300;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Une salle : hôte, joueurs (humains ou robots), jeu sélectionné et état de la partie.
 * Le serveur est l'unique autorité : les vues envoyées aux clients sont
 * construites ici, à partir de l'état complet.
 */
/** Durée et nombre d'essais d'un code de transfert d'hôte. */
export const HANDOFF_MS = 3 * 60_000;
export const HANDOFF_TRIES = 5;

export class Room {
  readonly id = randomUUID();
  readonly hostToken = newToken();
  readonly createdAt: number;
  readonly practice: boolean;
  lastActivity: number;
  status: RoomStatus = 'waiting';
  readonly players = new Map<string, RoomPlayer>();
  /** Place de chaque personnage dans le salon (perdue avec la salle, jamais enregistrée). */
  private readonly positions = new Map<string, LobbyPosition>();
  readonly hostSockets = new Set<string>();
  /** Sous-ensemble des sockets hôte : les écrans principaux (ils jouent les voix des joueurs). */
  private readonly screens = new Set<string>();
  /** Observateurs : socket -> type d'appareil. Ils ne jouent pas et ne comptent pas dans la partie. */
  readonly observers = new Map<string, DeviceKind>();
  /** Type d'appareil déclaré par chaque socket (hôte, joueur ou observateur). */
  private readonly socketDevice = new Map<string, DeviceKind>();

  private settings: Record<string, unknown>;
  private state: unknown;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly botTimers = new Map<string, { key: string; timer: NodeJS.Timeout }>();
  /** Travail du jeu en cours (ex. génération) : son identifiant et le moyen de l'annuler. */
  private running: { id: string; controller: AbortController } | null = null;
  /** Dernier travail terminé : un identifiant déjà traité n'est jamais relancé. */
  private finishedJobId: string | null = null;
  private readonly ctx: import('@partyhub/shared').GameContext;

  constructor(
    readonly code: string,
    readonly module: GameModule,
    private readonly env: RoomEnv,
    private readonly hooks: RoomHooks,
    options: RoomOptions = { practice: false },
  ) {
    this.practice = options.practice;
    this.createdAt = env.now();
    this.lastActivity = this.createdAt;
    this.settings = { ...(module.defaultSettings as Record<string, unknown>) };

    this.ctx = {
      now: () => this.env.now(),
      random: () => this.env.random(),
      schedule: (key, ms) => this.schedule(key, ms),
      cancel: (key) => this.cancelTimer(key),
      connectedPlayerIds: () => [...this.players.values()].filter((p) => p.bot || p.sockets.size > 0).map((p) => p.id),
      ...(env.ai ? { ai: env.ai } : {}),
    };
    this.state = module.initialize(this.settings, [], this.ctx);
  }

  // ---------------------------------------------------------------------------
  // Informations
  // ---------------------------------------------------------------------------

  get inLobby(): boolean {
    return this.status === 'waiting' || this.status === 'full';
  }

  get hasSockets(): boolean {
    return (
      this.hostSockets.size > 0 || this.observers.size > 0 || [...this.players.values()].some((p) => p.sockets.size > 0)
    );
  }

  /** Observateurs présents, par type d'appareil. */
  observerSummary(): ObserverSummary {
    return { count: this.observers.size, devices: [...this.observers.values()] };
  }

  /** Types d'appareils connectés, pour une place donnée. */
  private devicesOf(p: RoomPlayer): DeviceKind[] {
    return [...p.sockets].map((sid) => this.socketDevice.get(sid) ?? 'unknown');
  }

  get effectiveMaxPlayers(): number {
    return Math.min(this.env.maxPlayers(), this.module.manifest.maxPlayers);
  }

  touch(): void {
    this.lastActivity = this.env.now();
  }

  /**
   * Met à jour l'avatar des joueurs liés à ce profil (photo ajoutée, retirée ou non partagée).
   * La salle est prévenue seulement si quelque chose a changé.
   */
  refreshAvatar(profileId: string, avatar: AvatarInfo): void {
    let changed = false;
    for (const p of this.players.values()) {
      if (p.profileId !== profileId) continue;
      if (JSON.stringify(p.avatar) === JSON.stringify(avatar)) continue;
      p.avatar = avatar;
      changed = true;
    }
    if (changed) this.hooks.onChange(this);
  }

  summary() {
    const devices: Record<DeviceKind, number> = { phone: 0, tablet: 0, tv: 0, desktop: 0, unknown: 0 };
    for (const kind of this.socketDevice.values()) devices[kind]++;
    return {
      code: this.code,
      gameId: this.module.manifest.id,
      gameName: this.module.manifest.name,
      status: this.status,
      players: this.players.size,
      bots: [...this.players.values()].filter((p) => p.bot).length,
      connected: [...this.players.values()].filter((p) => p.bot || p.sockets.size > 0).length,
      hostConnected: this.hostSockets.size > 0,
      observers: this.observers.size,
      devices,
      practice: this.practice,
      createdAt: new Date(this.createdAt).toISOString(),
      lastActivity: new Date(this.lastActivity).toISOString(),
    };
  }

  /** Sockets des écrans principaux (et seulement eux) : les voix des joueurs y sont jouées. */
  screenSocketIds(): string[] {
    return [...this.screens];
  }

  /** Profil lié à un joueur, ou null pour un invité. */
  profileOf(playerId: string): string | null {
    return this.players.get(playerId)?.profileId ?? null;
  }

  /** Identifiants de toutes les sockets de la salle (hôte, joueurs et observateurs), pour le relais de messages. */
  socketIds(): string[] {
    const ids = [...this.hostSockets, ...this.observers.keys()];
    for (const p of this.players.values()) ids.push(...p.sockets);
    return ids;
  }

  /** Nom et apparence d'un expéditeur de message, ou null si la personne n'est plus là. */
  senderOf(playerId: string): { name: string; avatar: AvatarInfo } | null {
    const p = this.players.get(playerId);
    return p ? { name: p.name, avatar: p.avatar } : null;
  }

  /** Nom affiché d'un observateur dans la discussion (« Observateur 2 »), ou null s'il est parti. */
  observerName(socketId: string): string | null {
    if (!this.observers.has(socketId)) return null;
    const index = [...this.observers.keys()].indexOf(socketId);
    return `Observateur ${index + 1}`;
  }

  /** Scores finaux (classement en compétition), utilisés pour les statistiques des profils. */
  finalScores(): ScoreEntry[] {
    return this.module.calculateScores(this.state);
  }

  // ---------------------------------------------------------------------------
  // Vues destinées aux clients
  // ---------------------------------------------------------------------------

  private lobbyView(): LobbyView {
    const players: PublicPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.bot || p.sockets.size > 0,
      ready: p.ready,
      bot: p.bot,
      profile: p.profileId !== null,
      avatar: p.avatar,
      devices: this.devicesOf(p),
      position: this.positions.get(p.id) ?? null,
    }));
    const game: GameInfo = { ...gameInfo(this.module), notice: this.env.notice(this.module.manifest.id) };
    return {
      code: this.code,
      status: this.status,
      game,
      gameSettings: this.settings,
      practice: this.practice,
      maxPlayers: this.effectiveMaxPlayers,
      players,
      readyCount: players.filter((p) => p.ready).length,
      observers: this.observerSummary(),
    };
  }

  hostView(): HostRoomView {
    return {
      now: this.env.now(),
      lobby: this.lobbyView(),
      game: this.inLobby
        ? null
        : {
            public: this.module.getPublicState(this.state),
            host: this.module.getHostState(this.state),
          },
    };
  }

  /** Vue d'un observateur : salon et état public uniquement (jamais l'état réservé à l'hôte). */
  observerView(): ObserverRoomView {
    return {
      now: this.env.now(),
      lobby: this.lobbyView(),
      game: this.inLobby ? null : { public: this.module.getPublicState(this.state) },
    };
  }

  playerView(playerId: string): PlayerRoomView | null {
    const p = this.players.get(playerId);
    if (!p) return null;
    return {
      now: this.env.now(),
      lobby: this.lobbyView(),
      you: { id: p.id, name: p.name, ready: p.ready, avatar: p.avatar, profile: p.profileId !== null },
      game: this.inLobby
        ? null
        : {
            public: this.module.getPublicState(this.state),
            player: this.module.getPlayerState(this.state, p.id),
          },
    };
  }

  // ---------------------------------------------------------------------------
  // Joueurs et sockets
  // ---------------------------------------------------------------------------

  private playerRefs(): PlayerRef[] {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name }));
  }

  private refreshStatus(): void {
    if (this.inLobby) {
      this.status = this.players.size >= this.effectiveMaxPlayers ? 'full' : 'waiting';
    }
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    const wanted = name.toLocaleLowerCase('fr');
    return [...this.players.values()].some((p) => p.id !== exceptId && p.name.toLocaleLowerCase('fr') === wanted);
  }

  /**
   * Un joueur entre dans la salle, ou reprend sa place :
   * - avec son jeton de place (même appareil) ;
   * - avec son profil (autre appareil) : la place du profil est retrouvée s'il est déjà dans la salle.
   * La reconnexion est toujours acceptée, même en pleine partie.
   */
  join(
    name: string,
    token: string | undefined,
    socketId: string,
    profile?: JoinProfile,
    kind: DeviceKind = 'unknown',
  ): Result<{ playerId: string; token: string }> {
    this.socketDevice.set(socketId, kind);
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) return this.attach(existing, socketId);
    }
    if (profile) {
      const existing = [...this.players.values()].find((p) => p.profileId === profile.id);
      if (existing) return this.attach(existing, socketId);
    }

    if (!this.inLobby) {
      return { ok: false, error: 'La partie a déjà commencé : impossible de rejoindre pour le moment.' };
    }

    const finalName = profile ? profile.displayName : name;
    if (this.nameTaken(finalName)) {
      return { ok: false, error: 'Ce pseudo est déjà pris dans cette salle.' };
    }
    if (this.players.size >= this.effectiveMaxPlayers) {
      return { ok: false, error: 'Salle complète.' };
    }

    const player: RoomPlayer = {
      id: randomUUID(),
      name: finalName,
      token: newToken(),
      ready: false,
      sockets: new Set([socketId]),
      seenCommands: new Set(),
      bot: false,
      profileId: profile?.id ?? null,
      avatar: profile?.avatar ?? guestAvatar(finalName),
    };
    this.players.set(player.id, player);
    this.state = this.module.onPlayerJoin(this.state, { id: player.id, name: player.name }, this.ctx);
    this.refreshStatus();
    this.touch();
    this.hooks.onChange(this);
    return { ok: true, playerId: player.id, token: player.token };
  }

  private attach(p: RoomPlayer, socketId: string): Result<{ playerId: string; token: string }> {
    this.clearGrace(p);
    p.sockets.add(socketId);
    this.touch();
    this.hooks.onChange(this);
    return { ok: true, playerId: p.id, token: p.token };
  }

  /** Retire un socket (hôte, joueur ou observateur). Une absence n'efface jamais un joueur tout de suite. */
  removeSocket(socketId: string): void {
    let changed = this.hostSockets.delete(socketId);
    this.screens.delete(socketId);
    changed = this.observers.delete(socketId) || changed;
    for (const p of this.players.values()) {
      if (p.sockets.delete(socketId)) {
        changed = true;
        if (p.sockets.size === 0) this.scheduleAbsence(p);
      }
    }
    this.socketDevice.delete(socketId);
    if (changed) {
      this.touch();
      this.hooks.onChange(this);
    }
  }

  /**
   * Transfert de l'accès hôte à un autre appareil (téléphone) : l'écran hôte affiche un code court,
   * valable quelques minutes, à usage unique. Le téléphone qui le saisit reçoit le jeton d'hôte.
   */
  private handoff: { code: string; expiresAt: number; attempts: number } | null = null;

  createHandoff(now = Date.now()): { code: string; expiresAt: number } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = now + HANDOFF_MS;
    this.handoff = { code, expiresAt, attempts: 0 };
    return { code, expiresAt };
  }

  claimHandoff(code: string, now = Date.now()): { ok: true; hostToken: string } | { ok: false; error: string } {
    const h = this.handoff;
    if (!h || now > h.expiresAt) {
      this.handoff = null;
      return { ok: false, error: 'Ce code a expiré. Demandez un nouveau code sur l’écran.' };
    }
    if (h.attempts >= HANDOFF_TRIES) {
      this.handoff = null;
      return { ok: false, error: 'Trop d’essais. Demandez un nouveau code sur l’écran.' };
    }
    h.attempts += 1;
    if (code !== h.code) return { ok: false, error: 'Code incorrect. Vérifiez le code affiché sur l’écran.' };
    this.handoff = null;
    return { ok: true, hostToken: this.hostToken };
  }

  attachHost(socketId: string, kind: DeviceKind = 'unknown', screen = false): void {
    this.hostSockets.add(socketId);
    if (screen) this.screens.add(socketId);
    else this.screens.delete(socketId);
    this.socketDevice.set(socketId, kind);
    this.touch();
    this.hooks.onChange(this);
  }

  /**
   * Un observateur rejoint la salle : il voit le plateau et la discussion, sans jouer.
   * Le nombre d'observateurs est limité pour éviter qu'une salle publique ne serve de diffusion.
   */
  joinObserver(socketId: string, kind: DeviceKind = 'unknown'): Outcome {
    if (this.observers.has(socketId)) return { ok: true };
    if (this.observers.size >= MAX_OBSERVERS) {
      return { ok: false, error: 'Trop d’observateurs dans cette salle pour le moment.' };
    }
    this.observers.set(socketId, kind);
    this.socketDevice.set(socketId, kind);
    this.touch();
    this.hooks.onChange(this);
    return { ok: true };
  }

  leaveObserver(socketId: string): void {
    if (!this.observers.delete(socketId)) return;
    this.socketDevice.delete(socketId);
    this.touch();
    this.hooks.onChange(this);
  }

  /** En salle d'attente, un joueur absent trop longtemps est retiré. */
  private scheduleAbsence(p: RoomPlayer): void {
    if (!this.inLobby) return;
    this.clearGrace(p);
    p.graceTimer = setTimeout(() => this.expireAbsent(p.id), this.env.graceMs());
    p.graceTimer.unref();
  }

  private expireAbsent(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || p.sockets.size > 0 || !this.inLobby) return;
    this.dropPlayer(p);
    this.env.logger.info({ event: 'room.player-removed', room: this.code }, 'Joueur absent retiré de la salle');
    this.touch();
    this.hooks.onChange(this);
  }

  private clearGrace(p: RoomPlayer): void {
    if (p.graceTimer) {
      clearTimeout(p.graceTimer);
      p.graceTimer = undefined;
    }
  }

  private dropPlayer(p: RoomPlayer): void {
    this.clearGrace(p);
    this.players.delete(p.id);
    this.positions.delete(p.id);
    this.state = this.module.onPlayerLeave(this.state, { id: p.id, name: p.name }, this.ctx);
    this.refreshStatus();
  }

  setReady(playerId: string, ready: boolean): Outcome {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: 'Joueur inconnu.' };
    if (!this.inLobby) return { ok: false, error: 'Le statut « prêt » ne sert qu’avant la partie.' };
    p.ready = ready;
    this.touch();
    this.hooks.onChange(this);
    return { ok: true };
  }

  /**
   * Place d'un personnage dans le salon (avant la partie uniquement). Pas de nouvelle vue complète :
   * la place est diffusée seule par le hub, pour ne pas renvoyer la salle à chaque pas.
   */
  setLobbyPosition(playerId: string, position: LobbyPosition): Result<{ position: LobbyPosition }> {
    if (!this.players.has(playerId)) return { ok: false, error: 'Joueur inconnu.' };
    if (!this.inLobby) return { ok: false, error: 'Les personnages ne se déplacent que dans le salon.' };
    const clamped = clampLobbyPosition(position);
    this.positions.set(playerId, clamped);
    return { ok: true, position: clamped };
  }

  /** Une émotion n'est possible que dans le salon ; le serveur la diffuse, rien n'est gardé. */
  lobbyMoodAllowed(playerId: string): Outcome {
    if (!this.players.has(playerId)) return { ok: false, error: 'Joueur inconnu.' };
    if (!this.inLobby) return { ok: false, error: 'Les émotions ne servent qu’avant la partie.' };
    return { ok: true };
  }

  /** Un joueur quitte volontairement la salle (avant la partie uniquement). */
  leave(playerId: string): Outcome {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: 'Joueur inconnu.' };
    if (!this.inLobby) return { ok: false, error: 'Impossible de quitter pendant la partie.' };
    this.dropPlayer(p);
    this.touch();
    this.hooks.onChange(this);
    return { ok: true };
  }

  kick(playerId: string): Result<{ sockets: string[] }> {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: 'Joueur inconnu.' };
    if (!this.inLobby) return { ok: false, error: 'Retrait impossible pendant la partie.' };
    const sockets = [...p.sockets];
    this.dropPlayer(p);
    this.touch();
    this.hooks.onChange(this);
    return { ok: true, sockets };
  }

  /** Ajoute un robot (mode test). Seulement avant la partie. */
  addBot(): Outcome {
    if (!this.inLobby) return { ok: false, error: 'Les robots s’ajoutent avant la partie.' };
    if (this.players.size >= this.effectiveMaxPlayers) return { ok: false, error: 'Salle complète.' };
    const name = BOT_NAMES.find((n) => !this.nameTaken(n)) ?? `Robo ${this.players.size + 1}`;
    const bot: RoomPlayer = {
      id: randomUUID(),
      name,
      token: newToken(),
      ready: true,
      sockets: new Set(),
      seenCommands: new Set(),
      bot: true,
      profileId: null,
      avatar: guestAvatar(name),
    };
    this.players.set(bot.id, bot);
    this.state = this.module.onPlayerJoin(this.state, { id: bot.id, name }, this.ctx);
    this.refreshStatus();
    this.touch();
    this.hooks.onChange(this);
    return { ok: true };
  }

  removeBot(playerId: string): Outcome {
    const p = this.players.get(playerId);
    if (!p || !p.bot) return { ok: false, error: 'Robot introuvable.' };
    if (!this.inLobby) return { ok: false, error: 'Retrait impossible pendant la partie.' };
    this.dropPlayer(p);
    this.touch();
    this.hooks.onChange(this);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Commandes de l'hôte
  // ---------------------------------------------------------------------------

  configure(settings: Record<string, unknown>): Outcome {
    if (!this.inLobby) return { ok: false, error: 'Les réglages sont verrouillés pendant la partie.' };
    const parsed = this.module.settingsSchema.safeParse(settings);
    if (!parsed.success) {
      return { ok: false, error: settingsIssueMessage(parsed.error) };
    }
    this.settings = parsed.data as Record<string, unknown>;
    this.state = this.module.initialize(this.settings, this.playerRefs(), this.ctx);
    this.touch();
    this.hooks.onChange(this);
    return { ok: true };
  }

  start(): Outcome {
    if (!this.inLobby) return { ok: false, error: 'Une partie est déjà en cours.' };
    const min = this.module.manifest.minPlayers;
    if (this.players.size < min) {
      return { ok: false, error: `Il faut au moins ${min} joueur${min > 1 ? 's' : ''} pour lancer la partie.` };
    }
    const result = this.safely(() => this.module.start(this.state, this.ctx));
    if (!result.ok) return { ok: false, error: result.error };
    this.state = result.state;
    this.status = 'in_game';
    this.hooks.onGameStarted(this);
    this.afterMutation();
    return { ok: true };
  }

  next(): Outcome {
    if (this.status !== 'in_game') return { ok: false, error: 'Aucune partie en cours.' };
    this.mutate((s) => this.module.nextRound(s, this.ctx));
    return { ok: true };
  }

  end(): Outcome {
    if (this.status !== 'in_game') return { ok: false, error: 'Aucune partie en cours.' };
    this.mutate((s) => this.module.end(s, this.ctx));
    return { ok: true };
  }

  replay(): Outcome {
    if (this.status !== 'ended') return { ok: false, error: 'Aucune partie terminée à rejouer.' };
    this.status = 'waiting';
    this.clearTimers();
    this.state = this.module.initialize(this.settings, this.playerRefs(), this.ctx);
    this.refreshStatus();
    this.touch();
    this.hooks.onChange(this);
    return { ok: true };
  }

  /**
   * Action de l'écran principal (ex. « générer des personnages ») : elle n'est attribuée à aucun joueur.
   * Le schéma déclaré par le jeu valide le payload, comme pour les actions des joueurs.
   */
  hostAction(type: string, payload: unknown): Outcome {
    if (this.status !== 'in_game') return { ok: false, error: 'Aucune partie en cours.' };
    const { hostActions, handleHostAction } = this.module;
    if (!hostActions || !handleHostAction || !Object.hasOwn(hostActions, type)) {
      return { ok: false, error: 'Action inconnue.' };
    }
    // Sans payload, l'action reçoit un objet vide : « régénérer » n'a rien à transmettre.
    const parsed = hostActions[type]!.safeParse(payload ?? {});
    if (!parsed.success) return { ok: false, error: 'Données invalides.' };

    const result = this.safely(() => handleHostAction.call(this.module, this.state, type, parsed.data, this.ctx));
    if (!result.ok) return { ok: false, error: result.error };
    this.state = result.state;
    this.afterMutation();
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Actions des joueurs
  // ---------------------------------------------------------------------------

  handleAction(playerId: string, commandId: string, type: string, payload: unknown): Result<{ duplicate: boolean }> {
    if (this.status !== 'in_game') return { ok: false, error: 'Aucune partie en cours.' };
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: 'Joueur inconnu.' };

    if (p.seenCommands.has(commandId)) return { ok: true, duplicate: true };
    p.seenCommands.add(commandId);
    if (p.seenCommands.size > MAX_SEEN_COMMANDS) {
      const oldest = p.seenCommands.values().next().value;
      if (oldest !== undefined) p.seenCommands.delete(oldest);
    }

    const res = this.apply(p, type, payload);
    if (!res.ok) return res;
    return { ok: true, duplicate: false };
  }

  /** Applique une action validée par le schéma du jeu (commun aux joueurs et aux robots). */
  private apply(p: RoomPlayer, type: string, payload: unknown): Outcome {
    if (!Object.hasOwn(this.module.actions, type)) {
      return { ok: false, error: 'Action inconnue.' };
    }
    const parsed = this.module.actions[type]!.safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'Données invalides.' };

    const result = this.safely(() =>
      this.module.handleAction(this.state, { id: p.id, name: p.name }, type, parsed.data, this.ctx),
    );
    if (!result.ok) return { ok: false, error: result.error };

    this.state = result.state;
    this.afterMutation();
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Robots (mode test)
  // ---------------------------------------------------------------------------

  /** Planifie les actions des robots dont le jeu propose une décision. */
  private scheduleBots(): void {
    if (this.status !== 'in_game' || !this.module.suggest) {
      this.clearBotTimers();
      return;
    }
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      const suggestion = this.module.suggest(this.state, p.id, this.env.random);
      const pending = this.botTimers.get(p.id);
      if (!suggestion) {
        if (pending) clearTimeout(pending.timer);
        this.botTimers.delete(p.id);
        continue;
      }
      if (pending && pending.key === suggestion.key) continue;
      if (pending) clearTimeout(pending.timer);
      const delay = BOT_MIN_DELAY_MS + Math.floor(this.env.random() * BOT_JITTER_MS);
      const timer = setTimeout(() => this.botAct(p.id), delay);
      timer.unref();
      this.botTimers.set(p.id, { key: suggestion.key, timer });
    }
  }

  /** Un robot joue : la décision est recalculée au moment d'agir, pas au moment de la planifier. */
  private botAct(botId: string): void {
    this.botTimers.delete(botId);
    if (this.status !== 'in_game') return;
    const bot = this.players.get(botId);
    if (!bot || !this.module.suggest) return;
    const suggestion = this.module.suggest(this.state, botId, this.env.random);
    if (!suggestion) return;
    const res = this.apply(bot, suggestion.type, suggestion.payload);
    if (!res.ok)
      this.env.logger.debug(
        { event: 'room.bot-refused', room: this.code, error: res.error },
        'Action de robot refusée',
      );
  }

  private clearBotTimers(): void {
    for (const { timer } of this.botTimers.values()) clearTimeout(timer);
    this.botTimers.clear();
  }

  // ---------------------------------------------------------------------------
  // Cycle de vie interne
  // ---------------------------------------------------------------------------

  /** Exécute une fonction du jeu sans laisser une exception faire tomber le serveur. */
  private safely<T>(fn: () => GameResult<T>): GameResult<T> {
    try {
      return fn();
    } catch (err) {
      this.env.logger.error({ event: 'game.error', err, room: this.code }, 'Erreur du moteur de jeu');
      return { ok: false, error: 'Erreur interne, réessayez.' };
    }
  }

  private mutate(fn: (state: unknown) => unknown): void {
    try {
      this.state = fn(this.state);
    } catch (err) {
      this.env.logger.error({ event: 'game.error', err, room: this.code }, 'Erreur du moteur de jeu');
    }
    this.afterMutation();
  }

  private afterMutation(): void {
    if (this.status === 'in_game' && this.module.isFinished(this.state)) {
      this.status = 'ended';
      this.clearTimers();
      this.hooks.onGameEnded(this);
    }
    this.touch();
    this.hooks.onChange(this);
    this.scheduleBots();
    this.syncJob();
  }

  private schedule(key: string, ms: number): void {
    this.cancelTimer(key);
    const handle = setTimeout(() => {
      this.timers.delete(key);
      if (this.status !== 'in_game') return;
      this.mutate((s) => this.module.onTimer(s, key, this.ctx));
    }, ms);
    handle.unref();
    this.timers.set(key, handle);
  }

  private cancelTimer(key: string): void {
    const handle = this.timers.get(key);
    if (handle) {
      clearTimeout(handle);
      this.timers.delete(key);
    }
  }

  private clearTimers(): void {
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
    this.clearBotTimers();
    this.abortJob();
  }

  // ---------------------------------------------------------------------------
  // Travaux asynchrones du jeu (ex. génération par IA)
  // ---------------------------------------------------------------------------

  /**
   * Lance le travail que le jeu demande, s'il y en a un, et abandonne celui qui ne l'est plus.
   * Un seul travail à la fois par salle. Son résultat revient par `completeJob`, comme une mutation normale :
   * un résultat tardif (salle terminée, travail remplacé) est ignoré.
   */
  private syncJob(): void {
    const m = this.module;
    if (!m.pendingJob || !m.runJob || !m.completeJob) return;
    const job = this.status === 'in_game' ? m.pendingJob(this.state) : null;
    if (this.running && this.running.id !== job?.id) this.abortJob();
    if (!job || this.running || job.id === this.finishedJobId) return;

    const controller = new AbortController();
    this.running = { id: job.id, controller };
    const run = m.runJob;
    new Promise<unknown>((resolve) => resolve(run.call(m, job, this.ctx, controller.signal))).then(
      (value) => this.finishJob(job, { ok: true, value }),
      (err: unknown) => this.finishJob(job, { ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  }

  private finishJob(job: GameJob, outcome: JobOutcome): void {
    if (this.running?.id !== job.id) return;
    this.running = null;
    this.finishedJobId = job.id;
    if (!outcome.ok) {
      this.env.logger.warn(
        { event: 'room.job-failed', room: this.code, kind: job.kind, error: outcome.error },
        'Travail du jeu en échec',
      );
    }
    const complete = this.module.completeJob;
    if (this.status !== 'in_game' || !complete) return;
    this.mutate((s) => complete.call(this.module, s, job.id, outcome, this.ctx));
  }

  private abortJob(): void {
    if (!this.running) return;
    this.running.controller.abort();
    this.running = null;
  }

  /** Libère minuteurs et temporisations (fermeture de la salle). */
  destroy(): void {
    this.clearTimers();
    for (const p of this.players.values()) this.clearGrace(p);
  }
}
