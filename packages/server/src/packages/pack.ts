import { createHash } from 'node:crypto';
import { DEFAULT_PACKAGE_LIMITS, pathProblem, validatePackage, type ValidatedPackage } from './format.js';
import { writeZip, type ZipFileEntry } from './zip.js';

/**
 * Construit un paquet déclaratif (cartes, plateau, questions, recettes) à partir de son manifeste et de ses fichiers.
 * Les empreintes de chaque fichier sont écrites dans le manifeste, puis le paquet passe les mêmes contrôles que ceux
 * de l’administration (validatePackage). Utilisé par `phgame pack` et par le magasin, qui construit les paquets à
 * partir des sources d’un tag.
 */
export function packDeclarative(
  manifest: Record<string, unknown>,
  entries: ZipFileEntry[],
): { bytes: Uint8Array; checked: ValidatedPackage } {
  for (const entry of entries) {
    const problem = pathProblem(entry.name, DEFAULT_PACKAGE_LIMITS);
    if (problem) throw new Error(`« ${entry.name} » : ${problem}.`);
  }
  const files = entries.map((entry) => ({
    path: entry.name,
    size: entry.data.byteLength,
    sha256: createHash('sha256').update(entry.data).digest('hex'),
  }));
  const bytes = writeZip([
    { name: 'manifest.json', data: Buffer.from(`${JSON.stringify({ ...manifest, files }, null, 2)}\n`, 'utf8') },
    ...entries,
  ]);
  return { bytes, checked: validatePackage(bytes) };
}
