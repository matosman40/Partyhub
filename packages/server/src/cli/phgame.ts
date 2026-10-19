#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createPackageGame } from '../packages/factory.js';
import { launchCheck } from '../packages/launch-check.js';
import { DEFAULT_PACKAGE_LIMITS, PackageValidationError, pathProblem, validatePackage } from '../packages/format.js';
import { writeZip, type ZipFileEntry } from '../packages/zip.js';
import { checkCode, isCodePackage, keygen, newCodeGame, packCode } from './code-game.js';
import { listFiles } from './list-files.js';

const USAGE = `Usage :
  phgame pack <dossier-source> <fichier.phgame> [clé-privée.pem]
      Construit un paquet. Un jeu de code est compilé puis signé si une clé privée est donnée.
  phgame check <fichier.phgame> [clé-publique.pem]
      Vérifie un paquet et lance une partie de contrôle avec des robots. Vérifie la signature si une clé publique est donnée.
  phgame new <dossier> <identifiant> "<nom>" "<auteur>"
      Crée un jeu de code à partir du modèle (dossier absent ou vide).
  phgame keygen <préfixe>
      Crée une paire de clés de signature : <préfixe>.key.pem (à garder secrète) et <préfixe>.pub.pem.`;

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Construit un paquet déclaratif (cartes, plateau, questions, recettes). */
function pack(source: string, output: string): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const names = listFiles(source).filter((name) => name !== 'manifest.json');
  for (const name of names) {
    const problem = pathProblem(name, DEFAULT_PACKAGE_LIMITS);
    if (problem) throw new Error(`« ${name} » : ${problem}.`);
  }
  const entries: ZipFileEntry[] = names.map((name) => ({ name, data: fs.readFileSync(path.join(source, name)) }));
  const files = entries.map((entry) => ({ path: entry.name, size: entry.data.byteLength, sha256: sha256(entry.data) }));
  const finalManifest = { ...manifest, files };
  const archive = writeZip([
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8') },
    ...entries,
  ]);
  // Le paquet produit doit passer exactement les mêmes contrôles que ceux de l’administration.
  const checked = validatePackage(archive);
  fs.writeFileSync(output, archive);
  console.log(`Paquet créé : ${output}`);
  console.log(`  ${checked.manifest.name} (${checked.manifest.id}) version ${checked.manifest.version}`);
  console.log(`  ${checked.manifest.files.length} fichiers, ${checked.size} octets, SHA-256 ${sha256(archive)}`);
}

/** Contrôle un paquet déclaratif et lance une partie de contrôle. */
function checkDeclarative(file: string): void {
  const pkg = validatePackage(fs.readFileSync(file));
  console.log(`Paquet valide : ${pkg.manifest.name} (${pkg.manifest.id}) version ${pkg.manifest.version}`);
  console.log(
    `  moteur minimum ${pkg.manifest.engine.minVersion}, API ${pkg.manifest.engine.api}, module ${pkg.module}`,
  );
  const result = launchCheck(createPackageGame(pkg));
  if (!result.ok) {
    console.error(`Lancement de contrôle échoué : ${result.error}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Lancement de contrôle : 2 parties jouées par des robots, ${result.actions} actions.`);
}

async function check(file: string, publicKey?: string): Promise<void> {
  if (isCodePackage(fs.readFileSync(file))) {
    const report = await checkCode(file, publicKey);
    for (const line of report.lines) console.log(line);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (publicKey) throw new Error('Une clé publique ne sert qu’à vérifier un jeu de code signé.');
  checkDeclarative(file);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'pack' && (args.length === 2 || args.length === 3)) {
    const [source, output, keyFile] = args as [string, string, string | undefined];
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8')) as { kind?: unknown };
    if (manifest.kind === 'code') {
      const built = await packCode(source, output, keyFile);
      console.log(`Jeu de code construit : ${output}`);
      console.log(`  ${built.name} (${built.id}) version ${built.version}`);
      console.log(keyFile ? '  signé.' : '  non signé : il ne pourra pas être installé sans signature.');
    } else {
      if (keyFile) throw new Error('Une clé privée ne sert qu’à signer un jeu de code.');
      pack(source, output);
    }
  } else if (command === 'check' && (args.length === 1 || args.length === 2)) {
    await check(args[0]!, args[1]);
  } else if (command === 'new' && args.length === 4) {
    const [dir, id, name, author] = args as [string, string, string, string];
    const written = newCodeGame(dir, { id, name, author });
    console.log(`Jeu créé dans ${dir} :`);
    for (const file of written) console.log(`  ${file}`);
    console.log(`Construire : phgame pack ${dir} ${id}.phgame [clé-privée.pem]`);
  } else if (command === 'keygen' && args.length === 1) {
    const keyId = keygen(args[0]!);
    console.log(`Clés créées : ${args[0]}.key.pem (privée) et ${args[0]}.pub.pem (publique).`);
    console.log(`Identifiant de clé : ${keyId}`);
  } else {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  if (err instanceof PackageValidationError) {
    console.error('Paquet refusé :');
    for (const issue of err.issues) console.error(`  - ${issue}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
}
