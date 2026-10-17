import { existsSync, readFileSync } from 'node:fs';
import { gameRegistry } from '@partyhub/games';
import { BACKUP_FORMAT, backupSchema, type Backup, type GameNotice } from '@partyhub/shared';
import type { AssetRecord, AssetService } from './assets/service.js';
import type { BoardGameService } from './boards/service.js';
import type { CardGameService } from './cards/service.js';
import type { Store } from './db/store.js';
import { detailsOverride } from './game-details.js';
import type { MediaQuizService } from './media/service.js';
import { formatBytes, readZip, writeZip, ZipError, type ZipFileEntry, type ZipReadLimits } from './packages/zip.js';

/**
 * Sauvegarde et restauration : jeux de cartes, jeux de questions médias, jeux de plateau,
 * présentation (nom, icône, description, notice) des jeux intégrés modifiés, et, dans
 * l’archive complète, les fichiers de la médiathèque.
 */

/** Identifiants des jeux intégrés (ceux du code, jamais ceux de l’administration). */
const BUILTIN_IDS = gameRegistry.map((g) => g.manifest.id);

/** Taille maximale d’une archive complète (médiathèque comprise). */
export const ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;

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

/** Choix en cas de conflit : ajouter une copie (défaut), ou remplacer le jeu de même nom. */
export type ConflictMode = 'add' | 'replace';

export interface RestoreOptions {
  conflict: ConflictMode;
}

export interface RestoreSummary {
  cardGames: number;
  mediaGames: number;
  boardGames: number;
  details: number;
  notices: number;
  /** Jeux déjà présents à l’identique : non recréés. */
  duplicates: number;
  /** Jeux remplacés (même nom, mode « remplacer »). Compris dans les totaux ci-dessus. */
  replaced: number;
  /** Fichiers de la médiathèque ajoutés, et fichiers déjà présents (non remplacés). */
  assets: number;
  assetsPresent: number;
  /** Jeux ou fichiers non restaurés, avec la raison. */
  skipped: string[];
}

function emptySummary(): RestoreSummary {
  return {
    cardGames: 0,
    mediaGames: 0,
    boardGames: 0,
    details: 0,
    notices: 0,
    duplicates: 0,
    replaced: 0,
    assets: 0,
    assetsPresent: 0,
    skipped: [],
  };
}

/** JSON à clés triées : deux définitions identiques donnent exactement la même chaîne. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

interface Existing {
  id: string;
  definition: { name: string };
}

/**
 * Restaure les définitions d’un type de jeu. Une définition identique à une existante est
 * ignorée ; en mode « remplacer », un jeu de même nom est mis à jour au lieu d’être copié.
 */
function restoreKind(
  defs: { name: string }[],
  existing: () => Existing[],
  save: (id: string | null, def: { name: string }) => { ok: true } | { ok: false; error: string },
  options: RestoreOptions,
  summary: RestoreSummary,
  counter: 'cardGames' | 'mediaGames' | 'boardGames',
): void {
  for (const def of defs) {
    const current = existing();
    if (current.some((r) => canonical(r.definition) === canonical(def))) {
      summary.duplicates++;
      continue;
    }
    const same = options.conflict === 'replace' ? current.find((r) => r.definition.name === def.name) : undefined;
    const result = save(same ? same.id : null, def);
    if (result.ok) {
      summary[counter]++;
      if (same) summary.replaced++;
    } else {
      summary.skipped.push(`« ${def.name} » : ${result.error}`);
    }
  }
}

/**
 * Restaure une sauvegarde. Les jeux de cartes, de médias et de plateau sont ajoutés (ou remplacés
 * si demandé) ; la présentation des jeux intégrés est remplacée par celle de la sauvegarde.
 */
export function restoreBackup(
  input: unknown,
  store: Store,
  cards: CardGameService,
  media: MediaQuizService,
  boards: BoardGameService,
  options: RestoreOptions = { conflict: 'add' },
): { ok: true; summary: RestoreSummary } | { ok: false; error: string } {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Sauvegarde non reconnue.' };
  }
  const backup = parsed.data;
  const summary = emptySummary();

  restoreKind(
    backup.cardGames,
    () => cards.list(),
    (id, def) => cards.save(id, def),
    options,
    summary,
    'cardGames',
  );
  restoreKind(
    backup.mediaGames,
    () => media.list(),
    (id, def) => media.save(id, def),
    options,
    summary,
    'mediaGames',
  );
  restoreKind(
    backup.boardGames,
    () => boards.list(),
    (id, def) => boards.save(id, def),
    options,
    summary,
    'boardGames',
  );
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

