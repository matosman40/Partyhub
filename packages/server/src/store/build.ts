import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCodePackage } from '../code-games/build.js';
import { PackageValidationError } from '../packages/format.js';
import { packDeclarative } from '../packages/pack.js';

/**
 * Paquet d’un jeu du magasin, construit à partir des fichiers de son dossier `jeux/<jeu>/` au tag installé. Le
 * paquet n’est jamais lu depuis une release : il est fait ici, avec les mêmes contrôles que `phgame pack`.
 *
 * Un jeu déclaratif devient un paquet comme celui de la commande. Un jeu de code est compilé et laissé sans
 * signature : aucune clé n’est utilisée. Il reste en attente de revue, et ne s’exécute qu’après approbation.
 */
export async function buildTagPackage(gameId: string, files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const raw = files.get('manifest.json');
  if (!raw) throw new PackageValidationError(['manifest.json est absent du dossier du jeu.']);
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as Record<string, unknown>;
  } catch {
    throw new PackageValidationError(['manifest.json n’est pas un JSON valide.']);
  }
  if (manifest.kind === 'code') return buildUnsignedCode(gameId, files);
  const entries = [...files].filter(([name]) => name !== 'manifest.json').map(([name, data]) => ({ name, data }));
  try {
    return packDeclarative(manifest, entries).bytes;
  } catch (err) {
    if (err instanceof PackageValidationError) throw err;
    throw new PackageValidationError([err instanceof Error ? err.message : 'Paquet illisible.']);
  }
}

/** Compile un jeu de code dans un dossier provisoire (esbuild lit des fichiers), puis le supprime. */
async function buildUnsignedCode(gameId: string, files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `partyhub-${gameId}-`));
  try {
    for (const [name, data] of files) {
      const target = path.join(dir, name);
      // Les noms sont déjà contrôlés à la lecture du tag : cette garde ne sert qu’à ne jamais écrire hors du dossier.
      if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) {
        throw new PackageValidationError([`« ${name} » : chemin refusé.`]);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    const built = await buildCodePackage(dir);
    return built.bytes;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
