import { z } from 'zod';
import {
  boardGameDefinitionSchema,
  cardGameDefinitionSchema,
  mediaQuizDefinitionSchema,
  type BoardGameDefinition,
  type CardGameDefinition,
  type MediaQuizDefinition,
} from '@partyhub/shared';
import { PARTYHUB_ENGINE } from './engine.js';
import { readZip, ZipError, type ZipFileEntry, type ZipReadLimits } from './zip.js';
import { createHash } from 'node:crypto';
import { compareVersions, isValidVersion } from './semver.js';

/**
 * Format .phgame. Voir docs/PHGAME.md.
 * - Version 1 : jeux de cartes.
 * - Version 2 : jeux de cartes, jeux de plateau et jeux de questions (médias YouTube seulement).
 */
export const PHGAME_FORMAT_VERSIONS = [1, 2] as const;
export const PHGAME_FORMAT_VERSION = 2;

/** Module de jeu porté par un paquet. Un paquet en porte exactement un. */
export type PackageModule = (typeof PARTYHUB_ENGINE.modules)[number];

/**
 * Préfixe de l'identifiant du jeu dans le registre, selon le module. Les préfixes ne se recouvrent
 * jamais (« pkg- » n'est pas un début possible de « pkgb- » ni de « pkgq- »), donc deux paquets
 * de types différents ne peuvent pas partager un identifiant de jeu.
 */
const GAME_ID_PREFIX: Record<PackageModule, string> = { cards: 'pkg-', board: 'pkgb-', quiz: 'pkgq-' };

export function packageGameId(packageId: string, module: PackageModule = 'cards'): string {
  return `${GAME_ID_PREFIX[module]}${packageId}`;
}

export interface PackageLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxRatio: number;
  ratioCheckBytes: number;
  maxPathLength: number;
  maxDepth: number;
  maxJsonBytes: number;
  maxManifestBytes: number;
  maxImageSide: number;
}

export const DEFAULT_PACKAGE_LIMITS: PackageLimits = {
  maxArchiveBytes: 16 * 1024 * 1024,
  maxEntries: 200,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxRatio: 100,
  ratioCheckBytes: 1024 * 1024,
  maxPathLength: 200,
  maxDepth: 4,
  maxJsonBytes: 1024 * 1024,
  maxManifestBytes: 64 * 1024,
  maxImageSide: 2048,
};

const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Dossiers autorisés à la racine du paquet, avec les extensions admises dans chacun. */
const TOP_DIRS: Record<string, readonly string[]> = {
  game: ['.json'],
  assets: ['.png', '.jpg', '.jpeg', '.webp'],
  data: ['.json'],
  licenses: ['.txt', '.md'],
};

export const manifestSchema = z
  .object({
    format: z.literal('phgame'),
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    id: z.string().regex(ID, 'Identifiant : minuscules, chiffres et tirets (2 à 48 caractères).'),
    name: z.string().trim().min(2).max(40),
    version: z.string().max(64).refine(isValidVersion, 'Version attendue au format X.Y.Z.'),
    description: z.string().trim().min(1).max(160),
    author: z.string().trim().min(1).max(80),
    kind: z.literal('declarative'),
    engine: z.object({
      minVersion: z.string().refine(isValidVersion, 'Version minimale du moteur invalide.'),
      api: z.literal(PARTYHUB_ENGINE.api),
    }),
    requires: z.object({
      modules: z
        .array(z.enum(PARTYHUB_ENGINE.modules))
        .length(1, 'Un paquet déclare exactement un module de jeu (cards, board ou quiz).'),
    }),
    entry: z.literal('game/definition.json'),
    cover: z.string().optional(),
    licenses: z
      .array(
        z.object({
          path: z.string(),
          covers: z.array(z.string()).max(200),
        }),
      )
      .min(1, 'Au moins une licence ou attribution est requise.'),
    files: z.array(
      z.object({
        path: z.string(),
        size: z.number().int().min(0),
        sha256: z.string().regex(SHA256, 'Empreinte SHA-256 attendue (64 caractères hexadécimaux).'),
      }),
    ),
  })
  .strict();

