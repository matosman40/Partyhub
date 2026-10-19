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
import { codeJobRunner, hasKnownAiJobs } from './ai-jobs.js';
import { launchCheckAsync, type LaunchCheckOptions, type LaunchCheckResult } from '../packages/launch-check.js';
import { PackageValidationError } from '../packages/format.js';
import { changedHunks, countChanges, diffLines, type DiffLine } from './diff.js';

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
  /** Le jeu active demande des travaux d'IA : l'administrateur peut l'autoriser à utiliser la clé du serveur. */
  aiJobs: boolean;
  /** L'administrateur a autorisé ce jeu à utiliser l'IA du serveur. */
  aiEnabled: boolean;
}

/** Différence avec la version active : seulement les lignes modifiées, et leur contexte. */
export interface CodeGameChanges {
  /** Version active, à laquelle la version relue est comparée. */
  from: string;
  server: DiffLine[];
  client: DiffLine[];
  counts: { server: { added: number; removed: number }; client: { added: number; removed: number } };
}

export interface CodeGameReview extends CodeGameSummary {
  description: string;
  author: string;
  files: { path: string; size: number; sha256: string }[];
  /** Code à relire : bundles serveur (règles) et navigateur (vues), tels qu'ils seront exécutés. */
  sources: { server: string; client: string };
  /** Différence avec la version active, quand il en existe une autre. */
  changes: CodeGameChanges | null;
}

export type CodeGameInstallResult =
  | { ok: true; id: string; version: string; sha256: string; signer: string; unchanged: boolean }
  | { ok: false; error: string; issues?: string[] };

/** `enabled` : le jeu est-il activé dans l'administration (une approbation ne le change pas). */
export type CodeGameOutcome = { ok: true; enabled?: boolean } | { ok: false; error: string };

/**
 * Ce que le magasin et les sources GitHub utilisent des jeux de code. Rien ici n'active un jeu : une installation
 * arrive en attente de revue, et seul l'administrateur l'approuve (voir `approve`).
 */
export interface CodeGamesPort {
  /** Identifiant et version d'un paquet, signature comprise, sans rien installer. */
  inspect(
    bytes: Uint8Array,
  ): { ok: true; id: string; version: string } | { ok: false; error: string; issues: string[] };
  install(bytes: Uint8Array, actor?: string): Promise<CodeGameInstallResult>;
  /** Vrai si cette version est déjà installée (en attente, active ou remplacée). */
  has(id: string, version: string): boolean;
  list(): CodeGameSummary[];
  remove(id: string, version: string, actor?: string): CodeGameOutcome;
}

interface Loaded {
  module: GameModule;
  runtime: CodeGameRuntime;
  version: string;
  sha256: string;
}

/** Événement d'administration, écrit au journal : installation, approbation, arrêt, suppression, rechargement. */
export type CodeGameAudit = (event: string, data: Record<string, unknown>, message: string) => void;

export interface CodeGameServiceOptions {
  /** Clés de confiance, relues à chaque opération. */
  trustedKeys: () => TrustedKeys;
  launch?: LaunchCheckOptions;
  /** Journal d'erreurs (chargements au démarrage). */
  onError?: (message: string) => void;
  /** Journal d'audit des actions d'administration et des arrêts automatiques. */
  audit?: CodeGameAudit;
  /** Appelé quand un jeu s'arrête tout seul : ses salles doivent être fermées. */
  onStopped?: (id: string, reason: string) => void;
}

/**
 * Jeux de code : un paquet signé est installé en attente, relu par l'administrateur, puis approuvé.
 * Seule la version approuvée et active s'exécute, dans un isolat V8 (voir code-runtime.ts).
 * Une archive dont l'empreinte ou la signature ne correspond plus n'est jamais chargée.
 */
