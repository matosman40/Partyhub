import fs from 'node:fs';
import path from 'node:path';
import { resolveGame } from '../games-registry.js';
import { PackageValidationError } from '../packages/format.js';
import { listFiles } from '../cli/list-files.js';
import { buildCodePackage, checkCodeBytes, newCodeGame, type CodeCheckReport } from './build.js';
import type { CodeGameService, CodeGameSummary } from './service.js';

/**
 * Brouillons des jeux de code : le dossier source d'un jeu, modifié dans l'administration.
 * Un brouillon vit dans DATA_DIR/jeux-en-cours/<id>/ et ne joue jamais. PartyHub ne détient aucune clé de
 * signature : l'auteur signe le dossier hors de PartyHub (commande phgame pack), puis le paquet arrive par le
 * dossier de dépôt ou par un lien HTTPS, en attente de revue.
 */

export const DRAFTS_DIR_NAME = 'jeux-en-cours';
/** Taille maximale d'un fichier source modifié dans l'éditeur. */
export const MAX_DRAFT_FILE_BYTES = 200 * 1024;

const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
/** Texte inséré dans les fichiers générés : pas de guillemets, d'antislash ni de retour à la ligne. */
const SAFE_TEXT = /^[^'"\\`$\n\r]+$/;
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.json', '.md', '.txt']);
/** Fichiers du modèle qu'on ne peut pas supprimer : sans eux, le jeu ne se construit plus. */
const PROTECTED = new Set(['manifest.json', 'src/server.ts', 'src/client.tsx']);

/** Erreur destinée à l'administrateur, avec le code HTTP à renvoyer. */
export class DraftError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

/**
 * Vrai si un chemin relatif est un fichier que l'éditeur peut lire et écrire : manifest.json, README.md,
 * src/ ou licenses/, en texte seulement. Null si le chemin est acceptable, sinon la raison.
 */
export function editablePathProblem(rel: string): string | null {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 200) return 'chemin invalide';
  if (!/^[A-Za-z0-9._/-]+$/.test(rel)) return 'caractères non autorisés dans le nom';
  if (rel.startsWith('/') || rel.endsWith('/') || rel.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    return 'chemin invalide';
  }
  const inside =
    rel === 'manifest.json' || rel === 'README.md' || rel.startsWith('src/') || rel.startsWith('licenses/');
  if (!inside) return 'seuls manifest.json, README.md, src/ et licenses/ sont modifiables ici';
  if (!TEXT_EXTENSIONS.has(path.extname(rel))) return 'extension non autorisée (.ts, .tsx, .json, .md, .txt)';
  return null;
}

export interface DraftSummary {
  id: string;
  name: string;
  version: string;
  /** Dernière modification du dossier, en ISO. */
  updatedAt: string;
  /** Dernière version installée de ce jeu, si elle existe. */
  installed: { version: string; status: CodeGameSummary['status'] } | null;
  /** Vrai si manifest.json ne se lit plus : à corriger dans l'éditeur. */
  broken: boolean;
}

export interface DraftDetail extends DraftSummary {
  description: string;
  author: string;
  files: { path: string; size: number; protected: boolean }[];
}

export interface DraftCreateValues {
  id: string;
  name: string;
  author: string;
}

export interface DraftMetadata {
  name?: string;
  description?: string;
  version?: string;
}

function errorLines(err: unknown): string[] {
  if (err instanceof PackageValidationError) return err.issues.length > 0 ? err.issues : [err.message];
  return [err instanceof Error ? err.message : String(err)];
}

/** Remplace la valeur d'un champ dans l'objet « manifest » de src/server.ts (premier champ de ce nom après lui). */
function replaceManifestField(source: string, field: string, value: string): string {
  const start = source.indexOf('const manifest');
  if (start < 0) throw new DraftError('src/server.ts : le bloc « const manifest » est introuvable.');
  const tail = source.slice(start);
  const pattern = new RegExp(`(\\b${field}: ')([^']*)(')`);
  if (!pattern.test(tail)) throw new DraftError(`src/server.ts : le champ « ${field} » du manifeste est introuvable.`);
  return (
    source.slice(0, start) +
    tail.replace(pattern, (_m, open: string, _old: string, close: string) => open + value + close)
  );
}

