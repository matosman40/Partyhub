import { createHash } from 'node:crypto';
import { canonical } from '../backup.js';
import type { BoardGameService } from '../boards/service.js';
import type { CardGameService } from '../cards/service.js';
import type { PackageCopyRow, Store } from '../db/store.js';
import type { MediaQuizService } from '../media/service.js';
import type { PackageModule } from './format.js';
import type { PackageService } from './service.js';

const COPY_SUFFIX = ' (copie)';

/** Nom d’une copie : « … (copie) », tronqué pour rester dans la limite de 40 caractères. */
export function copyNameOf(name: string): string {
  return `${name.slice(0, 40 - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

export interface CopyServices {
  packages: PackageService;
  cardGames: CardGameService;
  boardGames: BoardGameService;
  mediaGames: MediaQuizService;
  store: Store;
}

export type CopyResult = { ok: true; id: string; module: PackageModule; name: string } | { ok: false; error: string };

/** Empreinte du contenu d’une définition, indépendante de l’ordre des clés. */
export function definitionHash(definition: unknown): string {
  return createHash('sha256').update(canonical(definition)).digest('hex');
}

type Saved = { ok: true; id: string } | { ok: false; error: string };

/** Définition courante d’un jeu de l’administration, lue dans le service de son module. */
function currentDefinition(module: PackageModule, gameId: string, s: CopyServices): { name: string } | undefined {
  switch (module) {
    case 'cards':
      return s.cardGames.list().find((r) => r.id === gameId)?.definition;
    case 'board':
      return s.boardGames.list().find((r) => r.id === gameId)?.definition;
    case 'quiz':
      return s.mediaGames.get(gameId)?.definition;
    case 'recipe':
      return undefined;
  }
}

/** Enregistre une définition dans le service de l’administration du module (création si id est null). */
function saveDefinition(module: PackageModule, id: string | null, definition: unknown, s: CopyServices): Saved {
  switch (module) {
    case 'cards':
      return s.cardGames.save(id, definition);
    case 'board':
      return s.boardGames.save(id, definition);
    case 'quiz':
      return s.mediaGames.save(id, definition);
    case 'recipe':
      return { ok: false, error: NOT_COPYABLE };
  }
}

/** Message affiché quand un paquet ne peut pas devenir un jeu modifiable. */
const NOT_COPYABLE = 'Une recette ne se copie pas encore dans l’administration : elle reste un paquet.';

/**
 * Crée un jeu modifiable à partir d’un paquet actif : même définition, enregistrée dans le
 * service de l’administration correspondant au module (cartes, plateau ou questions). Le
 * paquet reste installé et inchangé. La copie garde le lien vers le paquet, la version copiée
 * et l’empreinte du contenu copié, pour savoir ensuite si elle a été modifiée.
 */
export function copyPackageToEditable(packageId: string, services: CopyServices): CopyResult {
  const read = services.packages.readActive(packageId);
  if (!read.ok) return read;
  const { pkg } = read;
  if (pkg.module === 'recipe') return { ok: false, error: NOT_COPYABLE };
  const name = copyNameOf(pkg.definition.name);
  const saved = saveDefinition(pkg.module, null, { ...pkg.definition, name }, services);
  if (!saved.ok) return saved;
  const stored = currentDefinition(pkg.module, saved.id, services) ?? { ...pkg.definition, name };
  services.store.savePackageCopy({
    gameId: saved.id,
    packageId,
    module: pkg.module,
    copiedVersion: pkg.manifest.version,
    copiedHash: definitionHash(stored),
  });
  return { ok: true, id: saved.id, module: pkg.module, name };
}

/** État d’une copie par rapport à son paquet d’origine. */
export interface PackageCopyStatus {
  gameId: string;
  packageId: string;
  module: PackageModule;
  name: string;
  copiedVersion: string;
  /** Version active du paquet d’origine, ou null si le paquet n’est pas disponible. */
  currentVersion: string | null;
  /** Vrai si la copie a été modifiée depuis sa création ou sa dernière mise à jour. */
  modified: boolean;
  /** Vrai si le paquet d’origine a une version différente de celle copiée. */
  updateAvailable: boolean;
  /** Vrai si le paquet d’origine a été supprimé. */
  originMissing: boolean;
}

/** État de toutes les copies, avec leur paquet d’origine. */
export function packageCopyStatuses(s: CopyServices): PackageCopyStatus[] {
  const statuses: PackageCopyStatus[] = [];
  for (const row of s.store.listPackageCopies()) {
    const definition = currentDefinition(row.module, row.gameId, s);
    if (!definition) continue;
    const origin = s.packages.get(row.packageId);
    const currentVersion = origin?.status === 'actif' ? origin.version : null;
    statuses.push({
      gameId: row.gameId,
      packageId: row.packageId,
      module: row.module,
      name: definition.name,
      copiedVersion: row.copiedVersion,
      currentVersion,
      modified: definitionHash(definition) !== row.copiedHash,
      updateAvailable: currentVersion !== null && currentVersion !== row.copiedVersion,
      originMissing: origin === undefined,
    });
  }
  return statuses;
}

export type UpdateCopyResult = { ok: true; version: string } | { ok: false; modified?: boolean; error: string };

/**
 * Remplace le contenu d’une copie par la version active de son paquet, en gardant son nom.
 * Une copie modifiée n’est remplacée qu’avec `force` : ses modifications sont alors perdues.
 */
export function updateCopyFromPackage(gameId: string, options: { force?: boolean }, s: CopyServices): UpdateCopyResult {
  const row: PackageCopyRow | undefined = s.store.getPackageCopy(gameId);
  if (!row) return { ok: false, error: 'Cette copie ne vient d’aucun paquet.' };
  const current = currentDefinition(row.module, gameId, s);
  if (!current) return { ok: false, error: 'Cette copie n’existe plus.' };
  const modified = definitionHash(current) !== row.copiedHash;
  if (modified && !options.force) {
    return {
      ok: false,
      modified: true,
      error:
        'La copie a été modifiée depuis sa création. Confirmez pour remplacer ses modifications par la version du paquet.',
    };
  }
  const read = s.packages.readActive(row.packageId);
  if (!read.ok) return { ok: false, error: `Le paquet d’origine n’est pas disponible : ${read.error}` };
  if (read.pkg.module !== row.module) return { ok: false, error: 'Le paquet ne correspond plus à ce type de jeu.' };
  const definition = { ...read.pkg.definition, name: current.name };
  const saved = saveDefinition(row.module, gameId, definition, s);
  if (!saved.ok) return { ok: false, error: saved.error };
  const stored = currentDefinition(row.module, gameId, s) ?? definition;
  s.store.savePackageCopy({
    gameId,
    packageId: row.packageId,
    module: row.module,
    copiedVersion: read.pkg.manifest.version,
    copiedHash: definitionHash(stored),
  });
  return { ok: true, version: read.pkg.manifest.version };
}
