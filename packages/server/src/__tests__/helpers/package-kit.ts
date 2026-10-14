import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../../packages/zip.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Dossier source du paquet d'exemple livré dans le dépôt. */
export const EXAMPLE_DIR = path.resolve(here, '../../../../../examples/exemple-cartes');

export const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
export const sha = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

export function exampleDefinition(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(EXAMPLE_DIR, 'game/definition.json'), 'utf8')) as Record<string, unknown>;
}

/** PNG minimal : signature et en-tête IHDR, suffisants pour le contrôle des dimensions. */
export function tinyPng(width: number, height: number): Uint8Array {
  const data = new Uint8Array(24);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(data.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return data;
}

export interface PackageOptions {
  id?: string;
  version?: string;
  definition?: unknown;
  /** Fichiers supplémentaires, déclarés dans le manifeste sauf ceux listés dans `undeclared`. */
  files?: Record<string, Uint8Array>;
  undeclared?: string[];
  /** Modification du manifeste avant écriture (pour fabriquer des cas invalides). */
  manifest?: (manifest: Record<string, any>) => void;
}

/** Construit une archive .phgame en mémoire, à partir d'un jeu de cartes valide par défaut. */
export function buildPackage(options: PackageOptions = {}): Uint8Array {
  const contents: Record<string, Uint8Array> = {
    'game/definition.json': enc(JSON.stringify(options.definition ?? exampleDefinition())),
    'licenses/LICENCE.txt': enc('Licence de test.'),
    ...(options.files ?? {}),
  };
  const undeclared = new Set(options.undeclared ?? []);
  const manifest: Record<string, any> = {
    format: 'phgame',
    formatVersion: 1,
    id: options.id ?? 'exemple-cartes',
    name: 'Exemple de jeu de cartes',
    version: options.version ?? '1.0.0',
    description: 'Paquet de test.',
    author: 'Tests',
    kind: 'declarative',
    engine: { minVersion: '0.5.0', api: 1 },
    requires: { modules: ['cards'] },
    entry: 'game/definition.json',
    licenses: [{ path: 'licenses/LICENCE.txt', covers: [] }],
    files: Object.entries(contents)
      .filter(([name]) => !undeclared.has(name))
      .map(([name, data]) => ({ path: name, size: data.byteLength, sha256: sha(data) })),
  };
  options.manifest?.(manifest);
  return writeZip([
    { name: 'manifest.json', data: enc(JSON.stringify(manifest)) },
    ...Object.entries(contents).map(([name, data]) => ({ name, data })),
  ]);
}

/** Dossier source d'un exemple du dépôt, par son nom (exemple-plateau, exemple-quiz…). */
export const examplePath = (name: string): string => path.resolve(here, '../../../../../examples', name);

/** Définition JSON d'un exemple du dépôt. */
export function readExampleDefinition(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(examplePath(name), 'game/definition.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** Archive .phgame construite à partir d'un dossier d'exemple, comme `phgame pack`. */
export function packExample(name: string): Uint8Array {
  const root = examplePath(name);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const entries = ['game/definition.json', 'licenses/LICENCE.txt'].map((file) => ({
    name: file,
    data: new Uint8Array(fs.readFileSync(path.join(root, file))),
  }));
  manifest.files = entries.map((e) => ({ path: e.name, size: e.data.byteLength, sha256: sha(e.data) }));
  return writeZip([{ name: 'manifest.json', data: enc(JSON.stringify(manifest)) }, ...entries]);
}
