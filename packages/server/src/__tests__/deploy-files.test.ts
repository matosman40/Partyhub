import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Garde-fou : chaque variable documentée dans .env.example doit atteindre le conteneur, et réciproquement. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const COMPOSE_FILES = [
  'compose.yaml',
  'compose.dev.yaml',
  'deploy/https/compose.https.yaml',
  'deploy/casaos/compose.https.yaml',
];
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

  it('le fichier CasaOS HTTPS embarque exactement le Caddyfile de la surcouche (adresse de test mise à part)', () => {
    // Même configuration Caddy dans les deux fichiers : ils ne peuvent pas diverger sans que ce test échoue.
    const caddyfile =
      read('deploy/https/Caddyfile')
        .split('\n')
        .filter((line) => line.trim() && !line.trim().startsWith('#'))
        .map((line) =>
          line
            .replace(/\t/g, '  ')
            .replace('{$PARTYHUB_HOST}', '192.168.1.156')
            .replace('{$CADDY_CA_DIR:/data/caddy/pki/authorities/local}', '/data/caddy/pki/authorities/local'),
        )
        .join('\\n') + '\\n';
    const embedded = /printf "%b" "([^"]*)"/.exec(read('deploy/casaos/compose.https.yaml'))?.[1];
    expect(embedded).toBe(caddyfile);
  });

  it('le fichier CasaOS est sûr à coller dans l’interface : un seul « $ » légitime, pas de « $$ »', () => {
    // CasaOS réécrit les « $ » de ses champs : une chaîne contenant « $$ » ou une variable inconnue casse l'installation.
    const text = read('deploy/casaos/compose.https.yaml');
    expect(text).not.toContain('$$');
    const dollars = [...text.matchAll(/\$[^ \n'"]*/g)].map((m) => m[0]);
    expect(dollars.every((d) => d.startsWith('${ADMIN_PASSWORD'))).toBe(true);
  });

  it('le fichier CasaOS épingle une version précise de l’image, pas « latest »', () => {
    expect(read('deploy/casaos/compose.https.yaml')).toMatch(/image: ghcr\.io\/matosman40\/partyhub:\d+\.\d+\.\d+\n/);
  });

  for (const file of COMPOSE_FILES) {
    it(`${file} n'utilise aucune variable absente de .env.example`, () => {
      const unknown = usedBy(read(file)).filter((name) => !variables.includes(name));
      expect(unknown).toEqual([]);
    });
  }
});
