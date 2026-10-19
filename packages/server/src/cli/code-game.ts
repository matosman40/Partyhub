import { build, transform } from 'esbuild';
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_SERVER_GLOBAL, CODE_VIEW_GLOBAL, CodeGameRuntime, createCodeModule } from '../packages/code-runtime.js';
import { launchCheck } from '../packages/launch-check.js';
import {
  CODE_ENTRY_CLIENT,
  CODE_ENTRY_SERVER,
  codeSourceManifestSchema,
  generateSigningKeys,
  keyIdOf,
  signManifest,
  validateCodePackage,
  type CodeManifest,
} from '../packages/code-format.js';
import { PackageValidationError, peekPackageKind } from '../packages/format.js';
import { writeZip, type ZipFileEntry } from '../packages/zip.js';
import { viewEntrySource } from '../code-games/view-entry.js';
import { listFiles } from './list-files.js';

/**
 * Outils des jeux de code : création depuis le modèle, construction (esbuild), signature et contrôle.
 * Ces outils tournent sur le poste du développeur, ou dans l'image Docker de développement.
 * Le contrôle exécute le code du jeu : il ne doit jamais tourner sur le serveur de production.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Dossier node_modules de la racine du dépôt, pour résoudre @partyhub/shared et React. */
const REPO_NODE_MODULES = path.resolve(HERE, '../../../../node_modules');
const TEMPLATE_DIR = path.resolve(HERE, '../../templates/code-game');

const ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** Texte inséré dans les modèles : sans guillemets ni antislash, pour ne jamais casser un fichier généré. */
const SAFE_TEXT = /^[^'"\\`$\n\r]+$/;

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((i) => `manifest.json (${i.path.map(String).join('.') || 'racine'}) : ${i.message}`);
}

/**
 * Construit un script autonome (format iife) : le module exporté est rangé dans la variable globale `globalName`.
 * Pas de plateforme Node : le code du jeu ne doit importer aucun module système.
 */
