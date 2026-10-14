import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GameModule } from '@partyhub/shared';
import type { PackageRow, Store } from '../db/store.js';
import { setCustomGames } from '../games-registry.js';
import {
  DEFAULT_PACKAGE_LIMITS,
  PackageValidationError,
  packageGameId,
  validatePackage,
  type PackageLimits,
  type PackageModule,
  type ValidatedPackage,
} from './format.js';
import { createPackageGame } from './factory.js';
import { launchCheck, type LaunchCheckOptions } from './launch-check.js';
import { compareVersions } from './semver.js';

const ARCHIVE_NAME = 'package.phgame';

const MODULE_LABEL: Record<PackageModule, string> = { cards: 'cartes', board: 'plateau', quiz: 'questions' };

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function gameIdOf(packageId: string, module: PackageModule = 'cards'): string {
  return packageGameId(packageId, module);
}

export interface PackageRecord {
  id: string;
  gameId: string;
  name: string;
  version: string;
  description: string;
  author: string;
  sha256: string;
  size: number;
  enabled: boolean;
  status: 'actif' | 'désactivé' | 'erreur';
  error?: string;
  installedAt: string;
}

interface Loaded {
  record: PackageRecord;
  /** Ressources graphiques seulement (assets/), servies par l'API publique. */
  assets: Map<string, Uint8Array>;
}

export type InstallResult =
  | { ok: true; id: string; gameId: string; version: string; unchanged: boolean; active: boolean }
  | { ok: false; error: string; issues?: string[] };

/** Une version connue d'un paquet : la version active ou une version conservée pour un retour arrière. */
export interface PackageVersionRecord {
  version: string;
  sha256: string;
  size: number;
  installedAt: string;
  active: boolean;
}

export interface PackageServiceOptions {
  limits?: PackageLimits;
  /** Réglages du lancement de contrôle (les tests réduisent le nombre de pas pour forcer un échec). */
  launch?: LaunchCheckOptions;
}

