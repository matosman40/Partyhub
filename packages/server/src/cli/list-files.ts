import fs from 'node:fs';
import path from 'node:path';

/** Liste les fichiers d’un dossier, en chemins relatifs POSIX. Les liens symboliques sont refusés. */
export function listFiles(root: string, dir = ''): string[] {
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
