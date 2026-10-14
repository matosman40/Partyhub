#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PACKAGE_LIMITS, PackageValidationError, pathProblem, validatePackage } from '../packages/format.js';
import { createPackageGame } from '../packages/factory.js';
import { launchCheck } from '../packages/launch-check.js';
import { writeZip, type ZipFileEntry } from '../packages/zip.js';

const USAGE = `Usage :
  phgame pack <dossier-source> <fichier.phgame>   Construit un paquet : calcule tailles et empreintes, puis vérifie le résultat.
  phgame check <fichier.phgame>                    Vérifie un paquet et lance une partie de contrôle avec des robots.`;

/** Liste les fichiers d'un dossier, en chemins relatifs POSIX. Les liens symboliques sont refusés. */
function listFiles(root: string, dir = ''): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, rel));
    else if (entry.isFile()) out.push(rel);
    else throw new Error(`« ${rel} » n’est ni un fichier ni un dossier (lien symbolique refusé).`);
  }
  return out;
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

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
  // Le paquet produit doit passer exactement les mêmes contrôles que ceux de l'administration.
  const checked = validatePackage(archive);
  fs.writeFileSync(output, archive);
  console.log(`Paquet créé : ${output}`);
  console.log(`  ${checked.manifest.name} (${checked.manifest.id}) version ${checked.manifest.version}`);
  console.log(`  ${checked.manifest.files.length} fichiers, ${checked.size} octets, SHA-256 ${sha256(archive)}`);
}

function check(file: string): void {
  const pkg = validatePackage(fs.readFileSync(file));
  console.log(`Paquet valide : ${pkg.manifest.name} (${pkg.manifest.id}) version ${pkg.manifest.version}`);
  console.log(`  moteur minimum ${pkg.manifest.engine.minVersion}, API ${pkg.manifest.engine.api}, module ${pkg.module}`);
  const result = launchCheck(createPackageGame(pkg));
  if (!result.ok) {
    console.error(`Lancement de contrôle échoué : ${result.error}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Lancement de contrôle : 2 parties jouées par des robots, ${result.actions} actions.`);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'pack' && args.length === 2) {
    pack(args[0]!, args[1]!);
  } else if (command === 'check' && args.length === 1) {
    check(args[0]!);
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