function sha256Of(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Gère les paquets `.phgame` installés. Chaque archive est conservée dans
 * `<dataDir>/games/<id>/<version>/package.phgame` et revalidée à chaque démarrage :
 * une archive modifiée à la main passe en état « erreur » au lieu d'être jouée.
 */
export class PackageService {
  private loaded = new Map<string, Loaded>();
  private readonly limits: PackageLimits;
  private readonly launch: LaunchCheckOptions;

  constructor(
    private readonly store: Store,
    private readonly dataDir: string,
    options: PackageServiceOptions = {},
  ) {
    this.limits = options.limits ?? DEFAULT_PACKAGE_LIMITS;
    this.launch = options.launch ?? {};
    this.reload();
  }

  private archivePath(id: string, version: string): string {
    return path.join(this.dataDir, 'games', id, version, ARCHIVE_NAME);
  }

  /** Relit toutes les archives installées et remplace les jeux du registre en bloc. */
  reload(): void {
    const next = new Map<string, Loaded>();
    const modules: GameModule[] = [];
    for (const row of this.store.listPackages()) {
      const manifest = parseStoredManifest(row.manifest);
      const gameId = gameIdOf(row.id, manifest.module);
      const enabled = this.store.isGameEnabled(gameId);
      const base = {
        id: row.id,
        gameId,
        name: row.name,
        version: row.version,
        description: manifest.description,
        author: manifest.author,
        sha256: row.sha256,
        size: row.size,
        enabled,
        installedAt: row.installed_at,
      };
      try {
        const bytes = fs.readFileSync(this.archivePath(row.id, row.version));
        if (sha256Of(bytes) !== row.sha256) throw new Error('l’archive ne correspond plus à l’empreinte enregistrée');
        const pkg = validatePackage(bytes, this.limits);
        const module = createPackageGame(pkg);
        next.set(row.id, {
          record: { ...base, status: enabled ? 'actif' : 'désactivé' },
          assets: assetsOf(pkg),
        });
        if (enabled) modules.push(module);
      } catch (err) {
        next.set(row.id, {
          record: { ...base, status: 'erreur', error: errorMessage(err) },
          assets: new Map(),
        });
      }
    }
    this.loaded = next;
    setCustomGames('packages', modules);
  }

  list(): PackageRecord[] {
    return [...this.loaded.values()].map((entry) => entry.record);
  }

  get(id: string): PackageRecord | undefined {
    return this.loaded.get(id)?.record;
  }

  /**
   * Installe un paquet. Une version plus récente devient la version active, et l'ancienne reste
   * conservée. Une version plus ancienne est conservée sans être activée : elle sert au retour
   * arrière. Refuse un paquet invalide, un paquet qui ne se lance pas, et une version déjà connue
   * dont le contenu diffère.
   */
  install(bytes: Uint8Array): InstallResult {
    let pkg: ValidatedPackage;
    try {
      pkg = validatePackage(bytes, this.limits);
    } catch (err) {
      if (err instanceof PackageValidationError) {
        return { ok: false, error: 'Paquet refusé.', issues: err.issues };
      }
      throw err;
    }
    const { manifest } = pkg;
    const gameId = gameIdOf(manifest.id, pkg.module);
    const current = this.store.getPackage(manifest.id);

    if (current) {
      const installedModule = parseStoredManifest(current.manifest).module;
      if (installedModule !== pkg.module) {
        return {
          ok: false,
          error: `Ce paquet est un jeu de ${MODULE_LABEL[pkg.module]}, alors que « ${manifest.id} » est installé comme jeu de ${MODULE_LABEL[installedModule]}. Changez d’identifiant pour l’installer.`,
        };
      }
    }

    const known =
      current?.version === manifest.version ? current : this.store.getPackageArchive(manifest.id, manifest.version);
    if (known) {
      if (known.sha256 === pkg.sha256) {
        return {
          ok: true,
          id: manifest.id,
          gameId,
          version: manifest.version,
          unchanged: true,
          active: known.version === current?.version,
        };
      }
      return {
        ok: false,
        error: `La version ${manifest.version} est déjà présente avec un contenu différent. Augmentez le numéro de version.`,
      };
    }

    // Plus récente que la version active (ou premier paquet) : elle devient active. Sinon, elle est seulement conservée.
    const activate = !current || compareVersions(manifest.version, current.version) > 0;

    let mod: GameModule;
    try {
      mod = createPackageGame(pkg);
    } catch (err) {
      return { ok: false, error: `Le jeu ne peut pas être créé : ${errorMessage(err)}.` };
    }
    const check = launchCheck(mod, this.launch);
    if (!check.ok) {
      return { ok: false, error: `Le jeu ne se lance pas correctement : ${check.error}.` };
    }

    const dir = path.join(this.dataDir, 'games', manifest.id, manifest.version);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${ARCHIVE_NAME}.tmp`);
    fs.writeFileSync(tmp, bytes, { mode: 0o644 });
    fs.renameSync(tmp, path.join(dir, ARCHIVE_NAME));

    const now = new Date().toISOString();
    const row: PackageRow = {
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      sha256: pkg.sha256,
      size: pkg.size,
      manifest: JSON.stringify(manifest),
      installed_at: now,
      updated_at: now,
    };
    if (activate) {
      this.store.activatePackage(row);
      if (!current) this.store.setGameEnabled(gameId, true);
    } else {
      this.store.saveArchive(row);
    }
    this.reload();
    return { ok: true, id: manifest.id, gameId, version: manifest.version, unchanged: false, active: activate };
  }

  /**
   * Rend active une version conservée : retour arrière, ou passage à une version plus récente
   * déjà importée. L'archive est revalidée avant ; une archive altérée ne remplace jamais la version active.
   */
  activate(id: string, version: string): { ok: true; version: string } | { ok: false; error: string } {
    const current = this.store.getPackage(id);
    if (!current) return { ok: false, error: 'Paquet inconnu.' };
    if (current.version === version) return { ok: true, version };
    const archive = this.store.getPackageArchive(id, version);
    if (!archive) return { ok: false, error: `La version ${version} n’est pas conservée pour ce paquet.` };
    try {
      const bytes = fs.readFileSync(this.archivePath(id, version));
      if (sha256Of(bytes) !== archive.sha256) throw new Error('l’archive ne correspond plus à l’empreinte enregistrée');
      createPackageGame(validatePackage(bytes, this.limits));
    } catch (err) {
      return { ok: false, error: `La version ${version} ne peut pas être activée : ${errorMessage(err)}` };
    }
    this.store.activatePackage(archive);
    this.reload();
    return { ok: true, version };
  }

  /** Toutes les versions connues d'un paquet, la plus récente d'abord. Undefined si le paquet est inconnu. */
  versions(id: string): PackageVersionRecord[] | undefined {
    const current = this.store.getPackage(id);
    if (!current) return undefined;
    return [current, ...this.store.listPackageArchives(id)]
      .map((row) => ({
        version: row.version,
        sha256: row.sha256,
        size: row.size,
        installedAt: row.installed_at,
        active: row.version === current.version,
      }))
      .sort((a, b) => compareVersions(b.version, a.version));
  }

  /**
   * Paquet actif relu et revalidé, pour en faire une copie modifiable. L'archive installée
   * n'est jamais modifiée : la copie est un jeu distinct, enregistré comme les jeux de l'administration.
   */
  readActive(id: string): { ok: true; pkg: ValidatedPackage } | { ok: false; error: string } {
    const entry = this.loaded.get(id);
    if (!entry) return { ok: false, error: 'Paquet inconnu.' };
    if (entry.record.status !== 'actif') {
      return { ok: false, error: 'Le paquet doit être actif pour être copié.' };
    }
    try {
      const bytes = fs.readFileSync(this.archivePath(id, entry.record.version));
      if (sha256Of(bytes) !== entry.record.sha256)
        throw new Error('l’archive ne correspond plus à l’empreinte enregistrée');
      return { ok: true, pkg: validatePackage(bytes, this.limits) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.loaded.get(id);
    if (!entry) return false;
    this.store.setGameEnabled(entry.record.gameId, enabled);
    this.reload();
    return true;
  }

  remove(id: string): boolean {
    const entry = this.loaded.get(id);
    if (!entry) return false;
    this.store.deletePackage(id, entry.record.gameId);
    fs.rmSync(path.join(this.dataDir, 'games', id), { recursive: true, force: true });
    this.reload();
    return true;
  }

  /** Ressource graphique d'un paquet actif. Retourne null pour tout autre cas (y compris un chemin inconnu). */
  asset(id: string, name: string): { bytes: Uint8Array; contentType: string } | null {
    const entry = this.loaded.get(id);
    if (!entry || entry.record.status !== 'actif') return null;
    const bytes = entry.assets.get(name);
    if (!bytes) return null;
    const dot = name.lastIndexOf('.');
    return { bytes, contentType: CONTENT_TYPES[name.slice(dot).toLowerCase()] ?? 'application/octet-stream' };
  }
}

function assetsOf(pkg: ValidatedPackage): Map<string, Uint8Array> {
  return new Map([...pkg.files].filter(([name]) => name.startsWith('assets/')));
}

function parseStoredManifest(raw: string): { description: string; author: string; module: PackageModule } {
  try {
    const parsed = JSON.parse(raw) as { description?: unknown; author?: unknown; requires?: { modules?: unknown } };
    const first = Array.isArray(parsed.requires?.modules) ? parsed.requires?.modules[0] : undefined;
    return {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      author: typeof parsed.author === 'string' ? parsed.author : '',
      module: first === 'board' || first === 'quiz' ? first : 'cards',
    };
  } catch {
    return { description: '', author: '', module: 'cards' };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof PackageValidationError) return err.issues.join(' ');
  return err instanceof Error ? err.message : String(err);
}