// ---------- Archive complète : sauvegarde + médiathèque ----------

const ARCHIVE_ASSET_ENTRY = /^assets\/([0-9a-f]{32})$/;

const ARCHIVE_READ_LIMITS: ZipReadLimits = {
  maxEntries: 50_000,
  maxEntryBytes: ARCHIVE_MAX_BYTES,
  maxTotalBytes: ARCHIVE_MAX_BYTES + 16 * 1024 * 1024,
  // Médias déjà compressés : le rapport reste proche de 1. Une valeur élevée révèle une archive piégée.
  maxRatio: 200,
  ratioCheckBytes: 1024 * 1024,
};

export class ArchiveTooLargeError extends Error {}

/** Archive ZIP : backup.json (définitions), assets.json (fiches) et assets/<id> (fichiers). */
export function buildArchive(backup: Backup, assets: AssetService): Uint8Array {
  const records = assets.list().filter((r) => existsSync(assets.filePath(r.id)));
  const total = records.reduce((sum, r) => sum + r.size, 0);
  if (total > ARCHIVE_MAX_BYTES) {
    throw new ArchiveTooLargeError(
      `La médiathèque pèse ${formatBytes(total)} : au-delà de ${formatBytes(ARCHIVE_MAX_BYTES)}, l’archive complète est trop lourde. Copiez le dossier des médias à part.`,
    );
  }
  const enc = (text: string) => new TextEncoder().encode(text);
  const files: ZipFileEntry[] = [
    { name: 'backup.json', data: enc(JSON.stringify(backup)) },
    { name: 'assets.json', data: enc(JSON.stringify(records)) },
    ...records.map((r) => ({ name: `assets/${r.id}`, data: readFileSync(assets.filePath(r.id)) })),
  ];
  return writeZip(files);
}

export interface ParsedArchive {
  backup: unknown;
  assets: AssetRecord[];
  files: Map<string, Buffer>;
}

export function readArchive(bytes: Uint8Array): ParsedArchive {
  const entries = readZip(bytes, ARCHIVE_READ_LIMITS, (name) => {
    if (name === 'backup.json' || name === 'assets.json' || ARCHIVE_ASSET_ENTRY.test(name)) return;
    throw new ZipError(`Élément inattendu dans la sauvegarde : « ${name} ».`);
  });
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const json = (name: string): unknown => {
    const raw = byName.get(name);
    if (!raw) throw new ZipError(`Fichier « ${name} » absent de la sauvegarde.`);
    return JSON.parse(Buffer.from(raw).toString('utf8')) as unknown;
  };
  const records = json('assets.json');
  if (!Array.isArray(records)) throw new ZipError('Liste de fichiers illisible.');
  const files = new Map<string, Buffer>();
  for (const [name, data] of byName) {
    const match = ARCHIVE_ASSET_ENTRY.exec(name);
    if (match) files.set(match[1]!, Buffer.from(data));
  }
  return { backup: json('backup.json'), assets: records as AssetRecord[], files };
}

/**
 * Restaure une archive complète : les fichiers d’abord (les jeux de médias les référencent),
 * puis les définitions. Les fichiers déjà présents ne sont jamais remplacés.
 */
export function restoreArchive(
  bytes: Uint8Array,
  deps: {
    store: Store;
    cards: CardGameService;
    media: MediaQuizService;
    boards: BoardGameService;
    assets: AssetService;
  },
  options: RestoreOptions,
): { ok: true; summary: RestoreSummary } | { ok: false; error: string } {
  let parsed: ParsedArchive;
  try {
    parsed = readArchive(bytes);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Archive illisible.' };
  }
  const summary = emptySummary();
  for (const record of parsed.assets) {
    const data = parsed.files.get(record.id);
    if (!data) {
      summary.skipped.push(`« ${record.name} » : fichier absent de l’archive.`);
      continue;
    }
    const result = deps.assets.importRecord(record, data);
    if (!result.ok) summary.skipped.push(result.error);
    else if (result.status === 'added') summary.assets++;
    else summary.assetsPresent++;
  }
  const restored = restoreBackup(parsed.backup, deps.store, deps.cards, deps.media, deps.boards, options);
  if (!restored.ok) return restored;
  return {
    ok: true,
    summary: {
      ...restored.summary,
      assets: summary.assets,
      assetsPresent: summary.assetsPresent,
      skipped: [...summary.skipped, ...restored.summary.skipped],
    },
  };
}
