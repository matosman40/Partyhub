import fs from 'node:fs';
import path from 'node:path';
import { PACK_FILE, writeFileAtomic } from '../characters/packs.js';

/**
 * Personnages et images dans l’archive complète : `personnages/packs/<id>/…` et `personnages/images/<id>.<ext>`.
 * Seuls ces chemins sont acceptés, à la lecture comme à l’écriture. Un personnage ou une image déjà présent(e)
 * n’est jamais remplacé(e) : on ajoute, comme pour la médiathèque.
 */

export const PERSONNAGE_ENTRY =
  /^personnages\/(packs\/[a-z0-9][a-z0-9-]{1,47}\/(?:pack\.json|[a-z0-9][a-z0-9-]{0,47}\/(?:visages|poses|marche)\.png)|images\/[0-9a-f]{24}\.(?:json|png|jpg|webp))$/;

export interface PersonnageFile {
  name: string;
  data: Uint8Array;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** Tous les fichiers du dossier des personnages, sous leur nom d’archive. Les fichiers temporaires sont ignorés. */
export function personnageFiles(root: string): PersonnageFile[] {
  const files: PersonnageFile[] = [];
  for (const sub of ['packs', 'images']) {
    const base = path.join(root, sub);
    if (!fs.existsSync(base)) continue;
    for (const file of walk(base)) {
      const name = `personnages/${path.relative(root, file).split(path.sep).join('/')}`;
      if (PERSONNAGE_ENTRY.test(name)) files.push({ name, data: fs.readFileSync(file) });
    }
  }
  return files;
}

/** Clé d’un groupe : un personnage (`packs/<id>`) ou une image (`images/<id>`). */
function groupOf(name: string): { key: string; kind: 'packs' | 'images'; id: string } {
  const [, kind, rest = ''] = name.split('/');
  const id = kind === 'images' ? rest.replace(/\.[a-z]+$/, '') : rest;
  return { key: `${kind}/${id}`, kind: kind as 'packs' | 'images', id };
}

export interface PersonnageRestore {
  /** Personnages et images ajoutés. */
  added: number;
  /** Personnages et images déjà présents, laissés tels quels. */
  present: number;
}

/** Écrit les personnages et images d’une archive dans le dossier des personnages. */
export function restorePersonnages(root: string, entries: Map<string, Uint8Array>): PersonnageRestore {
  const groups = new Map<string, { kind: 'packs' | 'images'; id: string; files: [string, Uint8Array][] }>();
  for (const [name, data] of entries) {
    if (!PERSONNAGE_ENTRY.test(name)) continue;
    const { key, kind, id } = groupOf(name);
    const group = groups.get(key) ?? { kind, id, files: [] };
    group.files.push([name, data]);
    groups.set(key, group);
  }
  const result: PersonnageRestore = { added: 0, present: 0 };
  for (const group of groups.values()) {
    const existing =
      group.kind === 'packs'
        ? path.join(root, 'packs', group.id, PACK_FILE)
        : path.join(root, 'images', `${group.id}.json`);
    if (fs.existsSync(existing)) {
      result.present++;
      continue;
    }
    for (const [name, data] of group.files) {
      writeFileAtomic(path.join(root, ...name.split('/').slice(1)), data);
    }
    result.added++;
  }
  return result;
}
