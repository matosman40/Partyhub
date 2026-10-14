import { deviceInfoSchema } from './devices.js';
import { z } from 'zod';
import { ROOM_CODE_PATTERN } from './room-codes.js';
import { AVATAR_EMOJIS } from './avatars.js';

export const PLAYER_NAME_MAX = 16;

export const roomCodeSchema = z.string().trim().regex(ROOM_CODE_PATTERN, 'Code de salle invalide : 4 à 6 chiffres.');

export const playerNameSchema = z
  .string()
  .trim()
  .min(1, 'Entrez un pseudo')
  .max(PLAYER_NAME_MAX, `Pseudo trop long (${PLAYER_NAME_MAX} caractères maximum)`)
  .regex(/^[\p{L}\p{N} _.'-]+$/u, "Pseudo : lettres, chiffres, espaces et - _ . ' uniquement");

const tokenSchema = z.string().min(20).max(128);

export const createRoomSchema = z.object({
  gameId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  practice: z.boolean().optional(),
});

export const hostConnectSchema = z.object({
  code: roomCodeSchema,
  hostToken: tokenSchema,
});

export const joinSchema = z.object({
  code: roomCodeSchema,
  name: playerNameSchema,
  token: tokenSchema.optional(),
  profileToken: tokenSchema.optional(),
  device: deviceInfoSchema.optional(),
});

export const observerJoinSchema = z.object({
  code: roomCodeSchema,
  device: deviceInfoSchema.optional(),
});

export const chatSchema = z.object({
  text: z.string().trim().min(1).max(120),
});

/** Réactions autorisées : petit jeu fermé pour éviter les abus. */
export const REACTION_EMOJIS = ['👏', '😂', '🔥', '😱', '🎉', '👀', '💀', '❤️'] as const;
export const reactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});

export const PROFILE_USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(PROFILE_USERNAME_PATTERN, 'Identifiant : 3 à 20 caractères, lettres sans accent, chiffres ou _');

export const passwordSchema = z
  .string()
  .min(8, 'Mot de passe : 8 caractères minimum')
  .max(128, 'Mot de passe trop long');

/** Image de profil : data URL JPEG ou PNG, redimensionnée côté navigateur. */
export const avatarImageSchema = z
  .string()
  .max(60_000, 'Image trop lourde')
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Format d’image non reconnu');

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: playerNameSchema,
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(128),
});

export const profileUpdateSchema = z.object({
  displayName: playerNameSchema.optional(),
  avatarHue: z.number().int().min(0).max(359).optional(),
  avatarEmoji: z.enum(AVATAR_EMOJIS).optional(),
  avatarImage: avatarImageSchema.nullable().optional(),
  avatarShared: z.boolean().optional(),
});

export const passwordChangeSchema = z.object({
  current: z.string().min(1).max(128),
  next: passwordSchema,
});

export const noticeSchema = z.object({
  goal: z.string().trim().min(1).max(400),
  steps: z.array(z.string().trim().min(1).max(240)).max(12),
  tips: z.array(z.string().trim().min(1).max(240)).max(8),
});

/** Présentation d'un jeu intégré, modifiable par l'administrateur (le code du jeu reste le même). */
export const gameDetailsSchema = z.object({
  name: z.string().trim().min(3, 'Le nom doit compter au moins 3 caractères.').max(40),
  icon: z.string().trim().min(1).max(8),
  description: z.string().trim().min(1).max(200),
  /** Durée estimée affichée dans le catalogue, en minutes. Absente : celle du code. */
  durationMin: z.number().int().min(1).max(240).optional(),
});

export type GameDetails = z.infer<typeof gameDetailsSchema>;

export const configureSchema = z.object({
  gameSettings: z.record(z.string(), z.unknown()),
});

export const kickSchema = z.object({
  playerId: z.string().min(1).max(64),
});

export const readySchema = z.object({
  ready: z.boolean(),
});

export const actionSchema = z.object({
  commandId: z.string().min(1).max(64),
  type: z.string().min(1).max(40),
  payload: z.unknown().optional(),
});
