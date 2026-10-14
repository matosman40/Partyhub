import { randomInt } from 'node:crypto';
import type { AvatarInfo, GameModule } from '@partyhub/shared';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode } from '@partyhub/shared';
import { Room, type RoomEnv, type RoomHooks, type RoomOptions } from './room.js';

export type CloseReason = 'closed' | 'inactive' | 'abandoned' | 'expired' | 'admin';

export interface ManagerHooks extends RoomHooks {
  onClosed: (room: Room, reason: CloseReason) => void;
}

export interface SweepPolicy {
  inactivityMs: number;
  maxAgeMs: number;
}

const MAX_CODE_ATTEMPTS = 200;

/**
 * Registre des salles actives. Garantit l'unicité des codes tant qu'une salle
 * est ouverte et isole les salles les unes des autres (aucun accès croisé).
 */
export class RoomManager {
  private readonly byId = new Map<string, Room>();
  private readonly byCode = new Map<string, Room>();

  constructor(
    private readonly env: RoomEnv,
    private readonly hooks: ManagerHooks,
    private readonly maxRooms = 200,
  ) {}

  create(module: GameModule, options: RoomOptions = { practice: false }): Room | null {
    if (this.byId.size >= this.maxRooms) return null;
    const code = this.newCode();
    if (!code) return null;
    const room = new Room(code, module, this.env, this.hooks, options);
    this.byId.set(room.id, room);
    this.byCode.set(code, room);
    return room;
  }

  private newCode(): string | null {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.byCode.has(code)) return code;
    }
    return null;
  }

  getByCode(code: string): Room | undefined {
    return this.byCode.get(normalizeRoomCode(code));
  }

  getById(id: string): Room | undefined {
    return this.byId.get(id);
  }

  all(): Room[] {
    return [...this.byId.values()];
  }

  /** Répercute un changement de profil (photo, consentement) dans toutes les salles où il joue. */
  refreshAvatar(profileId: string, avatar: AvatarInfo): void {
    for (const room of this.all()) room.refreshAvatar(profileId, avatar);
  }

  /** Ferme une salle : elle disparaît du registre et ses clients sont prévenus. */
  close(room: Room, reason: CloseReason): boolean {
    if (!this.byId.has(room.id)) return false;
    this.byId.delete(room.id);
    this.byCode.delete(room.code);
    this.hooks.onClosed(room, reason);
    room.destroy();
    this.env.logger.info({ room: room.code, reason }, 'Salle fermée');
    return true;
  }

  closeWhere(predicate: (room: Room) => boolean, reason: CloseReason): number {
    let count = 0;
    for (const room of this.all()) {
      if (predicate(room) && this.close(room, reason)) count++;
    }
    return count;
  }

  /** Nettoyage périodique : salles trop anciennes, inactives ou abandonnées. */
  sweep(policy: SweepPolicy): number {
    const now = this.env.now();
    let count = 0;
    for (const room of this.all()) {
      let reason: CloseReason | null = null;
      if (now - room.createdAt > policy.maxAgeMs) reason = 'expired';
      else if (now - room.lastActivity > policy.inactivityMs) reason = 'inactive';
      else if (!room.hasSockets && now - room.lastActivity > this.env.graceMs()) {
        reason = 'abandoned';
      }
      if (reason && this.close(room, reason)) count++;
    }
    return count;
  }

  /** Suppression manuelle depuis l'administration : toutes les salles sans connexion. */
  purgeIdle(): number {
    return this.closeWhere((room) => !room.hasSockets, 'admin');
  }

  /** Arrêt du serveur : libère les minuteurs sans notifier de fermeture. */
  destroyAll(): void {
    for (const room of this.all()) room.destroy();
    this.byId.clear();
    this.byCode.clear();
  }
}
