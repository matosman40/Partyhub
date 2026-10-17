import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolveGame } from '../games-registry.js';
import { withOverrides } from '../game-details.js';
import {
  characterSchema,
  defaultAvatarFor,
  defaultCharacterFor,
  type AvatarInfo,
  type CharacterSpec,
  type ProfileStats,
  type ProfileView,
  type AvatarEmoji,
  type VoiceClip,
  VOICE_MAX_BYTES,
  VOICE_MAX_PER_PROFILE,
  sniffAudioMime,
} from '@partyhub/shared';
import { hashPassword, verifyPassword } from '../auth.js';
import type { Store } from '../db/store.js';
import { purgeGameData } from './game-data.js';

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Erreur métier : le message est destiné à l’utilisateur, le statut à la réponse HTTP. */
export class ProfileError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ProfileRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  avatar_hue: number;
  avatar_emoji: string;
  avatar_image: string | null;
  avatar_version: number;
  avatar_shared: number;
  avatar_character: string | null;
  created_at: string;
}

/** Profil tel que la salle le voit : identité et apparence, sans secret. */
export interface PlayerProfile {
  id: string;
  displayName: string;
  avatar: AvatarInfo;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Comptes joueurs : inscription, connexion, sessions à durée limitée, avatar et statistiques.
 * Les jetons de session ne sont jamais stockés en clair (seule leur empreinte SHA-256 l’est).
 */
export class ProfileService {
  /** Nom d’un jeu tel qu’il s’affiche (renommage de l’administrateur compris), ou son identifiant s’il n’existe plus. */
  private gameName(gameId: string): string {
    const original = resolveGame(gameId);
    return original ? withOverrides(original, this.store).manifest.name : gameId;
  }

  constructor(
    private readonly store: Store,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private get db() {
    return this.store.db;
  }

  private rowById(id: string): ProfileRow | undefined {
    return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
  }

  /**
   * Personnage du profil. Un JSON absent ou invalide (jamais écrit par l’application) donne
   * le personnage généré à partir du pseudo, comme pour un invité.
   */
  private characterOf(row: ProfileRow): CharacterSpec {
    if (row.avatar_character) {
      try {
        const parsed = characterSchema.safeParse(JSON.parse(row.avatar_character));
        if (parsed.success) return parsed.data;
      } catch {
        // JSON corrompu : on retombe sur le personnage généré.
      }
    }
    return defaultCharacterFor(row.username);
  }

  /** Avatar complet, vu par le titulaire du profil (sa photo est toujours visible pour lui). */
  private avatarOf(row: ProfileRow): AvatarInfo {
    return {
      hue: row.avatar_hue,
      emoji: row.avatar_emoji,
      imageUrl: row.avatar_image ? `/api/avatars/${row.id}?v=${row.avatar_version}` : null,
      character: this.characterOf(row),
    };
  }

  /**
   * Avatar tel que les autres joueurs de la salle le voient : la photo n’est envoyée
   * que si le titulaire l’a explicitement autorisée. Sinon, l’emoji sur sa couleur.
   */
  private roomAvatarOf(row: ProfileRow): AvatarInfo {
    const shared = row.avatar_shared === 1 && !!row.avatar_image;
    return {
      hue: row.avatar_hue,
      emoji: row.avatar_emoji,
      imageUrl: shared ? `/api/avatars/${row.id}?v=${row.avatar_version}` : null,
      character: this.characterOf(row),
    };
  }

  private createSession(profileId: string): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO profile_sessions (token_hash, profile_id, expires_at) VALUES (?, ?, ?)')
      .run(hashToken(token), profileId, this.now() + SESSION_TTL_MS);
    return token;
  }