/** Ce qui se vérifie avant d'écrire une métadonnée : mêmes règles que le manifeste du paquet. */
function checkMetadata(field: keyof DraftMetadata, value: string): void {
  if (field === 'name' && (value.trim().length < 2 || value.length > 40)) {
    throw new DraftError('Nom : 2 à 40 caractères.');
  }
  if (field === 'description' && (value.trim().length < 1 || value.length > 160)) {
    throw new DraftError('Description : 1 à 160 caractères.');
  }
  if (field === 'version' && (!SEMVER.test(value) || value.length > 64)) {
    throw new DraftError('Version : au format X.Y.Z, par exemple 0.2.0.');
  }
  if (field !== 'version' && !SAFE_TEXT.test(value)) {
    throw new DraftError('Sans guillemets, apostrophes, antislash ni retour à la ligne.');
  }
}

/**
 * Brouillons de jeux de code et leur construction. La vérification exécute le code du jeu, avec les mêmes
 * contrôles que la commande phgame check.
 */
export class CodeDraftService {
  constructor(
    private readonly dataDir: string,
    private readonly codeGames: CodeGameService,
  ) {}

  private root(): string {
    return path.join(this.dataDir, DRAFTS_DIR_NAME);
  }

  /** Dossier du brouillon, pour un identifiant valide. Ne vérifie pas l'existence. */
  private dirOf(id: string): string {
    if (!ID.test(id)) throw new DraftError('Identifiant de jeu inconnu.', 404);
    return path.join(this.root(), id);
  }

  private requireDraft(id: string): string {
    const dir = this.dirOf(id);
    if (!fs.existsSync(dir)) throw new DraftError('Brouillon inconnu.', 404);
    return dir;
  }