export class CodeGameService implements CodeGamesPort {
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
    const { id, name, version } = pkg.manifest;
    const runtime: CodeGameRuntime = new CodeGameRuntime(serverSource, undefined, {
      onStop: (reason) => this.handleStop(id, runtime, reason),
    });
    try {
      const module = createCodeModule(
        runtime,
        { script: clientSource, sha256: sha256Of(pkg.files.get(CODE_ENTRY_CLIENT)!) },
        codeJobRunner(id, () => this.store.isAiGameEnabled(id)),
      );
      if (module.manifest.id !== id || module.manifest.name !== name || module.manifest.version !== version) {
        throw new Error('le module ne correspond pas au manifeste (identifiant, nom ou version)');
      }
      return { module, runtime, version, sha256: pkg.sha256 };
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

  /**
   * Publie les jeux actifs au registre. L'activation dans l'administration n'est pas figée ici : le catalogue,
   * la création de salle et les vues la vérifient à chaque usage. Ainsi, réactiver un jeu le rend tout de suite
   * disponible, sans republication.
   */
  private publish(): void {
    setCustomGames(
      'code',
      [...this.active.values()].map((loaded) => loaded.module),
    );
  }

  /** Le runtime s'est arrêté tout seul (mémoire, délais répétés) : le jeu sort du catalogue, ses salles sont fermées. */
  private handleStop(id: string, runtime: CodeGameRuntime, reason: string): void {
    const current = this.active.get(id);
    if (!current || current.runtime !== runtime) return;
    this.active.delete(id);
    this.errors.set(id, `arrêté : ${reason}`);
    this.options.audit?.(
      'code_game.stopped',
      { id, version: current.version, sha256: current.sha256, reason },
      `Jeu de code « ${id} » arrêté : ${reason}`,
    );
    this.publish();
    this.options.onStopped?.(id, reason);
  }

  /**
   * Relit les versions actives depuis la base et les archives. Un jeu inchangé garde son runtime, donc ses
   * salles continuent. Un jeu retiré ou remplacé est arrêté : son identifiant est renvoyé, pour fermer ses salles.
   */
  reload(actor?: string): { closed: string[]; active: number } {
    const wanted = new Map<string, CodeGameRow>();
    for (const row of this.store.listCodeGames()) if (row.active === 1) wanted.set(row.id, row);

    // Un jeu inchangé garde son runtime, mais sa signature est vérifiée de nouveau : une clé retirée révoque ce qu'elle a signé.
    const closed: string[] = [];
    for (const [id, loaded] of [...this.active]) {
      const row = wanted.get(id);
      if (row && row.version === loaded.version && row.sha256 === loaded.sha256 && this.stillTrusted(row)) continue;
      this.stop(id);
      closed.push(id);
    }
    for (const id of [...this.errors.keys()]) if (!wanted.has(id)) this.errors.delete(id);
    for (const row of wanted.values()) {
      if (this.active.has(row.id)) continue;
      try {
        this.activate(row);
      } catch (err) {
        const message = errorMessage(err);
        this.errors.set(row.id, message);
        this.options.onError?.(`Jeu de code « ${row.id} » non chargé : ${message}`);
      }
    }
    this.publish();
    if (actor !== undefined) {
      this.options.audit?.(
        'code_game.reloaded',
        { actor, closed, active: this.active.size },
        `Jeux de code relus (${this.active.size} actif(s)) par ${actor}`,
      );
    }
    return { closed, active: this.active.size };
  }

  /** Vrai si l'archive d'une version est encore signée par une clé de confiance. */
  private stillTrusted(row: CodeGameRow): boolean {
    try {
      this.validate(fs.readFileSync(this.archivePath(row.id, row.version)));
      return true;
    } catch {
      return false;
    }
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

  /**
   * Installe un paquet signé en attente de revue. Le contrôle de lancement rend la main au serveur pendant son
   * calcul ; la version est revérifiée ensuite, car une autre requête a pu la fournir entre-temps.
   */
  /** Identifiant et version d'un paquet, après les mêmes vérifications que l'installation. Rien n'est écrit. */
  inspect(
    bytes: Uint8Array,
  ): { ok: true; id: string; version: string } | { ok: false; error: string; issues: string[] } {
    try {
      const pkg = this.validate(bytes);
      return { ok: true, id: pkg.manifest.id, version: pkg.manifest.version };
    } catch (err) {
      if (err instanceof PackageValidationError) return { ok: false, error: 'Paquet refusé.', issues: err.issues };
      throw err;
    }
  }

  has(id: string, version: string): boolean {
    return this.store.getCodeGame(id, version) !== undefined;
  }

  async install(bytes: Uint8Array, actor = 'inconnu'): Promise<CodeGameInstallResult> {
    let pkg: ValidatedCodePackage;
    try {
      pkg = this.validate(bytes);
    } catch (err) {
      if (err instanceof PackageValidationError) return { ok: false, error: 'Paquet refusé.', issues: err.issues };
      throw err;
    }
    const { id, version } = pkg.manifest;
    const early = this.conflictOf(id, version, pkg);
    if (early) return early;

    let loaded: Loaded;
    try {
      loaded = this.load(pkg);
    } catch (err) {
      return { ok: false, error: `Le jeu ne peut pas être créé : ${errorMessage(err)}.` };
    }
    let check: LaunchCheckResult;
    try {
      check = await launchCheckAsync(loaded.module, this.options.launch);
    } finally {
      loaded.runtime.dispose();
    }
    if (!check.ok) return { ok: false, error: `Le jeu ne se lance pas correctement : ${check.error}.` };
    // Pendant le contrôle, une autre installation a pu arriver : on revérifie avant d'écrire.
    const late = this.conflictOf(id, version, pkg);
    if (late) return late;

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
    this.options.audit?.(
      'code_game.installed',
      { id, version, sha256: pkg.sha256, signer: pkg.signer ?? '', actor },
      `Jeu de code « ${id} » ${version} installé en attente de revue par ${actor}`,
    );
    return { ok: true, id, version, sha256: pkg.sha256, signer: pkg.signer ?? '', unchanged: false };
  }

  /**
   * Ce qui empêche d'installer ce paquet, ou la réponse à donner s'il est déjà là (sans rien écrire).
   * Null si l'installation peut se faire.
   */
  private conflictOf(id: string, version: string, pkg: ValidatedCodePackage): CodeGameInstallResult | null {
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
    return null;
  }

  /** Toutes les versions avec leur paquet, pour la sauvegarde complète. Une version dont l'archive manque est omise. */
  exportAll(): {
    id: string;
    version: string;
    sha256: string;
    active: boolean;
    approved: boolean;
    bytes: Uint8Array;
  }[] {
    return this.store.listCodeGames().flatMap((row) => {
      const file = this.archivePath(row.id, row.version);
      if (!fs.existsSync(file)) return [];
      return [
        {
          id: row.id,
          version: row.version,
          sha256: row.sha256,
          active: row.active === 1,
          approved: row.approved_sha256 !== null,
          bytes: new Uint8Array(fs.readFileSync(file)),
        },
      ];
    });
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
    const aiJobs =
      row.active === 1 && hasKnownAiJobs(row.id) && this.active.get(row.id)?.module.pendingJob !== undefined;
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
      aiJobs,
      aiEnabled: this.store.isAiGameEnabled(row.id),
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
    const active = this.store.getActiveCodeGame(id);
    return {
      ...this.summaryOf(row),
      description: pkg.manifest.description,
      author: pkg.manifest.author,
      files: pkg.manifest.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
      sources: { server: text(CODE_ENTRY_SERVER), client: text(CODE_ENTRY_CLIENT) },
      changes: active && active.version !== version ? this.changesFrom(active, pkg) : null,
    };
  }

  /** Lignes modifiées entre la version active et la version relue. Null si la version active ne se lit plus. */
  private changesFrom(previous: CodeGameRow, current: ValidatedCodePackage): CodeGameChanges | null {
    let old: ValidatedCodePackage;
    try {
      old = this.validate(fs.readFileSync(this.archivePath(previous.id, previous.version)));
    } catch {
      return null;
    }
    const lines = (pkg: ValidatedCodePackage, name: string) =>
      Buffer.from(pkg.files.get(name) ?? new Uint8Array())
        .toString('utf8')
        .split('\n');
    const server = diffLines(lines(old, CODE_ENTRY_SERVER), lines(current, CODE_ENTRY_SERVER));
    const client = diffLines(lines(old, CODE_ENTRY_CLIENT), lines(current, CODE_ENTRY_CLIENT));
    return {
      from: previous.version,
      server: changedHunks(server),
      client: changedHunks(client),
      counts: { server: countChanges(server), client: countChanges(client) },
    };
  }

  /**
   * Approuve une version : l'administrateur confirme l'empreinte qu'il a relue. Elle devient active,
   * et remplace la version active précédente.
   */
  async approve(id: string, version: string, sha256: string, actor = 'inconnu'): Promise<CodeGameOutcome> {
    const row = this.store.getCodeGame(id, version);
    if (!row) return { ok: false, error: 'Version inconnue.' };
    if (row.sha256 !== sha256) {
      return { ok: false, error: 'L’empreinte ne correspond pas : le paquet a changé depuis la revue.' };
    }
    let loaded: Loaded;
    try {
      const pkg = this.validate(fs.readFileSync(this.archivePath(id, version)));
      if (pkg.sha256 !== sha256) throw new Error('l’archive ne correspond plus à l’empreinte confirmée');
      loaded = this.load(pkg);
    } catch (err) {
      return { ok: false, error: `Approbation refusée : ${errorMessage(err)}` };
    }
    let check: LaunchCheckResult;
    try {
      check = await launchCheckAsync(loaded.module, this.options.launch);
    } catch (err) {
      loaded.runtime.dispose();
      return { ok: false, error: `Approbation refusée : ${errorMessage(err)}` };
    }
    if (!check.ok) {
      loaded.runtime.dispose();
      return { ok: false, error: `Le jeu ne se lance pas correctement : ${check.error}.` };
    }
    // Pendant le contrôle, la version a pu être supprimée ou remplacée : seule la version encore relue est approuvée.
    const current = this.store.getCodeGame(id, version);
    if (!current || current.sha256 !== sha256) {
      loaded.runtime.dispose();
      return { ok: false, error: 'Le paquet a changé pendant le contrôle : relisez-le avant d’approuver.' };
    }
    // Double demande : cette version est déjà active, rien à remplacer.
    if (this.active.get(id)?.sha256 === sha256) {
      loaded.runtime.dispose();
      return { ok: true, enabled: this.store.isGameEnabled(id) };
    }
    this.stop(id);
    this.active.set(id, loaded);
    this.store.activateCodeGame(id, version, sha256, new Date().toISOString());
    this.errors.delete(id);
    this.publish();
    // Approuver ne change pas l'activation du jeu : un jeu désactivé par l'administrateur le reste.
    const enabled = this.store.isGameEnabled(id);
    this.options.audit?.(
      'code_game.approved',
      { id, version, sha256, signer: row.signer, enabled, actor },
      `Jeu de code « ${id} » ${version} approuvé par ${actor}${enabled ? '' : ' (jeu désactivé : indisponible jusqu’à sa réactivation)'}`,
    );
    return { ok: true, enabled };
  }

  /**
   * Autorise ou retire l'IA du serveur pour un jeu de code actif qui en demande. Le réglage est relu à chaque
   * travail : rien à recharger, et retirer l'autorisation coupe l'accès tout de suite (le jeu prend son repli).
   */
  setAi(
    id: string,
    enabled: boolean,
    actor = 'inconnu',
  ): { ok: true; enabled: boolean } | { ok: false; error: string } {
    const loaded = this.active.get(id);
    if (!loaded) return { ok: false, error: 'Ce jeu n’est pas actif.' };
    if (!hasKnownAiJobs(id) || loaded.module.pendingJob === undefined) {
      return { ok: false, error: 'Ce jeu n’a pas de travail d’IA.' };
    }
    this.store.setAiGameEnabled(id, enabled);
    this.options.audit?.(
      'code_game.ai',
      { id, enabled, actor },
      `IA ${enabled ? 'autorisée' : 'retirée'} pour le jeu de code « ${id} » par ${actor}`,
    );
    return { ok: true, enabled };
  }

  /** Supprime une version. Supprimer la version active retire le jeu entier. */
  remove(id: string, version: string, actor = 'inconnu'): CodeGameOutcome {
    const row = this.store.getCodeGame(id, version);
    if (!row) return { ok: false, error: 'Version inconnue.' };
    this.options.audit?.(
      'code_game.removed',
      { id, version, sha256: row.sha256, actor },
      `Jeu de code « ${id} » ${version} supprimé par ${actor}`,
    );
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
    // Un jeu désactivé n'est plus publié : ses vues ne sont plus servies non plus.
    if (!this.store.isGameEnabled(id)) return undefined;
    return module.codeView.script;
  }
}

function sha256Of(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
