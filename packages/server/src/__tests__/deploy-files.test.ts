import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Garde-fou : chaque variable documentée dans .env.example doit atteindre le conteneur, et réciproquement. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const COMPOSE_FILES = ['compose.yaml', 'compose.dev.yaml', 'deploy/https/compose.https.yaml'];
/** Surcouche optionnelle : ses variables ne sont pas toutes utiles au compose de base. */
const BASE_COMPOSE = ['compose.yaml', 'compose.dev.yaml'];
const OVERLAY_ONLY = ['PARTYHUB_HOST', 'PARTYHUB_HTTPS_PORT'];

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

  it('chaque variable documentée atteint un conteneur (compose de base ou surcouche HTTPS)', () => {
    const used = COMPOSE_FILES.flatMap((file) => usedBy(read(file)));
    const missing = variables.filter((name) => !used.includes(name));
    expect(missing).toEqual([]);
  });

  it('le compose de base transmet chaque variable qu’il documente, hors surcouche HTTPS', () => {
    for (const file of BASE_COMPOSE) {
      const baseVariables = variables.filter((name) => !OVERLAY_ONLY.includes(name));
      const missing = baseVariables.filter((name) => !usedBy(read(file)).includes(name));
      expect(missing, file).toEqual([]);
    }
  });

  for (const file of COMPOSE_FILES) {
    it(`${file} n'utilise aucune variable absente de .env.example`, () => {
      const unknown = usedBy(read(file)).filter((name) => !variables.includes(name));
      expect(unknown).toEqual([]);
    });
  }
});
