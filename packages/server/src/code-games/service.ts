import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GameModule } from '@partyhub/shared';
import type { CodeGameRow, Store } from '../db/store.js';
import { resolveGame, setCustomGames } from '../games-registry.js';
import {
  CODE_ENTRY_CLIENT,
  CODE_ENTRY_SERVER,
  keyIdOf,
  validateCodePackage,
  type ValidatedCodePackage,
} from '../packages/code-format.js';
import { CodeGameRuntime, createCodeModule } from '../packages/code-runtime.js';
import { launchCheck, type LaunchCheckOptions } from '../packages/launch-check.js';
import { PackageValidationError } from '../packages/format.js';

/** Dossier des clés publiques de confiance, dans DATA_DIR. Un fichier `*.pub.pem` par clé. */
export const TRUST_DIR_NAME = 'cles-de-confiance';
const ARCHIVE_NAME = 'package.phgame';

export type TrustedKeys = ReadonlyMap<string, KeyObject>;

export interface TrustLoadResult {
  keys: Map<string, KeyObject>;
  /** Fichiers ignorés, avec la raison : à afficher à l’administrateur. */
  problems: string[];
}

/** Charge les clés publiques de confiance. Une clé privée déposée par erreur est refusée, jamais chargée. */
export function loadTrustedKeys(dataDir: string): TrustLoadResult {
  const keys = new Map<string, KeyObject>();
  const problems: string[] = [];
  const dir = path.join(dataDir, TRUST_DIR_NAME);
  if (!fs.existsSync(dir)) return { keys, problems };
  for (const name of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.pub.pem'))
    .sort()) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    if (text.includes('PRIVATE KEY')) {
      problems.push(`${name} : une clé privée ne doit jamais être déposée ici, seulement la clé publique.`);
      continue;
    }
    try {
      const key = createPublicKey(text);
      if (key.asymmetricKeyType !== 'ed25519') {
        problems.push(`${name} : clé ${key.asymmetricKeyType ?? 'inconnue'} refusée, seule Ed25519 est acceptée.`);
        continue;
      }
      keys.set(keyIdOf(key), key);
    } catch {
      problems.push(`${name} : fichier de clé illisible.`);
    }
  }
  return { keys, problems };
}

export type CodeGameStatus = 'en_attente' | 'active' | 'remplacee' | 'erreur';

export interface CodeGameSummary {
  id: string;
  version: string;
  name: string;
  sha256: string;
  size: number;
  signer: string;
  installedAt: string;
  status: CodeGameStatus;
  error?: string;
}

export interface CodeGameReview extends CodeGameSummary {
  description: string;
  author: string;
  files: { path: string; size: number; sha256: string }[];
  /** Code à relire : bundles serveur (règles) et navigateur (vues), tels qu'ils seront exécutés. */
  sources: { server: string; client: string };
}

export type CodeGameInstallResult =
  | { ok: true; id: string; version: string; sha256: string; signer: string; unchanged: boolean }
  | { ok: false; error: string; issues?: string[] };

export type CodeGameOutcome = { ok: true } | { ok: false; error: string };

interface Loaded {
  module: GameModule;
  runtime: CodeGameRuntime;
}

export interface CodeGameServiceOptions {
  /** Clés de confiance, relues à chaque opération. */
  trustedKeys: () => TrustedKeys;
  launch?: LaunchCheckOptions;
  /** Journal d'erreurs (chargements au démarrage). */
  onError?: (message: string) => void;
}

/**
 * Jeux de code : un paquet signé est installé en attente, relu par l'administrateur, puis approuvé.
 * Seule la version approuvée et active s'exécute, dans un isolat V8 (voir code-runtime.ts).
 * Une archive dont l'empreinte ou la signature ne correspond plus n'est jamais chargée.
 */
