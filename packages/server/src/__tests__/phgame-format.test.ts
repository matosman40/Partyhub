import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PACKAGE_LIMITS, PackageValidationError, pathProblem, validatePackage } from '../packages/format.js';
import { PARTYHUB_ENGINE } from '../packages/engine.js';
import { writeZip } from '../packages/zip.js';
import { EXAMPLE_DIR, buildPackage, enc, exampleDefinition, tinyPng } from './helpers/package-kit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function issuesOf(bytes: Uint8Array): string[] {
  try {
    validatePackage(bytes);
    return [];
  } catch (err) {
    if (err instanceof PackageValidationError) return err.issues;
    throw err;
  }
}

const covered = (name: string) => ({
  licenses: [{ path: 'licenses/LICENCE.txt', covers: [name] }],
});

describe('validation d’un paquet .phgame', () => {
  it('accepte le paquet d’exemple livré dans le dépôt', () => {
    const bytes = fs.readFileSync(`${EXAMPLE_DIR}.phgame`);
    const pkg = validatePackage(bytes);
    expect(pkg.manifest.id).toBe('exemple-cartes');
    expect(pkg.definition.cards.length).toBeGreaterThan(0);
  });

  it('accepte un paquet bien formé', () => {
    expect(issuesOf(buildPackage())).toEqual([]);
  });

  it('refuse une empreinte SHA-256 incorrecte', () => {
    const bytes = buildPackage({
      manifest: (m) => {
        m.files[0].sha256 = '0'.repeat(64);
      },
    });
    expect(issuesOf(bytes).join(' ')).toMatch(/empreinte SHA-256 incorrecte/);
  });

  it('refuse un fichier présent dans l’archive mais non déclaré', () => {
    const bytes = buildPackage({ files: { 'data/notes.json': enc('{}') }, undeclared: ['data/notes.json'] });
    expect(issuesOf(bytes).join(' ')).toMatch(/sans être déclaré/);
  });

  it('refuse un fichier déclaré mais absent', () => {
    const bytes = buildPackage({
      manifest: (m) => m.files.push({ path: 'data/absent.json', size: 2, sha256: '0'.repeat(64) }),
    });
    expect(issuesOf(bytes).join(' ')).toMatch(/absent de l’archive/);
  });

  it('refuse un chemin qui sort du paquet', () => {
    const bytes = buildPackage({ files: { '../evil.json': enc('{}') }, undeclared: ['../evil.json'] });
    expect(issuesOf(bytes).join(' ')).toMatch(/non autorisé/);
  });

  it('refuse un type de fichier interdit', () => {
    const bytes = buildPackage({ files: { 'game/script.js': enc('alert(1)') } });
    expect(issuesOf(bytes).join(' ')).toMatch(/type de fichier « .js »/);
  });

  it('refuse une version minimale du moteur trop récente', () => {
    const bytes = buildPackage({
      manifest: (m) => {
        m.engine.minVersion = '9.0.0';
      },
    });
    expect(issuesOf(bytes).join(' ')).toMatch(/PartyHub 9\.0\.0 au minimum/);
  });

  it('refuse une API de paquet inconnue', () => {
    const bytes = buildPackage({
      manifest: (m) => {
        m.engine.api = 2;
      },
    });
    expect(issuesOf(bytes).join(' ')).toMatch(/manifest\.json \(engine\.api\)/);
  });

  it('refuse un manifeste contenant une clé inconnue', () => {
    const bytes = buildPackage({
      manifest: (m) => {
        m.script = 'alert(1)';
      },
    });
    expect(issuesOf(bytes).join(' ')).toMatch(/manifest\.json/);
  });

  it('refuse une définition de jeu invalide', () => {
    const bytes = buildPackage({ definition: { ...exampleDefinition(), families: [] } });
    expect(issuesOf(bytes).join(' ')).toMatch(/game\/definition\.json/);
  });

  it('refuse une ressource qui n’est couverte par aucune licence', () => {
    const bytes = buildPackage({ files: { 'assets/logo.png': tinyPng(64, 64) } });
    expect(issuesOf(bytes).join(' ')).toMatch(/n’est couverte par aucune licence/);
  });

  it('accepte une ressource couverte par une licence', () => {
    const bytes = buildPackage({
      files: { 'assets/logo.png': tinyPng(64, 64) },
      manifest: (m) => Object.assign(m, covered('assets/logo.png')),
    });
    expect(issuesOf(bytes)).toEqual([]);
  });

  it('refuse un fichier .png qui n’est pas une image PNG', () => {
    const bytes = buildPackage({
      files: { 'assets/logo.png': enc('pas une image') },
      manifest: (m) => Object.assign(m, covered('assets/logo.png')),
    });
    expect(issuesOf(bytes).join(' ')).toMatch(/fichier .png invalide/);
  });

  it('refuse une image dont les dimensions dépassent la limite', () => {
    const bytes = buildPackage({
      files: { 'assets/grand.png': tinyPng(4096, 16) },
      manifest: (m) => Object.assign(m, covered('assets/grand.png')),
    });
    expect(issuesOf(bytes).join(' ')).toMatch(/trop grande/);
  });

  it('refuse une licence placée hors du dossier licenses/', () => {
    const bytes = buildPackage({
      manifest: (m) => {
        m.licenses[0].path = 'game/definition.json';
      },
    });
    expect(issuesOf(bytes).join(' ')).toMatch(/hors du dossier licenses/);
  });

  it('refuse une archive sans manifest.json', () => {
    const bytes = writeZip([{ name: 'game/definition.json', data: enc('{}') }]);
    expect(issuesOf(bytes).join(' ')).toMatch(/manifest\.json est absent/);
  });

  it('refuse un paquet plus grand que la limite configurée', () => {
    const bytes = buildPackage();
    expect(() => validatePackage(bytes, { ...DEFAULT_PACKAGE_LIMITS, maxArchiveBytes: 100 })).toThrow(
      PackageValidationError,
    );
  });

  it('classe les chemins : autorisés et refusés', () => {
    const allowed = [
      'game/definition.json',
      'assets/a.webp',
      'data/liste.json',
      'licenses/LICENCE.txt',
      'manifest.json',
    ];
    for (const p of allowed) expect(pathProblem(p, DEFAULT_PACKAGE_LIMITS), p).toBeNull();
    const refused = [
      '/etc/passwd',
      'game/../x.json',
      'C:/x.json',
      'data/x.exe',
      'autre/x.json',
      'a\\b.json',
      'racine.json',
    ];
    for (const p of refused) expect(pathProblem(p, DEFAULT_PACKAGE_LIMITS), p).not.toBeNull();
  });

  it('la version du moteur annoncée correspond à la version du serveur', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '../../package.json'), 'utf8')) as { version: string };
    expect(PARTYHUB_ENGINE.version).toBe(pkg.version);
  });
});