async function bundle(
  globalName: string,
  input: { entry: string } | { source: string; resolveDir: string },
): Promise<Buffer> {
  if ('entry' in input && !fs.existsSync(input.entry)) {
    throw new PackageValidationError([`Fichier source absent : ${path.basename(input.entry)}.`]);
  }
  const entry =
    'entry' in input
      ? { entryPoints: [input.entry] }
      : {
          stdin: {
            contents: input.source,
            resolveDir: input.resolveDir,
            sourcefile: 'partyhub-view.ts',
            loader: 'ts' as const,
          },
        };
  const result = await build({
    ...entry,
    bundle: true,
    format: 'iife',
    globalName,
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    write: false,
    nodePaths: [REPO_NODE_MODULES],
    logLevel: 'silent',
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return Buffer.from(result.outputFiles[0]!.contents);
}

/**
 * Construit un jeu de code : compile src/server.ts et src/client.tsx, copie assets/ et licenses/,
 * écrit le manifeste avec les empreintes, signe si une clé privée est donnée, puis revalide le résultat.
 */
export async function packCode(sourceDir: string, outFile: string, keyFile?: string): Promise<CodeManifest> {
  const source = codeSourceManifestSchema.safeParse(
    JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8')),
  );
  if (!source.success) throw new PackageValidationError(issuesOf(source.error));

  const server = await bundle(CODE_SERVER_GLOBAL, { entry: path.join(sourceDir, 'src', 'server.ts') });
  // Les vues sont rendues par une amorce générée (incluse dans le paquet) qui importe src/client.tsx.
  const client = await bundle(CODE_VIEW_GLOBAL, {
    source: viewEntrySource(),
    resolveDir: path.join(sourceDir, 'src'),
  });
  // Le module doit annoncer le même identifiant, nom et version que manifest.json : vérifié dès la construction.
  const runtime = new CodeGameRuntime(server.toString('utf8'));
  try {
    const declared = createCodeModule(runtime).manifest;
    const { id, name, version } = source.data;
    if (declared.id !== id || declared.name !== name || declared.version !== version) {
      throw new PackageValidationError([
        `src/server.ts : le manifeste du module (${declared.id} ${declared.version}) ne correspond pas à manifest.json (${id} ${version}). Mettez les deux à jour ensemble.`,
      ]);
    }
  } finally {
    runtime.dispose();
  }
  const copied = listFiles(sourceDir).filter((n) => n.startsWith('assets/') || n.startsWith('licenses/'));
  const entries: ZipFileEntry[] = [
    { name: CODE_ENTRY_SERVER, data: server },
    { name: CODE_ENTRY_CLIENT, data: client },
    ...copied.map((name) => ({ name, data: fs.readFileSync(path.join(sourceDir, name)) })),
  ];
  const files = entries.map((e) => ({ path: e.name, size: e.data.byteLength, sha256: sha256(e.data) }));
  const unsigned: Record<string, unknown> = { ...source.data, files };

  let manifest: Record<string, unknown> = unsigned;
  let trusted: Map<string, KeyObject> | undefined;
  if (keyFile) {
    const privateKey = createPrivateKey(fs.readFileSync(keyFile, 'utf8'));
    const publicKey = createPublicKey(privateKey);
    manifest = { ...unsigned, signature: signManifest(unsigned, privateKey) };
    trusted = new Map([[keyIdOf(publicKey), publicKey]]);
  }

  const archive = writeZip([
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    ...entries,
  ]);
  const checked = validateCodePackage(archive, { trustedKeys: trusted, requireSignature: Boolean(keyFile) });
  fs.writeFileSync(outFile, archive);
  return checked.manifest;
}

/** Vrai pour un paquet de code, selon le champ « kind » de son manifeste. */
export function isCodePackage(bytes: Uint8Array): boolean {
  return peekPackageKind(bytes) === 'code';
}

export interface CodeCheckReport {
  ok: boolean;
  lines: string[];
}

/**
 * Contrôle un paquet de code : structure, signature (si une clé publique est donnée), syntaxe des bundles,
 * puis une partie complète jouée par des robots. Exécute le code du jeu, sur le poste du développeur.
 */
export async function checkCode(file: string, publicKeyFile?: string): Promise<CodeCheckReport> {
  const bytes = fs.readFileSync(file);
  const publicKey = publicKeyFile ? createPublicKey(fs.readFileSync(publicKeyFile, 'utf8')) : undefined;
  const trusted = publicKey ? new Map([[keyIdOf(publicKey), publicKey]]) : undefined;
  const pkg = validateCodePackage(bytes, {
    trustedKeys: trusted,
    requireSignature: Boolean(publicKey),
    allowUnverifiedSignature: !publicKey,
  });

  const lines = [`Paquet valide : ${pkg.manifest.name} (${pkg.manifest.id}) version ${pkg.manifest.version}`];
  if (pkg.signer) lines.push(`  signé par la clé ${pkg.signer}, vérifiée`);
  else if (pkg.claimedKeyId)
    lines.push(`  signé par la clé ${pkg.claimedKeyId}, non vérifiée (donnez la clé publique)`);
  else lines.push('  non signé : contrôle de structure seulement');

  for (const name of [CODE_ENTRY_SERVER, CODE_ENTRY_CLIENT]) {
    // Analyse seule : une erreur de syntaxe est signalée sans rien exécuter.
    await transform(Buffer.from(pkg.files.get(name)!).toString('utf8'), { loader: 'js', format: 'iife' });
  }

  // Le contrôle passe par le même isolat que la production : ce qui est testé est ce qui tournera.
  const runtime = new CodeGameRuntime(Buffer.from(pkg.files.get(CODE_ENTRY_SERVER)!).toString('utf8'));
  try {
    const mod = createCodeModule(runtime);
    const { id, name, version } = pkg.manifest;
    if (mod.manifest.id !== id || mod.manifest.name !== name || mod.manifest.version !== version) {
      throw new Error('Le module de jeu ne correspond pas au manifeste (identifiant, nom ou version).');
    }

    const result = launchCheck(mod);
    if (!result.ok) {
      lines.push(`Lancement de contrôle échoué : ${result.error}.`);
      return { ok: false, lines };
    }
    lines.push(`Lancement de contrôle : 2 parties jouées par des robots, ${result.actions} actions.`);
    return { ok: true, lines };
  } finally {
    runtime.dispose();
  }
}

/** Crée un dossier de jeu de code à partir du modèle. Le dossier doit être absent ou vide. */
export function newCodeGame(targetDir: string, values: { id: string; name: string; author: string }): string[] {
  if (!ID.test(values.id)) throw new Error('Identifiant : minuscules, chiffres et tirets (2 à 48 caractères).');
  if (values.name.trim().length < 2 || values.name.length > 40) throw new Error('Nom : 2 à 40 caractères.');
  if (values.author.trim().length < 1 || values.author.length > 80) throw new Error('Auteur : 1 à 80 caractères.');
  for (const text of [values.name, values.author]) {
    if (!SAFE_TEXT.test(text))
      throw new Error('Nom et auteur : sans guillemets, apostrophes, antislash ni retour à la ligne.');
  }
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(`Le dossier « ${targetDir} » existe déjà et n’est pas vide.`);
  }
  const written: string[] = [];
  for (const rel of listFiles(TEMPLATE_DIR)) {
    const text = fs
      .readFileSync(path.join(TEMPLATE_DIR, rel), 'utf8')
      .replaceAll('{{id}}', values.id)
      .replaceAll('{{name}}', values.name)
      .replaceAll('{{author}}', values.author);
    const out = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    written.push(rel);
  }
  return written;
}

/** Crée une paire de clés de signature : <préfixe>.key.pem (privée, lecture seule) et <préfixe>.pub.pem. */
export function keygen(prefix: string): string {
  const privatePath = `${prefix}.key.pem`;
  const publicPath = `${prefix}.pub.pem`;
  if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) {
    throw new Error(`Des clés existent déjà sous « ${prefix} ».`);
  }
  const keys = generateSigningKeys();
  fs.writeFileSync(privatePath, keys.privatePem, { mode: 0o600 });
  fs.writeFileSync(publicPath, keys.publicPem);
  return keys.keyId;
}
