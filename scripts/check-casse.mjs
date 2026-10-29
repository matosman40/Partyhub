#!/usr/bin/env node
/**
 * Garde-fou de casse : échoue si deux fichiers .ts/.tsx d'un même dossier ne diffèrent que par la casse ou
 * l'extension (Capture.tsx et capture.ts, par exemple). Windows ne les distingue pas : la compilation casse.
 * Usage : node scripts/check-casse.mjs   (à la racine du dépôt)
 */
import { readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const IGNORES = new Set(['node_modules', 'dist', '.git', 'coverage']);
const conflits = [];

function parcourir(dossier) {
  const entrees = readdirSync(dossier, { withFileTypes: true });
  const groupes = new Map();
  for (const e of entrees) {
    if (e.isDirectory()) {
      if (!IGNORES.has(e.name)) parcourir(join(dossier, e.name));
      continue;
    }
    const ext = extname(e.name);
    if (ext !== '.ts' && ext !== '.tsx') continue;
    const cle = basename(e.name, ext).toLowerCase();
    groupes.set(cle, [...(groupes.get(cle) ?? []), e.name]);
  }
  for (const noms of groupes.values()) {
    if (noms.length > 1) conflits.push(`${dossier} : ${noms.join(', ')}`);
  }
}

parcourir('packages');
if (conflits.length > 0) {
  console.error('Fichiers .ts/.tsx qui ne diffèrent que par la casse ou l’extension :');
  for (const c of conflits) console.error(` - ${c}`);
  process.exit(1);
}
console.log('Casse des noms de fichiers : aucun doublon.');