export type PackageManifest = z.infer<typeof manifestSchema>;

/** Vérifie un chemin à l'intérieur du paquet. Retourne la raison du refus, ou null. */
export function pathProblem(name: string, limits: Pick<PackageLimits, 'maxPathLength' | 'maxDepth'>): string | null {
  if (name.length === 0 || name.length > limits.maxPathLength) return `chemin trop long ou vide`;
  if (name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.includes(':')) {
    return 'chemin absolu ou caractère interdit';
  }
  const parts = name.split('/');
  if (parts.length > limits.maxDepth) return 'chemin trop profond';
  for (const part of parts) {
    if (part === '.' || part === '..' || !SEGMENT.test(part)) return 'nom de fichier ou de dossier non autorisé';
  }
  if (parts.length === 1) return name === 'manifest.json' ? null : 'fichier hors dossier autorisé';
  const dir = parts[0]!;
  const allowed = TOP_DIRS[dir];
  if (!allowed) return `dossier « ${dir} » non autorisé`;
  const file = parts[parts.length - 1]!;
  const dot = file.lastIndexOf('.');
  const ext = dot > 0 ? file.slice(dot).toLowerCase() : '';
  if (!allowed.includes(ext)) return `type de fichier « ${ext || 'sans extension'} » non autorisé dans « ${dir}/ »`;
  return null;
}

/** Vérifie la signature d'un fichier image (PNG, JPEG, WebP) et, pour le PNG, ses dimensions. */
export function imageProblem(data: Uint8Array, ext: string, limits: PackageLimits): string | null {
  const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const isWebp =
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50;
  if (ext === '.png') {
    if (!isPng) return 'fichier .png invalide';
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length < 24) return 'fichier .png tronqué';
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width === 0 || height === 0 || width > limits.maxImageSide || height > limits.maxImageSide) {
      return `image trop grande (côté maximal ${limits.maxImageSide} px)`;
    }
    return null;
  }
  if (ext === '.jpg' || ext === '.jpeg') return isJpeg ? null : 'fichier JPEG invalide';
  if (ext === '.webp') return isWebp ? null : 'fichier WebP invalide';
  return null;
}

/** Définition validée, avec le module qui la porte. */
export type DefinitionValue =
  | { module: 'cards'; definition: CardGameDefinition }
  | { module: 'board'; definition: BoardGameDefinition }
  | { module: 'quiz'; definition: MediaQuizDefinition };

interface ValidatedBase {
  manifest: PackageManifest;
  files: Map<string, Uint8Array>;
  sha256: string;
  size: number;
}

export type ValidatedPackage = ValidatedBase & DefinitionValue;

/** Erreur de validation, avec la liste des problèmes à présenter à l'administrateur. */
export class PackageValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues[0] ?? 'Paquet invalide.');
  }
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Vérifie la définition du jeu selon son module. Un jeu de questions ne peut référencer que des
 * vidéos YouTube : les fichiers de la médiathèque n'existent pas dans un paquet.
 */
