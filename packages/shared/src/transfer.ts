import { z } from 'zod';
import { cardGameDefinitionSchema } from './card-games.js';
import { mediaQuizDefinitionSchema } from './media-quiz.js';
import { gameDetailsSchema, noticeSchema } from './schemas.js';

/**
 * Formats d'échange : un jeu exporté à part, ou une sauvegarde complète. Ces fichiers
 * peuvent venir d'une autre installation ; ils sont donc validés comme une saisie.
 */

/** Un jeu de cartes exporté. */
export const CARD_EXPORT_FORMAT = 'partyhub-jeux-cartes';

export const cardExportSchema = z.object({
  format: z.literal(CARD_EXPORT_FORMAT),
  version: z.literal(1),
  definition: cardGameDefinitionSchema,
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
  /** Nom, icône et description modifiés, par identifiant de jeu intégré. */
  gameDetails: z.record(z.string().max(60), gameDetailsSchema).default({}),
  /** Notices modifiées, par identifiant de jeu intégré. */
  notices: z.record(z.string().max(60), noticeSchema).default({}),
});

export type Backup = z.infer<typeof backupSchema>;
