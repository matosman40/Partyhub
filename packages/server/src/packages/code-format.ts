import { createHash, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { PARTYHUB_ENGINE } from './engine.js';
import { compareVersions } from './semver.js';
import {
  DEFAULT_PACKAGE_LIMITS,
  PackageValidationError,
  audioProblem,
  imageProblem,
  isAudioPath,
  pathProblem,
  type PackageLimits,
} from './format.js';
import { isValidVersion } from './semver.js';
import { readZip, ZipError, type ZipFileEntry, type ZipReadLimits } from './zip.js';

/**
 * Format 5 : jeu de code (module « code »). Le paquet porte le code compilé du jeu, côté serveur et côté
 * écran, et une signature Ed25519 du manifeste. Voir claude/format-jeux-code.md.
 *
 * Ce module ne fait que valider. Il n'exécute rien : la voie d'installation refuse encore ces paquets
 * (CODE_NOT_INSTALLABLE dans format.ts).
 */
export const CODE_FORMAT_VERSION = 5;
export const CODE_ENTRY_SERVER = 'code/server.js';
export const CODE_ENTRY_CLIENT = 'code/client.js';
export const CODE_SIGNATURE_ALG = 'ed25519';

/** Dossiers d'un paquet de code. Pas de « game/ » ni de « data/ » : la définition est le code lui-même. */
const CODE_TOP_DIRS: Record<string, readonly string[]> = {
  code: ['.js'],
  assets: ['.png', '.jpg', '.jpeg', '.webp', '.ogg', '.mp3'],
  licenses: ['.txt', '.md'],
};

const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;

const codeManifestBase = z.object({
  format: z.literal('phgame'),
  formatVersion: z.literal(CODE_FORMAT_VERSION),
  kind: z.literal('code'),
  id: z.string().regex(ID, 'Identifiant : minuscules, chiffres et tirets (2 à 48 caractères).'),
  name: z.string().trim().min(2).max(40),
  version: z.string().max(64).refine(isValidVersion, 'Version attendue au format X.Y.Z.'),
  description: z.string().trim().min(1).max(160),
  author: z.string().trim().min(1).max(80),
  engine: z.object({
    minVersion: z.string().refine(isValidVersion, 'Version minimale du moteur invalide.'),
    api: z.literal(PARTYHUB_ENGINE.api),
  }),
  entry: z
    .object({
      server: z.literal(CODE_ENTRY_SERVER),
      client: z.literal(CODE_ENTRY_CLIENT),
    })
    .strict(),
  cover: z.string().optional(),
  licenses: z
    .array(
      z
        .object({
          path: z.string(),
          covers: z.array(z.string()).max(200),
        })
        .strict(),
    )
    .min(1, 'Au moins une licence ou attribution est requise.'),
});

/** Manifeste écrit par l'auteur, avant construction : sans liste de fichiers ni signature. */
export const codeSourceManifestSchema = codeManifestBase.strict();

/** Manifeste d'un paquet construit : liste des fichiers et signature (facultative pour la seule validation). */
export const codeManifestSchema = codeManifestBase
  .extend({
    files: z.array(
      z
        .object({
          path: z.string(),
          size: z.number().int().min(0),
          sha256: z.string().regex(SHA256, 'Empreinte SHA-256 attendue (64 caractères hexadécimaux).'),
        })
        .strict(),
    ),
    signature: z
      .object({
        alg: z.literal(CODE_SIGNATURE_ALG),
        keyId: z.string().regex(KEY_ID, 'Identifiant de clé attendu (16 caractères hexadécimaux).'),
        value: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CodeManifest = z.infer<typeof codeManifestSchema>;

/** Sérialisation canonique : clés triées, sans espaces. Une même donnée donne toujours les mêmes octets. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${parts.join(',')}}`;
}

/** Le manifeste signé est le manifeste sans sa signature : il contient déjà l'empreinte de chaque fichier. */
function signedBytes(manifest: Record<string, unknown>): Buffer {
  const unsigned = { ...manifest };
  delete unsigned.signature;
  return Buffer.from(canonicalJson(unsigned), 'utf8');
}

/** Identifiant de clé : 16 premiers caractères hexadécimaux de l'empreinte de la clé publique. */
export function keyIdOf(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/** Paire de clés Ed25519 au format PEM, avec son identifiant. */
export function generateSigningKeys(): { privatePem: string; publicPem: string; keyId: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: keyIdOf(publicKey),
  };
}

/** Signe un manifeste sans signature. Retourne le bloc « signature » à ajouter. */
export function signManifest(
  unsigned: Record<string, unknown>,
  privateKey: KeyObject,
): { alg: typeof CODE_SIGNATURE_ALG; keyId: string; value: string } {
  return {
    alg: CODE_SIGNATURE_ALG,
    keyId: keyIdOf(createPublicKey(privateKey)),
    value: sign(null, signedBytes(unsigned), privateKey).toString('base64'),
  };
}

export interface CodePackageOptions {
  limits?: PackageLimits;
  /** Clés publiques de confiance, par identifiant de clé. */
  trustedKeys?: ReadonlyMap<string, KeyObject>;
  /** Vrai : un paquet non signé, ou signé par une clé inconnue, est refusé. */
  requireSignature?: boolean;
  /**
   * Vrai : une signature dont la clé n'est pas connue n'est pas refusée, seulement signalée comme non vérifiée
   * (contrôle de structure sur le poste du développeur, sans clé publique).
   */
  allowUnverifiedSignature?: boolean;
}

export interface ValidatedCodePackage {
  manifest: CodeManifest;
  files: Map<string, Uint8Array>;
  sha256: string;
  size: number;
  /** Identifiant de la clé qui a signé le paquet, après vérification. Null si la signature n'est pas vérifiée. */
  signer: string | null;
  /** Identifiant de la clé annoncée par le manifeste, vérifiée ou non. Null si le paquet n'est pas signé. */
  claimedKeyId: string | null;
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Valide un paquet de code : archive, chemins, manifeste, empreintes, licences, images et sons, bloc de code.
 * La signature est vérifiée contre les clés de confiance. Rien n'est exécuté.
 */
export function validateCodePackage(bytes: Uint8Array, options: CodePackageOptions = {}): ValidatedCodePackage {
  const limits = options.limits ?? DEFAULT_PACKAGE_LIMITS;
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
      const problem = pathProblem(name, limits, CODE_TOP_DIRS);
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
  const parsed = codeManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new PackageValidationError(
      parsed.error.issues.map((i) => `manifest.json (${i.path.join('.') || 'racine'}) : ${i.message}`),
    );
  }
  const manifest = parsed.data;
  const raw = json as Record<string, unknown>;
  // Un paquet ne s'installe que sur un moteur au moins aussi récent que celui qu'il demande.
  if (compareVersions(manifest.engine.minVersion, PARTYHUB_ENGINE.version) > 0) {
    issues.push(
      `Ce paquet demande PartyHub ${manifest.engine.minVersion} au minimum ; cette installation est en ${PARTYHUB_ENGINE.version}.`,
    );
  }

  // Signature : couvre le manifeste entier, donc toutes les empreintes des fichiers.
  let signer: string | null = null;
  const claimedKeyId = manifest.signature?.keyId ?? null;
  if (manifest.signature) {
    const key = options.trustedKeys?.get(manifest.signature.keyId);
    if (!key) {
      if (!options.allowUnverifiedSignature)
        issues.push(`Paquet signé par une clé inconnue (${manifest.signature.keyId}).`);
    } else if (verify(null, signedBytes(raw), key, Buffer.from(manifest.signature.value, 'base64'))) {
      signer = manifest.signature.keyId;
    } else {
      issues.push('Signature invalide : le manifeste a été modifié, ou la clé ne correspond pas.');
    }
  } else if (options.requireSignature) {
    issues.push('Paquet non signé.');
  }

  // Fichiers déclarés : présents, sans doublon, de la bonne taille et de la bonne empreinte.
  const declared = new Map<string, CodeManifest['files'][number]>();
  for (const f of manifest.files) {
    if (declared.has(f.path)) issues.push(`« ${f.path} » est déclaré deux fois.`);
    declared.set(f.path, f);
    const problem = pathProblem(f.path, limits, CODE_TOP_DIRS);
    if (problem) issues.push(`« ${f.path} » : ${problem}.`);
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

  // Code : serveur et écran doivent être déclarés, présents, et du texte UTF-8 non vide.
  for (const entryName of [manifest.entry.server, manifest.entry.client]) {
    const data = files.get(entryName);
    if (!declared.has(entryName) || !data) {
      issues.push(`Le fichier de code « ${entryName} » est absent ou non déclaré.`);
      continue;
    }
    if (data.byteLength === 0) issues.push(`« ${entryName} » est vide.`);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      issues.push(`« ${entryName} » n’est pas du texte UTF-8.`);
    }
  }

  // Licences : chaque ressource doit être couverte par une licence ou une attribution.
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

  // Ressources : images et sons, avec les mêmes contrôles que les paquets déclaratifs.
  for (const name of files.keys()) {
    if (!name.startsWith('assets/')) continue;
    const dot = name.lastIndexOf('.');
    const ext = name.slice(dot).toLowerCase();
    const data = files.get(name)!;
    if (isAudioPath(name)) {
      if (data.byteLength > limits.maxAudioBytes) {
        issues.push(`« ${name} » : fichier audio trop lourd (maximum ${Math.round(limits.maxAudioBytes / 1024)} Ko).`);
      }
      const problem = audioProblem(data, ext);
      if (problem) issues.push(`« ${name} » : ${problem}.`);
      continue;
    }
    if (data.byteLength > limits.maxImageBytes) {
      issues.push(`« ${name} » : image trop lourde (maximum ${Math.round(limits.maxImageBytes / 1024)} Ko).`);
    }
    const problem = imageProblem(data, ext, limits);
    if (problem) issues.push(`« ${name} » : ${problem}.`);
  }
  if (manifest.cover !== undefined && !(manifest.cover.startsWith('assets/') && declared.has(manifest.cover))) {
    issues.push('La couverture doit être une image déclarée dans assets/.');
  }

  if (issues.length > 0) throw new PackageValidationError(issues);
  return { manifest, files, sha256: sha256Hex(bytes), size: bytes.byteLength, signer, claimedKeyId };
}