function checkDefinition(
  module: PackageModule,
  raw: unknown,
  entry: string,
): { issues: string[]; value?: DefinitionValue } {
  const at = (path: (string | number)[], message: string) => `${entry} (${path.join('.') || 'racine'}) : ${message}`;
  const fromZod = (error: z.ZodError) => error.issues.map((i) => at(i.path, i.message));
  switch (module) {
    case 'cards': {
      const parsed = cardGameDefinitionSchema.safeParse(raw);
      if (!parsed.success) return { issues: fromZod(parsed.error) };
      if (parsed.data.back?.imageAssetId || parsed.data.fontAssetId) {
        return {
          issues: [
            `${entry} (back.imageAssetId, fontAssetId) : un paquet ne peut pas utiliser une ressource de la médiathèque (image du dos ou police).`,
          ],
        };
      }
      return { issues: [], value: { module: 'cards', definition: parsed.data } };
    }
    case 'board': {
      const parsed = boardGameDefinitionSchema.safeParse(raw);
      if (!parsed.success) return { issues: fromZod(parsed.error) };
      return { issues: [], value: { module: 'board', definition: parsed.data } };
    }
    case 'quiz': {
      const parsed = mediaQuizDefinitionSchema.safeParse(raw);
      if (!parsed.success) return { issues: fromZod(parsed.error) };
      const issues = parsed.data.items.flatMap((item, i) =>
        item.source.type === 'asset'
          ? [
              at(
                ['items', i, 'source'],
                'un paquet ne peut pas utiliser un fichier de la médiathèque : utilisez un lien YouTube.',
              ),
            ]
          : [],
      );
      if (issues.length > 0) return { issues };
      return { issues: [], value: { module: 'quiz', definition: parsed.data } };
    }
  }
}

/**
 * Valide un paquet complet : archive, chemins, manifeste, empreintes, compatibilité du moteur,
 * licences, images et définition du jeu. Toute anomalie est collectée et rapportée.
 */
