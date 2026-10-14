import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { PackageSourceRow, Store } from '../db/store.js';
import { PackageValidationError, validatePackage } from '../packages/format.js';
import type { PackageService } from '../packages/service.js';
import { GitHubError, downloadArchive, latestRelease, parseSource, type GitHubOptions } from './github.js';

/**
 * Sources GitHub des paquets : chaque source est un dépôt dont la dernière release contient un
 * `.phgame` et son `.sha256`. Une seule version par jeu est installée : la mise à jour remplace
 * l'ancienne, comme pour un import manuel. Un dépôt ne peut pas prendre un paquet qui n'est pas le sien.
 */

export interface PackageSourceRecord {
  id: string;
  repo: string;
  private: boolean;
  autoUpdate: boolean;
  packageId: string | null;
  installedVersion: string | null;
  latestVersion: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

export type CheckOutcome =
  | { ok: true; status: 'installé' | 'mis à jour' | 'à jour' | 'conservée'; version: string }
  | { ok: false; error: string; issues?: string[] };

const addSchema = z
  .object({
    repo: z.string().trim(),
    private: z.boolean().default(false),
    autoUpdate: z.boolean().default(false),
  })
  .strict();

const updateSchema = z
  .object({
    private: z.boolean().optional(),
    autoUpdate: z.boolean().optional(),
  })
  .strict();

function toRecord(row: PackageSourceRow): PackageSourceRecord {
  return {
    id: row.id,
    repo: row.repo,
    private: row.private === 1,
    autoUpdate: row.auto_update === 1,
    packageId: row.package_id,
    installedVersion: row.installed_version,
    latestVersion: row.latest_version,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
  };
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface PackageSourceOptions {
  /** Jeton GitHub du serveur (GITHUB_TOKEN). Absent = seuls les dépôts publics sont accessibles. */
  token?: string;
  /** Client HTTP injectable (tests). */
  fetch?: typeof fetch;
}

export class PackageSourceService {
  private readonly running = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly packages: PackageService,
    private readonly options: PackageSourceOptions = {},
  ) {}

  /** Vrai si le serveur dispose d'un jeton GitHub. Le jeton lui-même n'est jamais exposé. */
  get tokenConfigured(): boolean {
    return Boolean(this.options.token);
  }

  list(): PackageSourceRecord[] {
    return this.store.listPackageSources().map(toRecord);
  }

  add(input: unknown): { ok: true; id: string } | { ok: false; error: string } {
    const parsed = addSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Données de la source invalides.' };
    const { repo } = parsed.data;
    if (!parseSource(repo)) {
      return { ok: false, error: 'Dépôt invalide : indiquez auteur/nom, ou auteur/depot/jeu pour un dépôt commun.' };
    }
    if (this.store.listPackageSources().some((row) => row.repo === repo)) {
      return { ok: false, error: 'Cette source existe déjà.' };
    }
    if (parsed.data.private && !this.tokenConfigured) {
      return { ok: false, error: 'Un dépôt privé demande GITHUB_TOKEN dans la configuration du serveur.' };
    }
    const id = `src-${randomBytes(4).toString('hex')}`;
    this.store.savePackageSource({
      id,
      repo,
      private: parsed.data.private ? 1 : 0,
      auto_update: parsed.data.autoUpdate ? 1 : 0,
      package_id: null,
      installed_version: null,
      latest_version: null,
      last_checked_at: null,
      last_error: null,
      created_at: new Date().toISOString(),
    });
    return { ok: true, id };
  }

  update(id: string, input: unknown): { ok: true } | { ok: false; error: string; notFound?: boolean } {
    const row = this.store.getPackageSource(id);
    if (!row) return { ok: false, error: 'Source inconnue.', notFound: true };
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Données de la source invalides.' };
    const nextPrivate = parsed.data.private ?? row.private === 1;
    if (nextPrivate && !this.tokenConfigured) {
      return { ok: false, error: 'Un dépôt privé demande GITHUB_TOKEN dans la configuration du serveur.' };
    }
    this.store.savePackageSource({
      ...row,
      private: nextPrivate ? 1 : 0,
      auto_update: (parsed.data.autoUpdate ?? row.auto_update === 1) ? 1 : 0,
    });
    return { ok: true };
  }

  /** Supprime la source. Le paquet installé reste en place, mais ne se met plus à jour. */
  remove(id: string): boolean {
    if (!this.store.getPackageSource(id)) return false;
    this.store.deletePackageSource(id);
    return true;
  }

  /** Vérifie la source et installe la dernière release si elle est plus récente. */
  async check(id: string): Promise<CheckOutcome> {
    const row = this.store.getPackageSource(id);
    if (!row) return { ok: false, error: 'Source inconnue.' };
    if (this.running.has(id)) return { ok: false, error: 'Une vérification est déjà en cours pour cette source.' };
    this.running.add(id);
    try {
      return await this.run(row);
    } finally {
      this.running.delete(id);
    }
  }

  /** Vérifie toutes les sources, ou seulement celles dont la mise à jour est automatique. */
  async checkAll(onlyAuto = false): Promise<{ id: string; repo: string; outcome: CheckOutcome }[]> {
    const results: { id: string; repo: string; outcome: CheckOutcome }[] = [];
    for (const row of this.store.listPackageSources()) {
      if (onlyAuto && row.auto_update !== 1) continue;
      results.push({ id: row.id, repo: row.repo, outcome: await this.check(row.id) });
    }
    return results;
  }

  /** Planifie la vérification des sources à mise à jour automatique (une fois par jour par défaut). */
  schedule(everyMs = DAY_MS): NodeJS.Timeout {
    const timer = setInterval(() => {
      void this.checkAll(true);
    }, everyMs);
    timer.unref();
    return timer;
  }

  private patch(id: string, fields: Partial<PackageSourceRow>): void {
    const row = this.store.getPackageSource(id);
    if (row) this.store.savePackageSource({ ...row, ...fields });
  }

  private async run(row: PackageSourceRow): Promise<CheckOutcome> {
    const github: GitHubOptions = { fetch: this.options.fetch, token: this.options.token };
    const checkedAt = new Date().toISOString();
    try {
      if (row.private === 1 && !this.options.token) throw new GitHubError('GITHUB_TOKEN n’est pas configuré.');

      const source = parseSource(row.repo);
      if (!source) throw new GitHubError('Source invalide : indiquez auteur/nom ou auteur/depot/jeu.');
      const release = await latestRelease(source.repo, github, source.game);
      this.patch(row.id, { latest_version: release.version, last_checked_at: checkedAt });

      if (row.package_id && row.installed_version === release.version) {
        this.patch(row.id, { last_error: null });
        return { ok: true, status: 'à jour', version: release.version };
      }

      const { bytes, expectedSha256 } = await downloadArchive(release, github);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expectedSha256) {
        throw new GitHubError('L’empreinte du fichier ne correspond pas à celle publiée avec la release. Fichier refusé.');
      }

      let manifestId: string;
      let manifestVersion: string;
      try {
        const pkg = validatePackage(bytes);
        manifestId = pkg.manifest.id;
        manifestVersion = pkg.manifest.version;
      } catch (err) {
        if (err instanceof PackageValidationError) {
          this.patch(row.id, { last_error: 'Paquet refusé.' });
          return { ok: false, error: 'Paquet refusé.', issues: err.issues };
        }
        throw err;
      }

      if (manifestVersion !== release.version) {
        throw new GitHubError(
          `Le fichier annonce la version ${manifestVersion}, mais la release est la version ${release.version}.`,
        );
      }
      if (source.game && source.game !== manifestId) {
        throw new GitHubError(`Ce jeu du dépôt commun s’appelle « ${source.game} », pas « ${manifestId} ».`);
      }
      if (row.package_id && row.package_id !== manifestId) {
        throw new GitHubError(`Cette source fournit « ${manifestId} », pas « ${row.package_id} ».`);
      }
      const installed = this.store.getPackage(manifestId);
      if (installed && row.package_id !== manifestId) {
        throw new GitHubError(`Un paquet « ${manifestId} » est déjà installé et n’est pas lié à cette source.`);
      }

      const result = this.packages.install(bytes);
      if (!result.ok) {
        this.patch(row.id, { last_error: result.error });
        return { ok: false, error: result.error, issues: result.issues };
      }
      if (!result.active) {
        // Version plus ancienne que la version active : conservée pour un retour arrière, mais pas activée.
        this.patch(row.id, { package_id: result.id, last_error: null });
        return { ok: true, status: 'conservée', version: result.version };
      }
      this.patch(row.id, { package_id: result.id, installed_version: result.version, last_error: null });
      const status = result.unchanged ? 'à jour' : installed ? 'mis à jour' : 'installé';
      return { ok: true, status, version: result.version };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue.';
      this.patch(row.id, { last_checked_at: checkedAt, last_error: message });
      return { ok: false, error: message };
    }
  }
}
