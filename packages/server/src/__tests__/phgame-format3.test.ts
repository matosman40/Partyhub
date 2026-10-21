import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { PackageService } from '../packages/service.js';
import {
  PackageValidationError,
  DEFAULT_PACKAGE_LIMITS,
  packageGameId,
  validatePackage,
  PHGAME_FORMAT_VERSION,
} from '../packages/format.js';
import { PARTYHUB_ENGINE } from '../packages/engine.js';
import { createPackageGame } from '../packages/factory.js';
import { buildPackage, packExample, readExampleDefinition, tinyPng } from './helpers/package-kit.js';

/** Paquet « recette », au format 3, à partir de la définition d'exemple. */
function recipePackage(
  options: {
    definition?: unknown;
    manifest?: (m: Record<string, any>) => void;
    files?: Record<string, Uint8Array>;
    undeclared?: string[];
  } = {},
): Uint8Array {
  return buildPackage({
    id: 'ma-recette',
    definition: options.definition ?? readExampleDefinition('exemple-recette'),
    files: options.files,
    undeclared: options.undeclared,
    manifest: (m) => {
      m.formatVersion = 3;
      m.requires.modules = ['recipe'];
      m.engine.minVersion = '0.12.0';
      m.name = 'Recette de test';
      options.manifest?.(m);
    },
  });
}

function issuesOf(bytes: Uint8Array): string[] {
  try {
    validatePackage(bytes);
    return [];
  } catch (err) {
    if (err instanceof PackageValidationError) return err.issues;
    throw err;
  }
}

describe('format 3 : recettes', () => {
  it('le moteur annonce la version 0.17.1 et le module recette', () => {
    expect(PARTYHUB_ENGINE.version).toBe('0.17.1');
    expect(PARTYHUB_ENGINE.modules).toContain('recipe');
    expect(PHGAME_FORMAT_VERSION).toBe(4);
  });

  it('le paquet de recette d’exemple est valide, très petit, et de module recipe', () => {
    const pkg = validatePackage(packExample('exemple-recette'));
    expect(pkg.module).toBe('recipe');
    expect(pkg.manifest.formatVersion).toBe(3);
    expect(pkg.size).toBeLessThan(4 * 1024);
  });

  it('un jeu de recette devient un jeu du registre, préfixé « pkgr- »', () => {
    expect(packageGameId('ma-recette', 'recipe')).toBe('pkgr-ma-recette');
    const game = createPackageGame(validatePackage(packExample('exemple-recette')));
    expect(game.manifest.id).toBe('pkgr-exemple-recette');
    expect(game.manifest.category).toBe('quiz');
    expect(game.manifest.ai).toBe(false);
  });

  it('une recette avec IA est signalée comme telle dans le catalogue', () => {
    const bytes = recipePackage({
      definition: { ...readExampleDefinition('exemple-recette'), ai: { theme: 'camping', nombre: 4 } },
    });
    const game = createPackageGame(validatePackage(bytes));
    expect(game.manifest.ai).toBe(true);
  });

  it('une recette demande le format 3 et le format 3 ne porte que des recettes', () => {
    const asV2 = recipePackage({ manifest: (m) => (m.formatVersion = 2) });
    expect(issuesOf(asV2).join(' ')).toContain('Une recette demande le format 3');
    const cardsAsV3 = buildPackage({
      definition: readExampleDefinition('exemple-cartes'),
      manifest: (m) => {
        m.formatVersion = 3;
        m.engine.minVersion = '0.12.0';
      },
    });
    expect(issuesOf(cardsAsV3).join(' ')).toContain('Le format 3 ne porte que des recettes');
  });

  it('le format 3 exige un moteur 0.12.0 ou plus', () => {
    const old = recipePackage({ manifest: (m) => (m.engine.minVersion = '0.11.0') });
    expect(issuesOf(old).join(' ')).toContain('Le format 3 demande PartyHub 0.12.0 au minimum');
  });

  it('une clé inconnue dans la définition fait refuser le paquet, avec son chemin', () => {
    const bytes = recipePackage({ definition: { ...readExampleDefinition('exemple-recette'), script: 'x' } });
    const issues = issuesOf(bytes);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).toContain('game/definition.json');
  });

  it('un bloc mal placé fait refuser le paquet, avec le chemin du bloc', () => {
    const bytes = recipePackage({
      definition: { ...readExampleDefinition('exemple-recette'), ecrans: { tv: { ecriture: ['saisie-texte'] } } },
    });
    const issues = issuesOf(bytes);
    expect(issues.join(' ')).toContain('ecrans.tv.ecriture.0');
  });

  it('une image trop lourde est refusée, avec la limite en Ko', () => {
    const heavy = new Uint8Array(tinyPng(64, 64).length + 210 * 1024);
    heavy.set(tinyPng(64, 64), 0);
    const bytes = recipePackage({
      files: { 'assets/lourde.png': heavy },
      manifest: (m) => (m.licenses[0].covers = ['assets/lourde.png']),
    });
    expect(issuesOf(bytes).join(' ')).toContain('image trop lourde (maximum 200 Ko)');
  });

  it('les budgets par défaut sont ceux de la v1 : archive 8 Mo, manifeste 8 Ko, définition 256 Ko', () => {
    expect(DEFAULT_PACKAGE_LIMITS.maxArchiveBytes).toBe(8 * 1024 * 1024);
    expect(DEFAULT_PACKAGE_LIMITS.maxManifestBytes).toBe(8 * 1024);
    expect(DEFAULT_PACKAGE_LIMITS.maxJsonBytes).toBe(256 * 1024);
    expect(DEFAULT_PACKAGE_LIMITS.maxImageBytes).toBe(200 * 1024);
    expect(DEFAULT_PACKAGE_LIMITS.maxImageSide).toBe(1024);
  });

  it('un manifeste trop gros est refusé avec le budget donné', () => {
    const bytes = packExample('exemple-recette');
    expect(() => validatePackage(bytes, { ...DEFAULT_PACKAGE_LIMITS, maxManifestBytes: 50 })).toThrow(
      PackageValidationError,
    );
  });
});

describe('installation d’une recette', () => {
  it('une recette installée se réinstalle comme recette, pas comme jeu de cartes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-recette-'));
    const store = new Store(path.join(dir, 'partyhub.db'));
    try {
      const service = new PackageService(store, dir);
      const bytes = packExample('exemple-recette');
      expect(service.install(bytes)).toMatchObject({ ok: true });
      // Réinstaller le même paquet ne doit pas le signaler comme un changement de module.
      expect(service.install(bytes)).toMatchObject({ ok: true, unchanged: true });
      // Un jeu de cartes ne prend pas l'identifiant d'une recette installée.
      const cards = buildPackage({ id: 'exemple-recette', definition: readExampleDefinition('exemple-cartes') });
      const refused = service.install(cards);
      expect(refused.ok).toBe(false);
      expect(refused.ok ? '' : refused.error).toContain('est installé comme jeu de recette');
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