export function validatePackage(bytes: Uint8Array, limits: PackageLimits = DEFAULT_PACKAGE_LIMITS): ValidatedPackage {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new PackageValidationError([
      `Paquet trop volumineux (maximum ${Math.round(limits.maxArchiveBytes / (1024 * 1024))} Mio).`,
    ]);
  }
  const zipLimits: ZipReadLimits = {
    maxEntries: limits.maxEntries,
    maxEntryBytes: limits.maxEntryBytes,
    maxTotalBytes: limits.maxTotalBytes,
    maxRatio: limits.maxRatio,
    ratioCheckBytes: limits.ratioCheckBytes,
  };
  let entries: ZipFileEntry[];
  try {
    entries = readZip(bytes, zipLimits, (name) => {
      const problem = pathProblem(name, limits);
      if (problem) throw new ZipError(`« ${name} » : ${problem}.`);
    });
  } catch (err) {
    if (err instanceof ZipError) throw new PackageValidationError([err.message]);
    throw err;
  }

  const files = new Map(entries.map((e) => [e.name, e.data] as const));
  const issues: string[] = [];

  const rawManifest = files.get('manifest.json');
  if (!rawManifest) throw new PackageValidationError(['manifest.json est absent à la racine du paquet.']);
  if (rawManifest.byteLength > limits.maxManifestBytes) {
    throw new PackageValidationError(['manifest.json est trop volumineux.']);
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawManifest));
  } catch {
    throw new PackageValidationError(['manifest.json n’est pas un JSON valide.']);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new PackageValidationError(
      parsed.error.issues.map((i) => `manifest.json (${i.path.join('.') || 'racine'}) : ${i.message}`),
    );
  }
  const manifest = parsed.data;
  const module = manifest.requires.modules[0]!;

  // Compatibilité du moteur.
  if (compareVersions(manifest.engine.minVersion, PARTYHUB_ENGINE.version) > 0) {
    issues.push(
      `Ce paquet demande PartyHub ${manifest.engine.minVersion} au minimum ; cette installation est en ${PARTYHUB_ENGINE.version}.`,
    );
  }
  for (const m of manifest.requires.modules) {
    if (!(PARTYHUB_ENGINE.modules as readonly string[]).includes(m)) issues.push(`Module « ${m} » non disponible.`);
  }
  if (manifest.formatVersion === 1 && module !== 'cards') {
    issues.push(`Le format 1 ne porte que des jeux de cartes : le module « ${module} » demande le format 2.`);
  }

  // Fichiers déclarés : présents, sans doublon, de la bonne taille et de la bonne empreinte.
  const declared = new Map<string, (typeof manifest.files)[number]>();
  for (const f of manifest.files) {
    if (declared.has(f.path)) issues.push(`« ${f.path} » est déclaré deux fois.`);
    declared.set(f.path, f);
    const problem = pathProblem(f.path, limits);
    if (problem) issues.push(`« ${f.path} » : ${problem}.`);
    if (f.path === 'manifest.json') issues.push('manifest.json ne doit pas se déclarer lui-même.');
  }
  for (const name of files.keys()) {
    if (name === 'manifest.json') continue;
    const entry = declared.get(name);
    if (!entry) {
      issues.push(`« ${name} » est présent dans l’archive sans être déclaré dans le manifeste.`);
      continue;
    }
    const data = files.get(name)!;
    if (data.byteLength !== entry.size) issues.push(`« ${name} » : taille différente de celle du manifeste.`);
    if (sha256Hex(data) !== entry.sha256) issues.push(`« ${name} » : empreinte SHA-256 incorrecte.`);
  }
  for (const path of declared.keys()) {
    if (!files.has(path)) issues.push(`« ${path} » est déclaré mais absent de l’archive.`);
  }
  if (!declared.has(manifest.entry)) issues.push(`Le fichier d’entrée « ${manifest.entry} » n’est pas déclaré.`);

  // Licences : chaque ressource doit être couverte par une licence ou une attribution.
  const licensePaths = new Set(manifest.licenses.map((l) => l.path));
  for (const license of manifest.licenses) {
    if (!license.path.startsWith('licenses/') || !declared.has(license.path)) {
      issues.push(`Licence « ${license.path} » : fichier absent ou hors du dossier licenses/.`);
    }
    for (const covered of license.covers) {
      if (!declared.has(covered)) issues.push(`Licence : ressource « ${covered} » inconnue.`);
    }
  }
  for (const name of files.keys()) {
    if (name.startsWith('assets/') && !manifest.licenses.some((l) => l.covers.includes(name))) {
      issues.push(`« ${name} » n’est couverte par aucune licence ni attribution.`);
    }
  }
  if (![...files.keys()].some((n) => n.startsWith('licenses/'))) {
    issues.push('Le dossier licenses/ doit contenir au moins un fichier.');
  }
  if (licensePaths.size === 0) issues.push('Aucune licence déclarée.');

  // Ressources : images valides, couverture déclarée dans assets/.
  for (const name of files.keys()) {
    if (!name.startsWith('assets/')) continue;
    const dot = name.lastIndexOf('.');
    const problem = imageProblem(files.get(name)!, name.slice(dot).toLowerCase(), limits);
    if (problem) issues.push(`« ${name} » : ${problem}.`);
  }
  if (manifest.cover !== undefined && !(manifest.cover.startsWith('assets/') && declared.has(manifest.cover))) {
    issues.push('La couverture doit être un fichier déclaré dans assets/.');
  }

  // Définition du jeu, selon son module.
  let definition: DefinitionValue | null = null;
  const rawDefinition = files.get(manifest.entry);
  if (rawDefinition) {
    if (rawDefinition.byteLength > limits.maxJsonBytes) {
      issues.push(`« ${manifest.entry} » est trop volumineux.`);
    } else {
      let data: unknown;
      let readable = false;
      try {
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawDefinition));
        readable = true;
      } catch {
        issues.push(`${manifest.entry} n’est pas un JSON valide.`);
      }
      if (readable) {
        const checked = checkDefinition(module, data, manifest.entry);
        issues.push(...checked.issues);
        definition = checked.value ?? null;
      }
    }
  }

  if (issues.length > 0 || !definition) {
    throw new PackageValidationError(issues.length > 0 ? issues : ['Définition du jeu illisible.']);
  }
  return { manifest, files, sha256: sha256Hex(bytes), size: bytes.byteLength, ...definition };
}
