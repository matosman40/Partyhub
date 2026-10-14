import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCardGame } from '@partyhub/games';
import type { GameModule } from '@partyhub/shared';
import type { PackageRow, Store } from '../db/store.js';
import { setCustomGames } from '../games-registry.js';
import {
  DEFAULT_PACKAGE_LIMITS,
  PackageValidationError,
  validatePackage,
  type PackageLimits,
  type ValidatedPackage,
} from './format.js';
import { launchCheck, type LaunchCheckOptions } from './launch-check.js';
import { compareVersions } from './semver.js';

/** Préfixe des identifiants de jeux issus d'un paquet, pour les distinguer des autres sources. */
export const PACKAGE_GAME_PREFIX = 'pkg-';
const ARCHIVE_NAME = 'package.phgame';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function gameIdOf(packageId: string): string {
  return `${PACKAGE_GAME_PREFIX}${packageId}`;
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
  | { ok: true; id: string; gameId: string; version: string; unchanged: boolean }
  | { ok: false; error: string; issues?: string[] };

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
      const gameId = gameIdOf(row.id);
      const enabled = this.store.isGameEnabled(gameId);
      const manifest = parseStoredManifest(row.manifest);
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
        const module = createCardGame(pkg.definition, { id: gameId });
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
   * Installe ou met à jour un paquet. Refuse le retour arrière, une version identique
   * au contenu différent, et tout paquet qui ne passe pas la validation ou le lancement de contrôle.
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
    const gameId = gameIdOf(manifest.id);
    const current = this.store.getPackage(manifest.id);

    if (current) {
      const order = compareVersions(manifest.version, current.version);
      if (order < 0) {
        return {
          ok: false,
          error: `La version ${manifest.version} est plus ancienne que la version installée (${current.version}). Retour arrière refusé.`,
        };
      }
      if (order === 0) {
        if (current.sha256 === pkg.sha256) {
          return { ok: true, id: manifest.id, gameId, version: manifest.version, unchanged: true };
        }
        return {
          ok: false,
          error: `La version ${manifest.version} est déjà installée avec un contenu différent. Augmentez le numéro de version.`,
        };
      }
    }

    const check = launchCheck(pkg.definition, gameId, this.launch);
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
      installed_at: current?.installed_at ?? now,
      updated_at: now,
    };
    this.store.savePackage(row);
    if (!current) this.store.setGameEnabled(gameId, true);
    if (current && current.version !== manifest.version) {
      // La version précédente est retirée après une mise à jour réussie. Le retour arrière
      // se fait en réinstallant l'ancien fichier, qui reste sur votre ordinateur.
      fs.rmSync(path.join(this.dataDir, 'games', manifest.id, current.version), { recursive: true, force: true });
    }
    this.reload();
    return { ok: true, id: manifest.id, gameId, version: manifest.version, unchanged: false };
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

function parseStoredManifest(raw: string): { description: string; author: string } {
  try {
    const parsed = JSON.parse(raw) as { description?: unknown; author?: unknown };
    return {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      author: typeof parsed.author === 'string' ? parsed.author : '',
    };
  } catch {
    return { description: '', author: '' };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof PackageValidationError) return err.issues.join(' ');
  return err instanceof Error ? err.message : String(err);
}