  /**
   * Crée un profil. Sans identifiant ni mot de passe : profil « nom seul » (identifiant généré,
   * pas de mot de passe). Avec les deux : ancien compte, identifiant unique et mot de passe.
   */
  async register(input: { displayName: string; username?: string; password?: string }) {
    const id = randomUUID();
    const withPassword = input.password !== undefined;
    const username = withPassword ? input.username! : `p${randomBytes(6).toString('hex')}`;
    if (withPassword) {
      const exists = this.db.prepare('SELECT 1 FROM profiles WHERE username = ?').get(username);
      if (exists) throw new ProfileError(409, 'Cet identifiant est déjà pris. Choisissez-en un autre.');
    }
    const avatar = defaultAvatarFor(username);
    this.db
      .prepare(
        `INSERT INTO profiles (id, username, display_name, password_hash, avatar_hue, avatar_emoji, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        username,
        input.displayName,
        withPassword ? await hashPassword(input.password!) : '',
        avatar.hue,
        avatar.emoji,
        new Date(this.now()).toISOString(),
      );
    return { token: this.createSession(id), profile: this.view(id)! };
  }

  async login(username: string, password: string) {
    const row = this.db.prepare('SELECT * FROM profiles WHERE username = ?').get(username) as ProfileRow | undefined;
    // Un profil « nom seul » n’a pas de mot de passe : il ne se connecte pas par identifiant.
    const valid = row !== undefined && row.password_hash !== '' && (await verifyPassword(password, row.password_hash));
    if (!row || !valid) {
      throw new ProfileError(401, 'Identifiant ou mot de passe incorrect.');
    }
    return { token: this.createSession(row.id), profile: this.view(row.id)! };
  }

  /** Retrouve le profil rattaché à un jeton de session valide, sinon undefined. */
  authenticate(token: string | undefined): string | undefined {
    if (!token) return undefined;
    const row = this.db
      .prepare('SELECT profile_id, expires_at FROM profile_sessions WHERE token_hash = ?')
      .get(hashToken(token)) as { profile_id: string; expires_at: number } | undefined;
    if (!row) return undefined;
    if (row.expires_at < this.now()) {
      this.db.prepare('DELETE FROM profile_sessions WHERE token_hash = ?').run(hashToken(token));
      return undefined;
    }
    // Session glissante : un profil « nom seul » n’a que ce jeton pour revenir, il ne doit pas expirer
    // pendant qu’on s’en sert. Prolongée dès que la moitié de la durée est passée.
    if (row.expires_at - this.now() < SESSION_TTL_MS / 2) {
      this.db
        .prepare('UPDATE profile_sessions SET expires_at = ? WHERE token_hash = ?')
        .run(this.now() + SESSION_TTL_MS, hashToken(token));
    }
    return row.profile_id;
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM profile_sessions WHERE token_hash = ?').run(hashToken(token));
  }

  /** Profil utilisable par la salle (nom et avatar figés au moment de l’entrée). */
  playerProfile(profileId: string): PlayerProfile | undefined {
    const row = this.rowById(profileId);
    if (!row) return undefined;
    return { id: row.id, displayName: row.display_name, avatar: this.roomAvatarOf(row) };
  }

  view(profileId: string): ProfileView | undefined {
    const row = this.rowById(profileId);
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatar: this.avatarOf(row),
      avatarShared: row.avatar_shared === 1,
      hasPassword: row.password_hash !== '',
      createdAt: row.created_at,
      stats: this.stats(profileId),
    };
  }

  update(
    profileId: string,
    patch: {
      displayName?: string;
      avatarHue?: number;
      avatarEmoji?: AvatarEmoji;
      avatarImage?: string | null;
      avatarShared?: boolean;
      /** null : revenir au personnage généré à partir du pseudo. */
      avatarCharacter?: CharacterSpec | null;
    },
  ): ProfileView {
    if (patch.displayName !== undefined) {
      this.db.prepare('UPDATE profiles SET display_name = ? WHERE id = ?').run(patch.displayName, profileId);
    }
    if (patch.avatarCharacter !== undefined) {
      const json = patch.avatarCharacter ? JSON.stringify(characterSchema.parse(patch.avatarCharacter)) : null;
      this.db.prepare('UPDATE profiles SET avatar_character = ? WHERE id = ?').run(json, profileId);
    }
    if (patch.avatarHue !== undefined) {
      this.db.prepare('UPDATE profiles SET avatar_hue = ? WHERE id = ?').run(patch.avatarHue, profileId);
    }
    if (patch.avatarEmoji !== undefined) {
      this.db.prepare('UPDATE profiles SET avatar_emoji = ? WHERE id = ?').run(patch.avatarEmoji, profileId);
    }
    if (patch.avatarShared !== undefined) {
      this.db.prepare('UPDATE profiles SET avatar_shared = ? WHERE id = ?').run(patch.avatarShared ? 1 : 0, profileId);
    }
    if (patch.avatarImage !== undefined) {
      // Chaque changement d’image change la version : les navigateurs rechargent l’image.
      this.db
        .prepare('UPDATE profiles SET avatar_image = ?, avatar_version = avatar_version + 1 WHERE id = ?')
        .run(patch.avatarImage, profileId);
    }
    return this.view(profileId)!;
  }

  async changePassword(profileId: string, current: string, next: string): Promise<void> {
    const row = this.rowById(profileId);
    if (!row) throw new ProfileError(404, 'Profil introuvable.');
    if (row.password_hash === '') throw new ProfileError(400, 'Ce profil n’a pas de mot de passe.');
    if (!(await verifyPassword(current, row.password_hash))) {
      throw new ProfileError(401, 'Le mot de passe actuel est incorrect.');
    }
    this.db.prepare('UPDATE profiles SET password_hash = ? WHERE id = ?').run(await hashPassword(next), profileId);
    // Les autres appareils doivent se reconnecter avec le nouveau mot de passe.
    this.db.prepare('DELETE FROM profile_sessions WHERE profile_id = ?').run(profileId);
    return undefined;
  }

  /** Ouvre une nouvelle session après changement de mot de passe, sur cet appareil. */
  renewSession(profileId: string): string {
    return this.createSession(profileId);
  }

  delete(profileId: string): void {
    // Les voix partent avec le profil (la clé étrangère l’assure aussi, mais on ne compte pas dessus).
    this.db.prepare('DELETE FROM voice_clips WHERE profile_id = ?').run(profileId);
    // Les données de jeu (personnages gardés d’une partie à l’autre) aussi.
    purgeGameData(this.store, profileId);
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
  }

  /* Voix de profil : le son reste en base, seule la liste part vers le navigateur. */

  voices(profileId: string): VoiceClip[] {
    const rows = this.db
      .prepare('SELECT id, name, created_at FROM voice_clips WHERE profile_id = ? ORDER BY rowid')
      .all(profileId) as { id: string; name: string; created_at: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  /** Ajoute une voix si le profil n’en a pas encore cinq et si le son est bien un format audio connu. */
  addVoice(profileId: string, name: string, data: Buffer): VoiceClip {
    const mime = sniffAudioMime(data);
    if (!mime) {
      throw new ProfileError(
        400,
        'Ce fichier n’est pas un son reconnu. Enregistrez à nouveau, ou choisissez un fichier MP3, WAV, OGG, WebM ou M4A.',
      );
    }
    if (data.length > VOICE_MAX_BYTES) {
      throw new ProfileError(413, 'Enregistrement trop lourd : 5 secondes maximum.');
    }
    const id = randomUUID();
    const createdAt = new Date(this.now()).toISOString();
    // Le contrôle du nombre et l’insertion se font dans une même transaction.
    const insert = this.db.transaction(() => {
      const count = (
        this.db.prepare('SELECT COUNT(*) AS n FROM voice_clips WHERE profile_id = ?').get(profileId) as { n: number }
      ).n;
      if (count >= VOICE_MAX_PER_PROFILE) {
        throw new ProfileError(409, `Vous avez déjà ${VOICE_MAX_PER_PROFILE} voix. Supprimez-en une pour en ajouter.`);
      }
      this.db
        .prepare('INSERT INTO voice_clips (id, profile_id, name, mime, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, profileId, name, mime, data, createdAt);
    });
    insert();
    return { id, name, createdAt };
  }

  renameVoice(profileId: string, voiceId: string, name: string): VoiceClip {
    const result = this.db
      .prepare('UPDATE voice_clips SET name = ? WHERE id = ? AND profile_id = ?')
      .run(name, voiceId, profileId);
    if (result.changes === 0) throw new ProfileError(404, 'Cette voix n’existe plus.');
    return this.voices(profileId).find((v) => v.id === voiceId)!;
  }

  deleteVoice(profileId: string, voiceId: string): void {
    const result = this.db.prepare('DELETE FROM voice_clips WHERE id = ? AND profile_id = ?').run(voiceId, profileId);
    if (result.changes === 0) throw new ProfileError(404, 'Cette voix n’existe plus.');
  }

  /** La voix si elle appartient à ce profil (la salle ne joue que les voix de son joueur). */
  ownedVoice(profileId: string, voiceId: string): { id: string; name: string } | undefined {
    const row = this.db
      .prepare('SELECT id, name FROM voice_clips WHERE id = ? AND profile_id = ?')
      .get(voiceId, profileId) as { id: string; name: string } | undefined;
    return row;
  }

  /** Son d’une voix, pour la route publique /api/voices/:id (les écrans n’ont pas de compte). */
  voiceAudio(voiceId: string): { mime: string; data: Buffer } | undefined {
    const row = this.db.prepare('SELECT mime, data FROM voice_clips WHERE id = ?').get(voiceId) as
      { mime: string; data: Buffer } | undefined;
    return row;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
  }

  /** Image de profil décodée, pour la route /api/avatars/:id. */
  avatarImage(profileId: string): { mime: string; data: Buffer } | undefined {
    const row = this.rowById(profileId);
    if (!row?.avatar_image) return undefined;
    const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(row.avatar_image);
    if (!match) return undefined;
    return { mime: match[1]!, data: Buffer.from(match[2]!, 'base64') };
  }

  recordResult(profileId: string, gameId: string, points: number, won: boolean): void {
    this.db
      .prepare(
        `INSERT INTO profile_stats (profile_id, game_id, played, wins, points) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(profile_id, game_id) DO UPDATE SET
           played = played + 1, wins = wins + excluded.wins, points = points + excluded.points`,
      )
      .run(profileId, gameId, won ? 1 : 0, Math.max(0, Math.round(points)));
  }

  stats(profileId: string): ProfileStats {
    const rows = this.db
      .prepare('SELECT game_id, played, wins, points FROM profile_stats WHERE profile_id = ? ORDER BY played DESC')
      .all(profileId) as { game_id: string; played: number; wins: number; points: number }[];
    const perGame = rows.map((r) => ({
      gameId: r.game_id,
      // Nom affiché : celui que l’administrateur a donné au jeu, s’il l’a renommé.
      name: this.gameName(r.game_id),
      played: r.played,
      wins: r.wins,
      points: r.points,
    }));
    return {
      played: perGame.reduce((n, g) => n + g.played, 0),
      wins: perGame.reduce((n, g) => n + g.wins, 0),
      points: perGame.reduce((n, g) => n + g.points, 0),
      perGame,
    };
  }
}
