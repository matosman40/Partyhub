import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  actionSchema,
  chatSchema,
  configureSchema,
  defaultCharacterFor,
  deviceKindFromUserAgent,
  handoffClaimSchema,
  hostConnectSchema,
  joinSchema,
  kickSchema,
  normalizeRoomCode,
  observerJoinSchema,
  lobbyMoodSchema,
  lobbyPositionSchema,
  readySchema,
  reactionSchema,
  voicePlaySchema,
  type DeviceInfo,
  type DeviceKind,
  type Ack,
  type AvatarInfo,
  type ChatMessage,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@partyhub/shared';
import type { Logger } from '../logger.js';
import { clientIp } from './client-ip.js';
import { JOIN_THROTTLE_DEFAULTS, JoinThrottle, type JoinThrottleOptions } from './join-throttle.js';
import { compileTrustProxy, type TrustProxy } from '../trust-proxy.js';
import type { ProfileService } from '../profiles/service.js';
import type { CloseReason, RoomManager } from '../rooms/manager.js';
import type { Room } from '../rooms/room.js';

export interface SocketData {
  role?: 'host' | 'player' | 'observer';
  roomId?: string;
  playerId?: string;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Limite de débit par socket : pas plus de `max` commandes par fenêtre. */
class RateLimiter {
  private hits: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(): boolean {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.max) return false;
    this.hits.push(now);
    return true;
  }
}

const COMMANDS_PER_WINDOW = 20;
const WINDOW_MS = 5000;
/** Discussion et réactions : plus strictes, pour éviter le spam dans la salle. */
const CHAT_PER_WINDOW = 6;
const CHAT_WINDOW_MS = 10_000;
const REACTIONS_PER_WINDOW = 12;

const HOST_AVATAR: AvatarInfo = { hue: 42, emoji: '🎤', imageUrl: null, character: defaultCharacterFor('Hôte') };
const OBSERVER_AVATAR: AvatarInfo = {
  hue: 210,
  emoji: '👀',
  imageUrl: null,
  character: defaultCharacterFor('Observateur'),
};

/**
 * Pont entre le registre des salles et Socket.IO.
 * - Chaque socket reçoit uniquement la vue qui lui est destinée.
 * - Les commandes de l'hôte ne sont acceptées que d'un socket hôte authentifié.
 * - Les commandes joueur ne sont acceptées que d'un socket rattaché à ce joueur.
 * - Discussion et réactions sont relayées à la salle, sans être conservées.
 */
export class RealtimeHub {
  private io: IO | null = null;
  private manager: RoomManager | null = null;
  private logger: Logger | null = null;
  private profiles: ProfileService | null = null;
  private readonly joinThrottle: JoinThrottle;

  constructor(
    private readonly trust: TrustProxy = compileTrustProxy('loopback'),
    throttle: Partial<JoinThrottleOptions> = {},
  ) {
    this.joinThrottle = new JoinThrottle({ ...JOIN_THROTTLE_DEFAULTS, ...throttle });
  }

  attach(io: IO, manager: RoomManager, logger: Logger, profiles: ProfileService): void {
    this.io = io;
    this.manager = manager;
    this.logger = logger;
    this.profiles = profiles;
    io.on('connection', (socket) => this.onConnection(socket));
  }

  private get mgr(): RoomManager {
    if (!this.manager) throw new Error('Le hub temps réel n’est pas initialisé');
    return this.manager;
  }

  // ---------------------------------------------------------------------------
  // Diffusion (appelée par le registre des salles)
  // ---------------------------------------------------------------------------

  onRoomChanged(room: Room): void {
    const io = this.io;
    if (!io) return;
    const hostView = room.hostView();
    for (const sid of room.hostSockets) io.to(sid).emit('room:host', hostView);
    for (const p of room.players.values()) {
      const view = room.playerView(p.id);
      if (!view) continue;
      for (const sid of p.sockets) io.to(sid).emit('room:player', view);
    }
    if (room.observers.size > 0) {
      const observerView = room.observerView();
      for (const sid of room.observers.keys()) io.to(sid).emit('room:observer', observerView);
    }
  }

  onRoomClosed(room: Room, reason: CloseReason): void {
    const io = this.io;
    if (!io) return;
    const clientReason = reason === 'closed' || reason === 'admin' ? 'closed' : 'inactive';
    for (const sid of room.hostSockets) io.to(sid).emit('room:closed', { reason: clientReason });
    for (const sid of room.observers.keys()) io.to(sid).emit('room:closed', { reason: clientReason });
    for (const p of room.players.values()) {
      for (const sid of p.sockets) io.to(sid).emit('room:closed', { reason: clientReason });
    }
  }

