import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gameRegistry } from '@partyhub/games';
import { BACKUP_FORMAT, backupSchema, type Backup, type GameNotice } from '@partyhub/shared';
import type { AssetRecord, AssetService } from './assets/service.js';
import type { BoardGameService } from './boards/service.js';
import type { CardGameService } from './cards/service.js';
import type { Store } from './db/store.js';
import { detailsOverride } from './game-details.js';
import type { MediaQuizService } from './media/service.js';
import type { PackageBackupEntry, PackageService } from './packages/service.js';
import { compareVersions } from './packages/semver.js';
import { formatBytes, readZip, writeZip, ZipError, type ZipFileEntry, type ZipReadLimits } from './packages/zip.js';

/**
 * Sauvegarde et restauration : jeux de cartes, jeux de questions médias, jeux de plateau,
 * présentation (nom, icône, description, notice) des jeux intégrés modifiés. Dans l’archive
 * complète s’ajoutent les fichiers de la médiathèque et les paquets `.phgame` installés
 * (chaque version, active ou conservée, avec son archive).
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
  /** Versions de paquets installées depuis l’archive, et versions déjà présentes à l’identique. */
  packages: number;
  packagesPresent: number;
  /** Jeux, fichiers ou paquets non restaurés, avec la raison. */
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
    packages: 0,
    packagesPresent: 0,
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
const ARCHIVE_PACKAGE_LIST = 'packages.json';
const ARCHIVE_PACKAGE_ENTRY = /^packages\/([a-z0-9][a-z0-9-]{1,47})\/([0-9][0-9A-Za-z.+-]{0,40})\.phgame$/;

/** Un paquet installé, tel qu'il est listé dans `packages.json`. */
export interface ArchivedPackage {
  id: string;
  version: string;
  active: boolean;
  sha256: string;
}

const ARCHIVE_READ_LIMITS: ZipReadLimits = {
  maxEntries: 50_000,
  maxEntryBytes: ARCHIVE_MAX_BYTES,
  maxTotalBytes: ARCHIVE_MAX_BYTES + 16 * 1024 * 1024,
  // Médias déjà compressés : le rapport reste proche de 1. Une valeur élevée révèle une archive piégée.
  maxRatio: 200,
  ratioCheckBytes: 1024 * 1024,
};

export class ArchiveTooLargeError extends Error {}

/**
 * Archive ZIP : backup.json (définitions), assets.json (fiches), assets/<id> (fichiers),
 * packages.json (paquets installés) et packages/<id>/<version>.phgame (leurs archives).
 */
export function buildArchive(backup: Backup, assets: AssetService, packages: PackageBackupEntry[] = []): Uint8Array {
  const records = assets.list().filter((r) => existsSync(assets.filePath(r.id)));
  const total = records.reduce((sum, r) => sum + r.size, 0);
  if (total > ARCHIVE_MAX_BYTES) {
    throw new ArchiveTooLargeError(
      `La médiathèque pèse ${formatBytes(total)} : au-delà de ${formatBytes(ARCHIVE_MAX_BYTES)}, l’archive complète est trop lourde. Copiez le dossier des médias à part.`,
    );
  }
  const enc = (text: string) => new TextEncoder().encode(text);
  const listed: ArchivedPackage[] = packages.map(({ id, version, active, sha256 }) => ({
    id,
    version,
    active,
    sha256,
  }));
  const files: ZipFileEntry[] = [
    { name: 'backup.json', data: enc(JSON.stringify(backup)) },
    { name: 'assets.json', data: enc(JSON.stringify(records)) },
    { name: ARCHIVE_PACKAGE_LIST, data: enc(JSON.stringify(listed)) },
    ...records.map((r) => ({ name: `assets/${r.id}`, data: readFileSync(assets.filePath(r.id)) })),
    ...packages.map((p) => ({ name: `packages/${p.id}/${p.version}.phgame`, data: p.bytes })),
  ];
  return writeZip(files);
}

