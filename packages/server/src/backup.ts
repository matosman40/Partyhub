import { gameRegistry } from '@partyhub/games';
import { BACKUP_FORMAT, backupSchema, type Backup, type GameNotice } from '@partyhub/shared';
import type { BoardGameService } from './boards/service.js';
import type { CardGameService } from './cards/service.js';
import type { Store } from './db/store.js';
import { detailsOverride } from './game-details.js';
import type { MediaQuizService } from './media/service.js';

/**
 * Sauvegarde et restauration : jeux de cartes, jeux de questions médias, et la présentation
 * (nom, icône, description, notice) des jeux intégrés qui ont été modifiés.
 */

/** Identifiants des jeux intégrés (ceux du code, jamais ceux de l'administration). */
const BUILTIN_IDS = gameRegistry.map((g) => g.manifest.id);

export function buildBackup(
  store: Store,
  cards: CardGameService,
  media: MediaQuizService,
  boards: BoardGameService,
): Backup {
  const gameDetails: Backup['gameDetails'] = {};
  const notices: Backup['notices'] = {};
  for (const id of BUILTIN_IDS) {
    const details = detailsOverride(store, id);
    if (details) gameDetails[id] = details;
    const raw = store.getNoticeOverride(id);
    if (raw) {
      try {
        notices[id] = JSON.parse(raw) as GameNotice;
      } catch {
        // Notice illisible : on ne la sauvegarde pas.
      }
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    cardGames: cards.list().map((r) => r.definition),
    mediaGames: media.list().map((r) => r.definition),
    boardGames: boards.list().map((r) => r.definition),
    gameDetails,
    notices,
  };
}

export interface RestoreSummary {
  cardGames: number;
  mediaGames: number;
  boardGames: number;
  details: number;
  notices: number;
  /** Jeux non restaurés, avec la raison (fichier absent de la médiathèque, par exemple). */
  skipped: string[];
}

/**
 * Restaure une sauvegarde. Les jeux de cartes et de médias sont ajoutés comme de nouveaux
 * jeux (identifiants neufs, rien n'est écrasé). La présentation des jeux intégrés est
 * remplacée par celle de la sauvegarde.
 */
export function restoreBackup(
  input: unknown,
  store: Store,
  cards: CardGameService,
  media: MediaQuizService,
  boards: BoardGameService,
): { ok: true; summary: RestoreSummary } | { ok: false; error: string } {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Sauvegarde non reconnue.' };
  }
  const backup = parsed.data;
  const summary: RestoreSummary = { cardGames: 0, mediaGames: 0, boardGames: 0, details: 0, notices: 0, skipped: [] };

  for (const definition of backup.cardGames) {
    const result = cards.save(null, definition);
    if (result.ok) summary.cardGames++;
    else summary.skipped.push(`« ${definition.name} » : ${result.error}`);
  }
  for (const definition of backup.mediaGames) {
    const result = media.save(null, definition);
    if (result.ok) summary.mediaGames++;
    else summary.skipped.push(`« ${definition.name} » : ${result.error}`);
  }
  for (const definition of backup.boardGames) {
    const result = boards.save(null, definition);
    if (result.ok) summary.boardGames++;
    else summary.skipped.push(`« ${definition.name} » : ${result.error}`);
  }
  for (const [id, details] of Object.entries(backup.gameDetails)) {
    if (!BUILTIN_IDS.includes(id)) continue;
    store.setDetailsOverride(id, JSON.stringify(details));
    summary.details++;
  }
  for (const [id, notice] of Object.entries(backup.notices)) {
    if (!BUILTIN_IDS.includes(id)) continue;
    store.setNoticeOverride(id, JSON.stringify(notice));
    summary.notices++;
  }
  return { ok: true, summary };
}