  /** Chemin réel d'un fichier éditable. Refuse tout lien symbolique dans le chemin. */
  private fileOf(id: string, rel: string): string {
    const problem = editablePathProblem(rel);
    if (problem) throw new DraftError(`« ${rel} » : ${problem}.`);
    const dir = this.requireDraft(id);
    const target = path.join(dir, rel);
    let current = dir;
    for (const segment of rel.split('/').slice(0, -1)) {
      current = path.join(current, segment);
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
        throw new DraftError(`« ${rel} » : lien symbolique refusé.`);
      }
    }
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
      throw new DraftError(`« ${rel} » : lien symbolique refusé.`);
    }
    return target;
  }

  private readJson(dir: string): { name: string; version: string; description: string; author: string } | null {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
      return {
        name: String(data.name ?? ''),
        version: String(data.version ?? ''),
        description: String(data.description ?? ''),
        author: String(data.author ?? ''),
      };
    } catch {
      return null;
    }
  }

  private installedOf(id: string): DraftSummary['installed'] {
    const versions = this.codeGames
      .list()
      .filter((g) => g.id === id)
      .sort((a, b) => (a.installedAt < b.installedAt ? 1 : -1));
    const latest = versions[0];
    return latest ? { version: latest.version, status: latest.status } : null;
  }

  /** Date de la dernière modification d'un fichier du brouillon (la date du dossier ne suit pas les éditions). */
  private lastChangeOf(dir: string): string {
    try {
      const newest = listFiles(dir).reduce(
        (latest, rel) => Math.max(latest, fs.statSync(path.join(dir, rel)).mtimeMs),
        fs.statSync(dir).mtimeMs,
      );
      return new Date(newest).toISOString();
    } catch {
      return fs.statSync(dir).mtime.toISOString();
    }
  }

  private summaryOf(id: string): DraftSummary {
    const dir = path.join(this.root(), id);
    const meta = this.readJson(dir);
    return {
      id,
      name: meta?.name ?? id,
      version: meta?.version ?? '',
      updatedAt: this.lastChangeOf(dir),
      installed: this.installedOf(id),
      broken: meta === null,
    };
  }

  /** Brouillons existants, du plus récent au plus ancien. */
  list(): DraftSummary[] {
    if (!fs.existsSync(this.root())) return [];
    return fs
      .readdirSync(this.root(), { withFileTypes: true })
      .filter((d) => d.isDirectory() && ID.test(d.name))
      .map((d) => this.summaryOf(d.name))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  detail(id: string): DraftDetail {
    const dir = this.requireDraft(id);
    const meta = this.readJson(dir);
    const files = listFiles(dir)
      .filter((rel) => editablePathProblem(rel) === null)
      .map((rel) => ({ path: rel, size: fs.statSync(path.join(dir, rel)).size, protected: PROTECTED.has(rel) }));
    return {
      ...this.summaryOf(id),
      description: meta?.description ?? '',
      author: meta?.author ?? '',
      files,
    };
  }

  /** Nouveau brouillon à partir du modèle. L'identifiant doit être libre, dans les jeux comme dans les brouillons. */
  create(values: DraftCreateValues): DraftDetail {
    if (!ID.test(values.id)) {
      throw new DraftError('Identifiant : minuscules, chiffres et tirets (2 à 48 caractères).');
    }
    const dir = this.dirOf(values.id);
    if (fs.existsSync(dir)) throw new DraftError(`Un brouillon « ${values.id} » existe déjà.`, 409);
    if (resolveGame(values.id)) {
      throw new DraftError(`L’identifiant « ${values.id} » est déjà utilisé par un autre jeu.`, 409);
    }
    fs.mkdirSync(this.root(), { recursive: true });
    try {
      newCodeGame(dir, values);
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new DraftError(err instanceof Error ? err.message : String(err));
    }
    return this.detail(values.id);
  }

  readFile(id: string, rel: string): { path: string; content: string; size: number } {
    const file = this.fileOf(id, rel);
    if (!fs.existsSync(file)) throw new DraftError('Fichier introuvable.', 404);
    const size = fs.statSync(file).size;
    if (size > MAX_DRAFT_FILE_BYTES) throw new DraftError('Fichier trop grand pour l’éditeur.', 413);
    return { path: rel, content: fs.readFileSync(file, 'utf8'), size };
  }

  /** Écrit un fichier éditable. Un fichier modifié n'est pas vérifié ici : c'est l'étape « Vérifier ». */
  writeFile(id: string, rel: string, content: string): void {
    if (typeof content !== 'string') throw new DraftError('Contenu texte attendu.');
    const size = Buffer.byteLength(content, 'utf8');
    if (size > MAX_DRAFT_FILE_BYTES) throw new DraftError('Fichier trop grand (200 Ko au plus).', 413);
    if (content.includes('\u0000')) throw new DraftError('Fichier texte attendu.');
    const file = this.fileOf(id, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, content, { encoding: 'utf8' });
    fs.renameSync(tmp, file);
  }

  deleteFile(id: string, rel: string): void {
    if (PROTECTED.has(rel))
      throw new DraftError(`« ${rel} » ne peut pas être supprimé : le jeu ne se construirait plus.`);
    const file = this.fileOf(id, rel);
    if (!fs.existsSync(file)) throw new DraftError('Fichier introuvable.', 404);
    fs.rmSync(file);
  }

  /**
   * Nom, description ou version : écrits dans manifest.json et dans src/server.ts à la fois, pour qu'ils
   * restent identiques (le contrôle refuse un désaccord).
   */
  setMetadata(id: string, changes: DraftMetadata): void {
    const dir = this.requireDraft(id);
    const entries = Object.entries(changes).filter(([, v]) => v !== undefined) as [keyof DraftMetadata, string][];
    if (entries.length === 0) throw new DraftError('Rien à modifier.');
    for (const [field, value] of entries) checkMetadata(field, value);
    if (changes.version !== undefined) {
      const clash = this.codeGames.list().some((g) => g.id === id && g.version === changes.version);
      if (clash)
        throw new DraftError(`La version ${changes.version} est déjà installée. Choisissez un numéro plus grand.`, 409);
    }

    const serverFile = path.join(dir, 'src', 'server.ts');
    let server = fs.readFileSync(serverFile, 'utf8');
    const manifestFile = path.join(dir, 'manifest.json');
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
    } catch {
      throw new DraftError('manifest.json ne se lit plus : corrigez-le dans l’éditeur avant de le modifier.');
    }
    for (const [field, value] of entries) {
      server = replaceManifestField(server, field, value);
      manifest[field] = value;
    }
    fs.writeFileSync(serverFile, server);
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  /** Supprime le brouillon. Les versions déjà installées ne sont pas touchées. */
  remove(id: string): void {
    fs.rmSync(this.requireDraft(id), { recursive: true, force: true });
  }

  /** Construit le brouillon sans signature, puis le contrôle : partie complète jouée par des robots. */
  async check(id: string): Promise<CodeCheckReport> {
    const dir = this.requireDraft(id);
    try {
      const { bytes } = await buildCodePackage(dir);
      return await checkCodeBytes(bytes);
    } catch (err) {
      return { ok: false, lines: errorLines(err) };
    }
  }
}