export interface ParsedArchive {
  backup: unknown;
  assets: AssetRecord[];
  files: Map<string, Buffer>;
  packages: ArchivedPackage[];
  /** Archives des paquets, par « identifiant/version ». */
  packageFiles: Map<string, Buffer>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function parseArchivedPackages(raw: Uint8Array | undefined): ArchivedPackage[] {
  // Une archive antérieure à 0.12.0 n'a pas de liste de paquets : rien à restaurer.
  if (!raw) return [];
  const list = JSON.parse(Buffer.from(raw).toString('utf8')) as unknown;
  if (!Array.isArray(list)) throw new ZipError('Liste des paquets illisible.');
  return list.map((item) => {
    const p = item as Partial<ArchivedPackage>;
    if (
      typeof p.id !== 'string' ||
      typeof p.version !== 'string' ||
      typeof p.active !== 'boolean' ||
      typeof p.sha256 !== 'string' ||
      !SHA256_HEX.test(p.sha256)
    ) {
      throw new ZipError('Liste des paquets illisible.');
    }
    return { id: p.id, version: p.version, active: p.active, sha256: p.sha256 };
  });
}

export function readArchive(bytes: Uint8Array): ParsedArchive {
  const entries = readZip(bytes, ARCHIVE_READ_LIMITS, (name) => {
    if (
      name === 'backup.json' ||
      name === 'assets.json' ||
      name === ARCHIVE_PACKAGE_LIST ||
      ARCHIVE_ASSET_ENTRY.test(name) ||
      ARCHIVE_PACKAGE_ENTRY.test(name)
    )
      return;
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
  const packageFiles = new Map<string, Buffer>();
  for (const [name, data] of byName) {
    const match = ARCHIVE_ASSET_ENTRY.exec(name);
    if (match) files.set(match[1]!, Buffer.from(data));
    const pkg = ARCHIVE_PACKAGE_ENTRY.exec(name);
    if (pkg) packageFiles.set(`${pkg[1]}/${pkg[2]}`, Buffer.from(data));
  }
  return {
    backup: json('backup.json'),
    assets: records as AssetRecord[],
    files,
    packages: parseArchivedPackages(byName.get(ARCHIVE_PACKAGE_LIST)),
    packageFiles,
  };
}

/**
 * Réinstalle les paquets d’une archive. Chaque version passe par la même validation qu’un import
 * (schéma, moteur, lancement de test) ; une version refusée est signalée sans bloquer les autres.
 * Les versions sont importées de la plus ancienne à la plus récente, puis la version active sauvegardée
 * est appliquée si le paquet est nouveau, ou si le mode est « remplacer ». En mode « ajouter », la
 * version active déjà en place est conservée.
 */
function restorePackages(
  parsed: ParsedArchive,
  packages: PackageService | undefined,
  mode: ConflictMode,
): { installed: number; present: number; skipped: string[] } {
  const out = { installed: 0, present: 0, skipped: [] as string[] };
  if (parsed.packages.length === 0) return out;
  if (!packages) {
    out.skipped.push('Paquets installés : non restaurés (service des paquets absent).');
    return out;
  }
  const ids = [...new Set(parsed.packages.map((p) => p.id))];
  for (const id of ids) {
    const listed = parsed.packages.filter((p) => p.id === id);
    const hadPackage = packages.get(id) !== undefined;
    for (const entry of [...listed].sort((a, b) => compareVersions(a.version, b.version))) {
      const label = `« ${entry.id} » ${entry.version}`;
      const bytes = parsed.packageFiles.get(`${entry.id}/${entry.version}`);
      if (!bytes) {
        out.skipped.push(`${label} : fichier absent de l’archive.`);
        continue;
      }
      if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
        out.skipped.push(`${label} : l’archive ne correspond pas à son empreinte.`);
        continue;
      }
      const result = packages.install(bytes);
      if (!result.ok) {
        out.skipped.push(`${label} : ${result.error}`);
        continue;
      }
      if (result.unchanged) out.present++;
      else out.installed++;
    }
    const target = listed.find((p) => p.active);
    if (!target) continue;
    const current = packages.get(id)?.version;
    if (current !== target.version && (!hadPackage || mode === 'replace')) {
      const switched = packages.activate(id, target.version);
      if (!switched.ok) out.skipped.push(`« ${id} » : version ${target.version} non activée (${switched.error}).`);
    }
  }
  return out;
}

/**
 * Restaure une archive complète : les fichiers d’abord (les jeux de médias les référencent),
 * puis les définitions, puis les paquets installés. Les fichiers déjà présents ne sont jamais remplacés.
 */
export function restoreArchive(
  bytes: Uint8Array,
  deps: {
    store: Store;
    cards: CardGameService;
    media: MediaQuizService;
    boards: BoardGameService;
    assets: AssetService;
    packages?: PackageService;
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
  const pkg = restorePackages(parsed, deps.packages, options.conflict);
  return {
    ok: true,
    summary: {
      ...restored.summary,
      assets: summary.assets,
      assetsPresent: summary.assetsPresent,
      packages: pkg.installed,
      packagesPresent: pkg.present,
      skipped: [...summary.skipped, ...restored.summary.skipped, ...pkg.skipped],
    },
  };
}
