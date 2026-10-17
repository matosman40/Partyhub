import { z } from 'zod';
import { boardGameDefinitionSchema } from './board-games.js';
import { cardGameDefinitionSchema } from './card-games.js';
import { mediaQuizDefinitionSchema } from './media-quiz.js';
import { gameDetailsSchema, noticeSchema } from './schemas.js';

/**
 * Formats d’échange : un jeu exporté à part, ou une sauvegarde complète. Ces fichiers
 * peuvent venir d’une autre installation ; ils sont donc validés comme une saisie.
 */

/**
 * Un jeu de cartes exporté. Version 2 : les fichiers de la médiathèque que le jeu utilise (image du dos,
 * police) sont joints, en base64, pour qu’il fonctionne sur une autre installation. Version 3 : cartes à
 * texte, paires, rangs, mécanique (mémo) et polices ou motifs livrés. Les versions 1 et 2 restent acceptées
 * à l’import ; une version antérieure à 3 refuse un fichier 3 au lieu d’ignorer ces champs.
 */
export const CARD_EXPORT_FORMAT = 'partyhub-jeux-cartes';
export const CARD_EXPORT_VERSION = 3 as const;

/** Fichier joint à un jeu de cartes exporté. `id` est l’identifiant qu’il a dans la définition. */
export const cardExportAssetSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/, 'Identifiant de fichier invalide.'),
  kind: z.enum(['image', 'font']),
  name: z.string().max(120).default('fichier'),
  /** Contenu du fichier, en base64 (5 Mo d’image ou 2 Mo de police, codés). */
  data: z.string().min(1).max(7_000_000, 'Fichier joint trop volumineux.'),
});

export type CardExportAsset = z.infer<typeof cardExportAssetSchema>;

export const cardExportSchema = z.object({
  format: z.literal(CARD_EXPORT_FORMAT),
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  definition: cardGameDefinitionSchema,
  assets: z.array(cardExportAssetSchema).max(2).default([]),
});

export type CardExport = z.infer<typeof cardExportSchema>;

/** Sauvegarde de tous les jeux personnalisés, des textes et des notices des jeux intégrés. */
export const BACKUP_FORMAT = 'partyhub-sauvegarde';
export const BACKUP_LIMIT = 200;

export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().max(40).optional(),
  cardGames: z.array(cardGameDefinitionSchema).max(BACKUP_LIMIT).default([]),
  mediaGames: z.array(mediaQuizDefinitionSchema).max(BACKUP_LIMIT).default([]),
  /** Jeux de plateau (0.6.2). Absent dans les sauvegardes précédentes : liste vide. */
  boardGames: z.array(boardGameDefinitionSchema).max(BACKUP_LIMIT).default([]),
  /** Nom, icône et description modifiés, par identifiant de jeu intégré. */
  gameDetails: z.record(z.string().max(60), gameDetailsSchema).default({}),
  /** Notices modifiées, par identifiant de jeu intégré. */
  notices: z.record(z.string().max(60), noticeSchema).default({}),
});

export type Backup = z.infer<typeof backupSchema>;
