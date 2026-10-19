import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { PackageSourceOrigin, PackageSourceRow, Store } from '../db/store.js';
import type { CodeGamesPort } from '../code-games/service.js';
import { PackageValidationError, peekPackageKind, validatePackage } from '../packages/format.js';
import type { PackageService } from '../packages/service.js';
import { buildTagPackage } from '../store/build.js';
import {
  GitHubError,
  downloadArchive,
  latestRelease,
  latestTag,
  parseSource,
  tagFiles,
  type GitHubOptions,
  type SourceRef,
} from './github.js';

/**
 * Sources GitHub des paquets. Deux origines :
 * - « release » : la dernière release du dépôt contient un `.phgame` et son `.sha256` ;
 * - « tags » : le magasin. Le paquet est construit à partir du dossier `jeux/<jeu>/` au tag le plus haut, sans release
 *   ni signature (voir store/build.ts).
 * Une seule version par jeu est installée : la mise à jour remplace l’ancienne, comme pour un import manuel.
 * Un dépôt ne peut pas prendre un paquet qui n’est pas le sien.
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
  origin: PackageSourceOrigin;
}

export type CheckOutcome =
  | {
      ok: true;
      status: 'installé' | 'mis à jour' | 'à jour' | 'conservée' | 'en attente de revue';
      version: string;
    }
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
    origin: row.origin,
  };
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface PackageSourceOptions {
  /** Jeton GitHub du serveur (GITHUB_TOKEN). Absent = seuls les dépôts publics sont accessibles. */
  token?: string;
  /** Client HTTP injectable (tests). */
  fetch?: typeof fetch;
  /**
   * Jeux de code : un paquet de code arrive en attente de revue, jamais activé par la source. Sans ce port, une
   * release de code est refusée comme avant.
   */
  code?: CodeGamesPort;
}