  /** Envoie un message à toutes les personnes présentes dans la salle. */
  private broadcastChat(room: Room, from: string, avatar: AvatarInfo, text: string): void {
    const message: ChatMessage = { id: randomUUID(), from, avatar, text, at: Date.now() };
    this.io?.to(room.socketIds()).emit('room:chat', message);
  }

  // ---------------------------------------------------------------------------
  // Connexions
  // ---------------------------------------------------------------------------

  private hostRoomOf(socket: TypedSocket): Room | undefined {
    if (socket.data.role !== 'host' || !socket.data.roomId) return undefined;
    return this.mgr.getById(socket.data.roomId);
  }

  private observerRoomOf(socket: TypedSocket): Room | undefined {
    if (socket.data.role !== 'observer' || !socket.data.roomId) return undefined;
    return this.mgr.getById(socket.data.roomId);
  }

  /**
   * Type d'appareil d'une connexion : celui qu'elle déclare (taille de fenêtre, pointeur),
   * sinon celui que suggère son identifiant navigateur. Le serveur ne voit pas l'écran.
   */
  private kindOf(socket: TypedSocket, declared?: DeviceInfo): DeviceKind {
    if (declared) return declared.kind;
    return deviceKindFromUserAgent(socket.handshake.headers['user-agent']);
  }

  private playerRoomOf(socket: TypedSocket): { room: Room; playerId: string } | undefined {
    if (socket.data.role !== 'player' || !socket.data.roomId || !socket.data.playerId) {
      return undefined;
    }
    const room = this.mgr.getById(socket.data.roomId);
    return room ? { room, playerId: socket.data.playerId } : undefined;
  }

  /** Détache le socket de la salle où il se trouve (changement de rôle ou déconnexion). */
  private leave(socket: TypedSocket): void {
    if (socket.data.roomId) {
      this.mgr.getById(socket.data.roomId)?.removeSocket(socket.id);
    }
    socket.data = {};
  }