export class CodeGameService {
  private active = new Map<string, Loaded>();
  private errors = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly dataDir: string,
    private readonly options: CodeGameServiceOptions,
  ) {
    this.reload();
  }

  private archiveDir(id: string, version: string): string {
    return path.join(this.dataDir, 'code-games', id, version);
  }

  private archivePath(id: string, version: string): string {
    return path.join(this.archiveDir(id, version), ARCHIVE_NAME);
  }

  private validate(bytes: Uint8Array): ValidatedCodePackage {
    const trusted = this.options.trustedKeys();
    if (trusted.size === 0) {
      throw new PackageValidationError([
        `Aucune clé de confiance n’est configurée. Déposez la clé publique dans DATA_DIR/${TRUST_DIR_NAME}/.`,
      ]);
    }
    return validateCodePackage(bytes, { trustedKeys: trusted, requireSignature: true });
  }

  /** Crée le runtime d'un paquet validé, après contrôle de son manifeste. Lève une erreur si le jeu ne fonctionne pas. */
  private load(pkg: ValidatedCodePackage): Loaded {
    const serverSource = Buffer.from(pkg.files.get(CODE_ENTRY_SERVER)!).toString('utf8');
    const clientSource = Buffer.from(pkg.files.get(CODE_ENTRY_CLIENT)!).toString('utf8');
    const runtime = new CodeGameRuntime(serverSource);
    try {
      const module = createCodeModule(runtime, {
        script: clientSource,
        sha256: sha256Of(pkg.files.get(CODE_ENTRY_CLIENT)!),
      });
      const { id, name, version } = pkg.manifest;
      if (module.manifest.id !== id || module.manifest.name !== name || module.manifest.version !== version) {
        throw new Error('le module ne correspond pas au manifeste (identifiant, nom ou version)');
      }
      return { module, runtime };
    } catch (err) {
      runtime.dispose();
      throw err;
    }
  }

  private stop(id: string): void {
    const previous = this.active.get(id);
    if (previous) previous.runtime.dispose();
    this.active.delete(id);
  }

  /** Publie les jeux actifs et activés au registre. Un jeu désactivé dans l'administration reste hors du catalogue. */
  private publish(): void {
    const modules = [...this.active.entries()]
      .filter(([id]) => this.store.isGameEnabled(id))
      .map(([, loaded]) => loaded.module);
    setCustomGames('code', modules);
  }

  /** Relit les versions actives depuis la base et les archives, et remplace les jeux de code en mémoire. */
  reload(): void {
    for (const id of [...this.active.keys()]) this.stop(id);
    this.errors = new Map();
    for (const row of this.store.listCodeGames()) {
      if (row.active !== 1) continue;
      try {
        this.activate(row);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.errors.set(row.id, message);
        this.options.onError?.(`Jeu de code « ${row.id} » non chargé : ${message}`);
      }
    }
    this.publish();
  }

  /** Charge une version active : archive, empreinte approuvée, signature et contrôle du jeu. */
  private activate(row: CodeGameRow): void {
    const bytes = fs.readFileSync(this.archivePath(row.id, row.version));
    if (sha256Of(bytes) !== row.sha256 || row.approved_sha256 !== row.sha256) {
      throw new Error('l’archive ne correspond plus à l’empreinte approuvée');
    }
    const pkg = this.validate(bytes);
    const loaded = this.load(pkg);
    this.stop(row.id);
    this.active.set(row.id, loaded);
    this.errors.delete(row.id);
  }

  /** Installe un paquet signé en attente de revue. Rien ne s'exécute encore hors du contrôle de lancement. */
  install(bytes: Uint8Array): CodeGameInstallResult {
    let pkg: ValidatedCodePackage;
    try {
      pkg = this.validate(bytes);
    } catch (err) {
      if (err instanceof PackageValidationError) return { ok: false, error: 'Paquet refusé.', issues: err.issues };
      throw err;
    }
    const { id, version } = pkg.manifest;
    const own = this.store.listCodeGames().some((row) => row.id === id);
    if (!own && resolveGame(id)) {
      return { ok: false, error: `L’identifiant « ${id} » est déjà utilisé par un autre jeu.` };
    }
    const existing = this.store.getCodeGame(id, version);
    if (existing) {
      if (existing.sha256 === pkg.sha256) {
        return { ok: true, id, version, sha256: pkg.sha256, signer: existing.signer, unchanged: true };
      }
      return {
        ok: false,
        error: `La version ${version} est déjà présente avec un contenu différent. Augmentez le numéro de version.`,
      };
    }

    let loaded: Loaded;
    try {
      loaded = this.load(pkg);
    } catch (err) {
      return { ok: false, error: `Le jeu ne peut pas être créé : ${errorMessage(err)}.` };
    }
    try {
      const check = launchCheck(loaded.module, this.options.launch);
      if (!check.ok) return { ok: false, error: `Le jeu ne se lance pas correctement : ${check.error}.` };
    } finally {
      loaded.runtime.dispose();
    }

    const dir = this.archiveDir(id, version);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${ARCHIVE_NAME}.tmp`);
    fs.writeFileSync(tmp, bytes, { mode: 0o644 });
    fs.renameSync(tmp, this.archivePath(id, version));

    this.store.saveCodeGame({
      id,
      version,
      name: pkg.manifest.name,
      sha256: pkg.sha256,
      size: pkg.size,
      signer: pkg.signer ?? '',
      manifest: JSON.stringify(pkg.manifest),
      installed_at: new Date().toISOString(),
    });
    return { ok: true, id, version, sha256: pkg.sha256, signer: pkg.signer ?? '', unchanged: false };
  }

  /** Liste des versions, avec leur état. */
  list(): CodeGameSummary[] {
    return this.store.listCodeGames().map((row) => this.summaryOf(row));
  }

  private summaryOf(row: CodeGameRow): CodeGameSummary {
    let status: CodeGameStatus;
    let error: string | undefined;
    if (row.active === 1) {
      status = this.errors.has(row.id) ? 'erreur' : 'active';
      error = this.errors.get(row.id);
    } else if (row.approved_sha256) {
      status = 'remplacee';
    } else {
      status = 'en_attente';
    }
    return {
      id: row.id,
      version: row.version,
      name: row.name,
      sha256: row.sha256,
      size: row.size,
      signer: row.signer,
      installedAt: row.installed_at,
      status,
      ...(error ? { error } : {}),
    };
  }

  /** Ce qu'il faut relire avant d'approuver : métadonnées, fichiers, et le code exécuté. */
  review(id: string, version: string): CodeGameReview | { error: string } {
    const row = this.store.getCodeGame(id, version);
    if (!row) return { error: 'Version inconnue.' };
    let pkg: ValidatedCodePackage;
    try {
      pkg = this.validate(fs.readFileSync(this.archivePath(id, version)));
    } catch (err) {
      return { error: `Archive refusée : ${errorMessage(err)}` };
    }
    if (pkg.sha256 !== row.sha256) return { error: 'L’archive ne correspond plus à l’empreinte enregistrée.' };
    const text = (name: string) => Buffer.from(pkg.files.get(name) ?? new Uint8Array()).toString('utf8');
    return {
      ...this.summaryOf(row),
      description: pkg.manifest.description,
      author: pkg.manifest.author,
      files: pkg.manifest.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
      sources: { server: text(CODE_ENTRY_SERVER), client: text(CODE_ENTRY_CLIENT) },
    };
  }

  /**
   * Approuve une version : l'administrateur confirme l'empreinte qu'il a relue. Elle devient active,
   * et remplace la version active précédente.
   */
  approve(id: string, version: string, sha256: string): CodeGameOutcome {
    const row = this.store.getCodeGame(id, version);
    if (!row) return { ok: false, error: 'Version inconnue.' };
    if (row.sha256 !== sha256) {
      return { ok: false, error: 'L’empreinte ne correspond pas : le paquet a changé depuis la revue.' };
    }
    try {
      const pkg = this.validate(fs.readFileSync(this.archivePath(id, version)));
      if (pkg.sha256 !== sha256) throw new Error('l’archive ne correspond plus à l’empreinte confirmée');
      const loaded = this.load(pkg);
      const check = launchCheck(loaded.module, this.options.launch);
      if (!check.ok) {
        loaded.runtime.dispose();
        return { ok: false, error: `Le jeu ne se lance pas correctement : ${check.error}.` };
      }
      this.stop(id);
      this.active.set(id, loaded);
    } catch (err) {
      return { ok: false, error: `Approbation refusée : ${errorMessage(err)}` };
    }
    this.store.activateCodeGame(id, version, sha256, new Date().toISOString());
    this.store.setGameEnabled(id, true);
    this.errors.delete(id);
    this.publish();
    return { ok: true };
  }

  /** Supprime une version. Supprimer la version active retire le jeu entier. */
  remove(id: string, version: string): CodeGameOutcome {
    const row = this.store.getCodeGame(id, version);
    if (!row) return { ok: false, error: 'Version inconnue.' };
    if (row.active === 1) {
      this.stop(id);
      this.store.deleteCodeGameAll(id, id);
      fs.rmSync(path.join(this.dataDir, 'code-games', id), { recursive: true, force: true });
    } else {
      this.store.deleteCodeGame(id, version);
      fs.rmSync(this.archiveDir(id, version), { recursive: true, force: true });
    }
    this.publish();
    return { ok: true };
  }

  /** Bundle des vues d'un jeu de code actif, pour l'empreinte demandée. Undefined sinon. */
  viewScript(id: string, sha256: string): string | undefined {
    const module = this.active.get(id)?.module;
    if (!module?.codeView || module.codeView.sha256 !== sha256) return undefined;
    return module.codeView.script;
  }
}

function sha256Of(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