export class PackageSourceService {
  private readonly running = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly packages: PackageService,
    private readonly options: PackageSourceOptions = {},
  ) {}

  /** Vrai si le serveur dispose d’un jeton GitHub. Le jeton lui-même n’est jamais exposé. */
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
      origin: 'release',
      created_at: new Date().toISOString(),
    });
    return { ok: true, id };
  }

  /**
   * Source du magasin : un jeu d’un dépôt commun (« auteur/depot/jeu »), lu à ses tags. Aucune release n’est
   * nécessaire, et la source se met à jour chaque jour comme les autres.
   */
  addFromStore(repo: string): { ok: true; id: string } | { ok: false; error: string } {
    const source = parseSource(repo);
    if (!source?.game) return { ok: false, error: 'Dépôt du magasin invalide : auteur/depot/jeu attendu.' };
    if (this.store.listPackageSources().some((row) => row.repo === repo)) {
      return { ok: false, error: 'Cette source existe déjà.' };
    }
    const id = `src-${randomBytes(4).toString('hex')}`;
    this.store.savePackageSource({
      id,
      repo,
      private: 0,
      auto_update: 1,
      package_id: null,
      installed_version: null,
      latest_version: null,
      last_checked_at: null,
      last_error: null,
      origin: 'tags',
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

  /**
   * Oublie la version installée d'une source, quand elle a été retirée ailleurs (« Paquets » ou « Jeux de code »).
   * La prochaine vérification réinstalle la dernière release, au lieu de la croire toujours présente.
   */
  forgetInstalled(id: string): void {
    const row = this.store.getPackageSource(id);
    if (row) this.store.savePackageSource({ ...row, package_id: null, installed_version: null });
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

  /**
   * Jeu de code : même contrôle de version et de dépôt qu'un paquet, puis installation en attente de revue.
   * Sans `unsigned`, la signature est vérifiée par l'installation, avec les clés de confiance de ce serveur. Avec
   * `unsigned` (paquet construit par le magasin), aucune signature n'est demandée : la revue reste obligatoire.
   */
  private async installCode(
    row: PackageSourceRow,
    source: SourceRef,
    releaseVersion: string,
    bytes: Uint8Array,
    code: CodeGamesPort,
    unsigned: boolean,
  ): Promise<CheckOutcome> {
    const inspected = code.inspect(bytes, { unsigned });
    if (!inspected.ok) {
      this.patch(row.id, { last_error: 'Paquet refusé.' });
      return { ok: false, error: 'Paquet refusé.', issues: inspected.issues };
    }
    const { id, version } = inspected;
    if (version !== releaseVersion) {
      throw new GitHubError(`Le fichier annonce la version ${version}, mais la version publiée est ${releaseVersion}.`);
    }
    if (source.game && source.game !== id) {
      throw new GitHubError(`Ce jeu du dépôt commun s’appelle « ${source.game} », pas « ${id} ».`);
    }
    if (row.package_id && row.package_id !== id) {
      throw new GitHubError(`Cette source fournit « ${id} », pas « ${row.package_id} ».`);
    }
    if (this.packages.get(id)) {
      throw new GitHubError(`Un paquet « ${id} » est déjà installé et n’est pas lié à cette source.`);
    }

    const result = await code.install(bytes, 'magasin', { unsigned });
    if (!result.ok) {
      this.patch(row.id, { last_error: result.error });
      return { ok: false, error: result.error, issues: result.issues };
    }
    this.patch(row.id, { package_id: id, installed_version: version, last_error: null });
    return result.unchanged
      ? { ok: true, status: 'à jour', version }
      : { ok: true, status: 'en attente de revue', version };
  }

  /**
   * Installe un paquet vérifié pour cette source : jeu de code (en attente de revue) ou paquet déclaratif (activé si
   * la version est la plus haute). `unsigned` vaut vrai seulement pour un paquet construit par le magasin.
   */
  private async installBytes(
    row: PackageSourceRow,
    source: SourceRef,
    version: string,
    bytes: Uint8Array,
    unsigned: boolean,
  ): Promise<CheckOutcome> {
    if (this.options.code && peekPackageKind(bytes) === 'code') {
      return this.installCode(row, source, version, bytes, this.options.code, unsigned);
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

    if (manifestVersion !== version) {
      throw new GitHubError(
        `Le fichier annonce la version ${manifestVersion}, mais la version publiée est ${version}.`,
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
  }

  /**
   * Source du magasin : le tag le plus haut du jeu donne la version. Son dossier `jeux/<jeu>/` est lu, puis le paquet
   * est construit et installé sans signature. Rien n’est lu depuis une release.
   */
  private async runTags(
    row: PackageSourceRow,
    source: SourceRef,
    github: GitHubOptions,
    checkedAt: string,
  ): Promise<CheckOutcome> {
    if (!source.game) throw new GitHubError('Source du magasin invalide : auteur/depot/jeu attendu.');
    const tag = await latestTag(source.repo, github, source.game);
    this.patch(row.id, { latest_version: tag.version, last_checked_at: checkedAt });

    if (row.package_id && row.installed_version === tag.version) {
      this.patch(row.id, { last_error: null });
      return { ok: true, status: 'à jour', version: tag.version };
    }

    const files = await tagFiles(source.repo, tag.tag, `jeux/${source.game}`, github);
    let bytes: Uint8Array;
    try {
      bytes = await buildTagPackage(source.game, files);
    } catch (err) {
      if (err instanceof PackageValidationError) {
        this.patch(row.id, { last_error: 'Paquet refusé.' });
        return { ok: false, error: 'Paquet refusé.', issues: err.issues };
      }
      throw err;
    }
    return this.installBytes(row, source, tag.version, bytes, true);
  }

  private async run(row: PackageSourceRow): Promise<CheckOutcome> {
    const github: GitHubOptions = { fetch: this.options.fetch, token: this.options.token };
    const checkedAt = new Date().toISOString();
    try {
      if (row.private === 1 && !this.options.token) throw new GitHubError('GITHUB_TOKEN n’est pas configuré.');

      const source = parseSource(row.repo);
      if (!source) throw new GitHubError('Source invalide : indiquez auteur/nom ou auteur/depot/jeu.');
      if (row.origin === 'tags') return await this.runTags(row, source, github, checkedAt);

      const release = await latestRelease(source.repo, github, source.game);
      this.patch(row.id, { latest_version: release.version, last_checked_at: checkedAt });

      if (row.package_id && row.installed_version === release.version) {
        this.patch(row.id, { last_error: null });
        return { ok: true, status: 'à jour', version: release.version };
      }

      const { bytes, expectedSha256 } = await downloadArchive(release, github);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expectedSha256) {
        throw new GitHubError(
          'L’empreinte du fichier ne correspond pas à celle publiée avec la release. Fichier refusé.',
        );
      }
      return await this.installBytes(row, source, release.version, bytes, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue.';
      this.patch(row.id, { last_checked_at: checkedAt, last_error: message });
      return { ok: false, error: message };
    }
  }
}