  private onConnection(socket: TypedSocket): void {
    const limiter = new RateLimiter(COMMANDS_PER_WINDOW, WINDOW_MS);
    const chatLimiter = new RateLimiter(CHAT_PER_WINDOW, CHAT_WINDOW_MS);
    const reactionLimiter = new RateLimiter(REACTIONS_PER_WINDOW, CHAT_WINDOW_MS);
    // Déplacements : jusqu'à 30 par seconde (glisser suit le doigt) ; émotions : 6 toutes les 4 secondes.
    const lobbyMoveLimiter = new RateLimiter(30, 1000);
    const lobbyMoodLimiter = new RateLimiter(6, 4000);
    // Voix : une toutes les quelques secondes et par socket ; la salle a aussi sa file d'attente côté écran.
    const voiceLimiter = new RateLimiter(3, 10_000);
    const ip = clientIp(this.trust, socket.handshake.address, socket.handshake.headers['x-forwarded-for']);

    const limited = (ack: Ack): boolean => {
      if (limiter.take()) return false;
      ack({ ok: false, error: 'Trop de commandes : patientez une seconde.' });
      return true;
    };
    const invalid = (ack: Ack, error = 'Données invalides.') => ack({ ok: false, error });

    /**
     * Retrouve la salle d'un code saisi par une personne. Code inconnu : réponse ralentie si cette
     * adresse en essaie beaucoup d'autres ; les salles valides ne sont jamais concernées.
     */
    const roomOrRefuse = (rawCode: string, ack: Ack): Room | undefined => {
      const found = this.mgr.getByCode(rawCode);
      if (found) return found;
      const unknown = 'Code de salle inconnu. Vérifiez le code affiché sur l’écran.';
      const reservation = this.joinThrottle.reserve(ip, normalizeRoomCode(rawCode));
      if ('refused' in reservation) {
        this.logger?.warn(
          { event: 'socket.join-throttled', ip },
          'Trop de codes de salle inconnus : tentative refusée',
        );
        invalid(ack, 'Trop de codes incorrects depuis cette connexion. Patientez quelques instants.');
        return undefined;
      }
      if (reservation.wait === 0) invalid(ack, unknown);
      else setTimeout(() => invalid(ack, unknown), reservation.wait);
      return undefined;
    };

    // --- Hôte -------------------------------------------------------------

    socket.on('host:connect', (p, ack) => {
      if (limited(ack)) return;
      const parsed = hostConnectSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      const room = this.mgr.getByCode(parsed.data.code);
      if (!room || room.hostToken !== parsed.data.hostToken) {
        return invalid(ack, 'Salle introuvable ou accès refusé.');
      }
      this.leave(socket);
      socket.data = { role: 'host', roomId: room.id };
      room.attachHost(socket.id, this.kindOf(socket), parsed.data.screen === true);
      ack({ ok: true });
    });

    socket.on('host:handoff', (ack) => {
      if (limited(ack)) return;
      const room = this.hostRoomOf(socket);
      if (!room) return invalid(ack, 'Action réservée à l’hôte de la salle.');
      const handoff = room.createHandoff();
      this.logger?.info({ event: 'room.handoff-created', roomCode: room.code }, 'Code de transfert d’hôte créé');
      ack({ ok: true, code: handoff.code, expiresAt: handoff.expiresAt });
    });

    socket.on('host:claim', (p, ack) => {
      if (limited(ack)) return;
      const parsed = handoffClaimSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      const room = roomOrRefuse(parsed.data.code, ack);
      if (!room) return;
      const res = room.claimHandoff(parsed.data.handoffCode);
      if (!res.ok) {
        this.logger?.warn({ event: 'room.handoff-refused', roomCode: room.code }, 'Code de transfert d’hôte refusé');
        return ack(res);
      }
      this.logger?.info({ event: 'room.handoff-claimed', roomCode: room.code }, 'Accès hôte transféré à un appareil');
      ack({ ok: true, hostToken: res.hostToken });
    });

    const hostCommand = (ack: Ack, run: (room: Room) => { ok: true } | { ok: false; error: string }) => {
      const room = this.hostRoomOf(socket);
      if (!room) return invalid(ack, 'Action réservée à l’hôte de la salle.');
      ack(run(room));
    };

    socket.on('host:configure', (p, ack) => {
      if (limited(ack)) return;
      const parsed = configureSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      hostCommand(ack, (room) => room.configure(parsed.data.gameSettings));
    });

    socket.on('host:start', (ack) => {
      if (limited(ack)) return;
      hostCommand(ack, (room) => room.start());
    });

    socket.on('host:next', (ack) => {
      if (limited(ack)) return;
      hostCommand(ack, (room) => room.next());
    });

    socket.on('host:end', (ack) => {
      if (limited(ack)) return;
      hostCommand(ack, (room) => room.end());
    });

    socket.on('host:replay', (ack) => {
      if (limited(ack)) return;
      hostCommand(ack, (room) => room.replay());
    });

    socket.on('host:kick', (p, ack) => {
      if (limited(ack)) return;
      const parsed = kickSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      const room = this.hostRoomOf(socket);
      if (!room) return invalid(ack, 'Action réservée à l’hôte de la salle.');
      const res = room.kick(parsed.data.playerId);
      if (!res.ok) return ack(res);
      for (const sid of res.sockets) {
        this.io?.to(sid).emit('room:closed', { reason: 'kicked' });
      }
      ack({ ok: true });
    });

    socket.on('host:addBot', (ack) => {
      if (limited(ack)) return;
      hostCommand(ack, (room) => room.addBot());
    });

    socket.on('host:removeBot', (p, ack) => {
      if (limited(ack)) return;
      const parsed = kickSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      hostCommand(ack, (room) => room.removeBot(parsed.data.playerId));
    });

    socket.on('host:close', (ack) => {
      if (limited(ack)) return;
      const room = this.hostRoomOf(socket);
      if (!room) return invalid(ack, 'Action réservée à l’hôte de la salle.');
      this.mgr.close(room, 'closed');
      ack({ ok: true });
    });

    socket.on('host:chat', (p, ack) => {
      if (limited(ack)) return;
      if (!chatLimiter.take()) return ack({ ok: false, error: 'Doucement : un message toutes les quelques secondes.' });
      const parsed = chatSchema.safeParse(p);
      if (!parsed.success) return invalid(ack, 'Message invalide (120 caractères maximum).');
      hostCommand(ack, (room) => {
        this.broadcastChat(room, 'Hôte', HOST_AVATAR, parsed.data.text);
        return { ok: true };
      });
    });

    socket.on('host:reaction', (p, ack) => {
      if (limited(ack)) return;
      if (!reactionLimiter.take()) return ack({ ok: false, error: 'Doucement avec les réactions.' });
      const parsed = reactionSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      hostCommand(ack, (room) => {
        this.io
          ?.to(room.socketIds())
          .emit('room:reaction', { id: randomUUID(), from: 'Hôte', emoji: parsed.data.emoji });
        return { ok: true };
      });
    });

    // --- Joueurs ----------------------------------------------------------

    socket.on('player:join', (p, ack) => {
      if (limited(ack)) return;
      const parsed = joinSchema.safeParse(p);
      if (!parsed.success) return invalid(ack, parsed.error.issues[0]?.message);
      const room = roomOrRefuse(parsed.data.code, ack);
      if (!room) return;

      let profile;
      if (parsed.data.profileToken) {
        const profileId = this.profiles?.authenticate(parsed.data.profileToken);
        profile = profileId ? this.profiles?.playerProfile(profileId) : undefined;
        if (!profile) {
          return invalid(ack, 'Votre session de profil a expiré. Reconnectez-vous ou entrez sans profil.');
        }
      }

      this.leave(socket);
      const res = room.join(
        parsed.data.name,
        parsed.data.token,
        socket.id,
        profile,
        this.kindOf(socket, parsed.data.device),
      );
      if (!res.ok) return invalid(ack, res.error);
      socket.data = { role: 'player', roomId: room.id, playerId: res.playerId };
      ack({ ok: true, playerId: res.playerId, token: res.token });
    });

    // --- Observateurs -----------------------------------------------------

    socket.on('observer:join', (p, ack) => {
      if (limited(ack)) return;
      const parsed = observerJoinSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      const room = roomOrRefuse(parsed.data.code, ack);
      if (!room) return;
      this.leave(socket);
      const res = room.joinObserver(socket.id, this.kindOf(socket, parsed.data.device));
      if (!res.ok) return ack(res);
      socket.data = { role: 'observer', roomId: room.id };
      ack({ ok: true });
    });

    socket.on('observer:chat', (p, ack) => {
      if (limited(ack)) return;
      const room = this.observerRoomOf(socket);
      if (!room) return invalid(ack, 'Vous ne regardez aucune salle.');
      if (!chatLimiter.take()) return ack({ ok: false, error: 'Doucement : un message toutes les quelques secondes.' });
      const parsed = chatSchema.safeParse(p);
      if (!parsed.success) return invalid(ack, 'Message invalide (120 caractères maximum).');
      const name = room.observerName(socket.id);
      if (!name) return invalid(ack, 'Vous ne regardez plus la salle.');
      this.broadcastChat(room, name, OBSERVER_AVATAR, parsed.data.text);
      ack({ ok: true });
    });

    socket.on('observer:reaction', (p, ack) => {
      if (limited(ack)) return;
      const room = this.observerRoomOf(socket);
      if (!room) return invalid(ack, 'Vous ne regardez aucune salle.');
      if (!reactionLimiter.take()) return ack({ ok: false, error: 'Doucement avec les réactions.' });
      const parsed = reactionSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      this.io?.to(room.socketIds()).emit('room:reaction', {
        id: randomUUID(),
        from: room.observerName(socket.id) ?? 'Observateur',
        emoji: parsed.data.emoji,
      });
      ack({ ok: true });
    });

    socket.on('observer:leave', (ack) => {
      if (limited(ack)) return;
      const room = this.observerRoomOf(socket);
      if (room) this.leave(socket);
      ack({ ok: true });
    });

    socket.on('player:ready', (p, ack) => {
      if (limited(ack)) return;
      const current = this.playerRoomOf(socket);
      if (!current) return invalid(ack, 'Vous n’êtes pas dans une salle.');
      const parsed = readySchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      ack(current.room.setReady(current.playerId, parsed.data.ready));
    });

    socket.on('player:action', (p, ack) => {
      if (limited(ack)) return;
      const current = this.playerRoomOf(socket);
      if (!current) return invalid(ack, 'Vous n’êtes pas dans une salle.');
      const parsed = actionSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      ack(current.room.handleAction(current.playerId, parsed.data.commandId, parsed.data.type, parsed.data.payload));
    });

    socket.on('player:chat', (p, ack) => {
      if (limited(ack)) return;
      const current = this.playerRoomOf(socket);
      if (!current) return invalid(ack, 'Vous n’êtes pas dans une salle.');
      if (!chatLimiter.take()) return ack({ ok: false, error: 'Doucement : un message toutes les quelques secondes.' });
      const parsed = chatSchema.safeParse(p);
      if (!parsed.success) return invalid(ack, 'Message invalide (120 caractères maximum).');
      const sender = current.room.senderOf(current.playerId);
      if (!sender) return invalid(ack, 'Vous n’êtes plus dans la salle.');
      this.broadcastChat(current.room, sender.name, sender.avatar, parsed.data.text);
      ack({ ok: true });
    });

    socket.on('player:lobby-move', (p, ack) => {
      if (limited(ack)) return;
      const current = this.playerRoomOf(socket);
      if (!current) return invalid(ack, 'Vous n’êtes pas dans une salle.');
      if (!lobbyMoveLimiter.take()) return ack({ ok: false, error: 'Doucement avec les déplacements.' });
      const parsed = lobbyPositionSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      const moved = current.room.setLobbyPosition(current.playerId, parsed.data);
      if (moved.ok) {
        this.io
          ?.to(current.room.socketIds())
          .emit('room:lobby-position', { playerId: current.playerId, position: moved.position });
      }
      ack(moved.ok ? { ok: true } : moved);
    });

    socket.on('player:lobby-mood', (p, ack) => {
      if (limited(ack)) return;
      const current = this.playerRoomOf(socket);
      if (!current) return invalid(ack, 'Vous n’êtes pas dans une salle.');
      if (!lobbyMoodLimiter.take()) return ack({ ok: false, error: 'Doucement avec les émotions.' });
      const parsed = lobbyMoodSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      const allowed = current.room.lobbyMoodAllowed(current.playerId);
      if (!allowed.ok) return ack(allowed);
      const choice = parsed.data;
      this.io?.to(current.room.socketIds()).emit('room:lobby-mood', {
        id: randomUUID(),
        playerId: current.playerId,
        mood: 'mood' in choice ? choice.mood : null,
        face: 'face' in choice ? choice.face : null,
      });
      ack({ ok: true });
    });

    socket.on('player:reaction', (p, ack) => {
      if (limited(ack)) return;
      const current = this.playerRoomOf(socket);
      if (!current) return invalid(ack, 'Vous n’êtes pas dans une salle.');
      if (!reactionLimiter.take()) return ack({ ok: false, error: 'Doucement avec les réactions.' });
      const parsed = reactionSchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      const sender = current.room.senderOf(current.playerId);
      this.io?.to(current.room.socketIds()).emit('room:reaction', {
        id: randomUUID(),
        from: sender?.name ?? '?',
        emoji: parsed.data.emoji,
      });
      ack({ ok: true });
    });

    socket.on('player:voice', (p, ack) => {
      if (limited(ack)) return;
      const current = this.playerRoomOf(socket);
      if (!current) return invalid(ack, 'Vous n’êtes pas dans une salle.');
      const parsed = voicePlaySchema.safeParse(p);
      if (!parsed.success) return invalid(ack);
      if (!voiceLimiter.take()) return ack({ ok: false, error: 'Doucement : une voix toutes les quelques secondes.' });
      // Seules les voix du profil du joueur sont jouées : une voix d'un autre joueur est refusée.
      const profileId = current.room.profileOf(current.playerId);
      const voice = profileId && this.profiles ? this.profiles.ownedVoice(profileId, parsed.data.id) : undefined;
      if (!voice) return invalid(ack, 'Cette voix n’est pas dans votre profil.');
      const sender = current.room.senderOf(current.playerId);
      if (!sender) return invalid(ack, 'Vous n’êtes plus dans la salle.');
      const screens = current.room.screenSocketIds();
      if (screens.length === 0) {
        return ack({ ok: false, error: 'Aucun écran principal n’est connecté : la voix ne sera pas entendue.' });
      }
      this.io?.to(screens).emit('room:voice', {
        id: randomUUID(),
        playerId: current.playerId,
        from: sender.name,
        avatar: sender.avatar,
        name: voice.name,
        voiceId: voice.id,
      });
      this.logger?.debug({ event: 'room.voice', room: current.room.code }, 'Voix jouée sur l’écran');
      ack({ ok: true });
    });

    socket.on('player:leave', (ack) => {
      if (limited(ack)) return;
      const current = this.playerRoomOf(socket);
      if (!current) return invalid(ack, 'Vous n’êtes pas dans une salle.');
      const res = current.room.leave(current.playerId);
      if (res.ok) this.leave(socket);
      ack(res);
    });

    socket.on('disconnect', () => {
      this.leave(socket);
      this.logger?.debug({ event: 'socket.disconnected', socket: socket.id }, 'Socket déconnecté');
    });
  }
}
