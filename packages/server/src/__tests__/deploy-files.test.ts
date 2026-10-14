import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Garde-fou : chaque variable documentée dans .env.example doit atteindre le conteneur, et réciproquement. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const COMPOSE_FILES = ['compose.yaml', 'compose.dev.yaml'];

/** Noms de variables : lignes « NOM=… », commentées ou non. */
function documented(text: string): string[] {
  return [...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
}

/** Variables lues par le compose : ${NOM} ou ${NOM:-…}. */
function usedBy(text: string): string[] {
  return [...text.matchAll(/\$\{([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!);
}

describe('fichiers de déploiement', () => {
  const variables = documented(read('.env.example'));

  it('.env.example documente bien les variables', () => {
    expect(variables).toEqual(expect.arrayContaining(['ADMIN_PASSWORD', 'GITHUB_TOKEN', 'PARTYHUB_PORT']));
  });

  for (const file of COMPOSE_FILES) {
    it(`${file} transmet chaque variable documentée au conteneur`, () => {
      const compose = read(file);
      const missing = variables.filter((name) => !usedBy(compose).includes(name));
      expect(missing).toEqual([]);
    });

    it(`${file} n'utilise aucune variable absente de .env.example`, () => {
      const unknown = usedBy(read(file)).filter((name) => !variables.includes(name));
      expect(unknown).toEqual([]);
    });
  }
});
