import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { PackageService } from '../packages/service.js';
import { PackageValidationError, packageGameId, validatePackage } from '../packages/format.js';
import { resolveGame } from '../games-registry.js';
import { buildPackage, packExample, readExampleDefinition as readExample } from './helpers/package-kit.js';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-paquets2-'));
  store = new Store(path.join(dir, 'partyhub.db'));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Paquet de plateau, au format 2, à partir d'une définition au choix. */
function boardPackage(options: { id?: string; version?: string; definition?: unknown } = {}): Uint8Array {
  return buildPackage({
    id: options.id ?? 'mon-plateau',
    version: options.version,
    definition: options.definition ?? readExample('exemple-plateau'),
    manifest: (m) => {
      m.formatVersion = 2;
      m.requires.modules = ['board'];
      m.engine.minVersion = '0.7.0';
      m.name = 'Plateau de test';
    },
  });
}

/** Paquet de questions, au format 2, à partir d'une définition au choix. */
function quizPackage(options: { id?: string; definition?: unknown } = {}): Uint8Array {
  return buildPackage({
    id: options.id ?? 'mes-questions',
    definition: options.definition ?? readExample('exemple-quiz'),
    manifest: (m) => {
      m.formatVersion = 2;
      m.requires.modules = ['quiz'];
      m.engine.minVersion = '0.7.0';
      m.name = 'Questions de test';
    },
  });
}

describe('format 2 : plateau et questions', () => {
  it('le paquet de plateau d’exemple est valide, petit, et de module board', () => {
    const pkg = validatePackage(packExample('exemple-plateau'));
    expect(pkg.module).toBe('board');
    expect(pkg.size).toBeLessThan(16 * 1024);
  });

  it('le paquet de questions d’exemple est valide, sans fichier de la médiathèque', () => {
    const pkg = validatePackage(packExample('exemple-quiz'));
    expect(pkg.module).toBe('quiz');
    expect(pkg.size).toBeLessThan(16 * 1024);
  });

  it('installe un plateau comme jeu de plateau, sous un identifiant propre', () => {
    const service = new PackageService(store, dir);
    const result = service.install(packExample('exemple-plateau'));
    expect(result).toMatchObject({ ok: true, id: 'exemple-plateau', gameId: 'pkgb-exemple-plateau' });
    expect(resolveGame('pkgb-exemple-plateau')?.manifest.category).toBe('plateau');
    expect(service.get('exemple-plateau')?.status).toBe('actif');
  });

  it('installe des questions comme jeu de quiz, et les garde après redémarrage', () => {
    const service = new PackageService(store, dir);
    expect(service.install(packExample('exemple-quiz'))).toMatchObject({ ok: true, gameId: 'pkgq-exemple-quiz' });
    expect(resolveGame('pkgq-exemple-quiz')?.manifest.category).toBe('quiz');

    const restarted = new PackageService(store, dir);
    expect(restarted.get('exemple-quiz')?.status).toBe('actif');
    expect(resolveGame('pkgq-exemple-quiz')).toBeDefined();
  });

  it('refuse un quiz qui référence un fichier de la médiathèque', () => {
    const definition = readExample('exemple-quiz') as { items: { source: unknown }[] };
    definition.items[0]!.source = { type: 'asset', assetId: 'a'.repeat(32), mediaKind: 'audio' };
    expect(() => validatePackage(quizPackage({ definition }))).toThrow(PackageValidationError);
    try {
      validatePackage(quizPackage({ definition }));
    } catch (err) {
      expect((err as PackageValidationError).issues.join(' ')).toContain('médiathèque');
    }
  });

  it('refuse un plateau dont la dernière case n’est pas l’arrivée', () => {
    const definition = readExample('exemple-plateau') as { cells: { kind: string }[] };
    definition.cells[definition.cells.length - 1]!.kind = 'normal';
    expect(() => validatePackage(boardPackage({ definition }))).toThrow(PackageValidationError);
  });

  it('refuse un format 1 qui déclare un module de plateau', () => {
    const bytes = buildPackage({
      manifest: (m) => {
        m.requires.modules = ['board'];
      },
    });
    try {
      validatePackage(bytes);
      expect.unreachable('le paquet aurait dû être refusé');
    } catch (err) {
      expect((err as PackageValidationError).issues.join(' ')).toContain('format 1');
    }
  });

  it('refuse un paquet qui déclare deux modules de jeu', () => {
    const bytes = buildPackage({
      manifest: (m) => {
        m.formatVersion = 2;
        m.requires.modules = ['cards', 'board'];
      },
    });
    expect(() => validatePackage(bytes)).toThrow(PackageValidationError);
  });

  it('refuse un module de jeu inconnu', () => {
    const bytes = buildPackage({
      manifest: (m) => {
        m.formatVersion = 2;
        m.requires.modules = ['javascript'];
      },
    });
    expect(() => validatePackage(bytes)).toThrow(PackageValidationError);
  });

  it('refuse de changer le type d’un paquet déjà installé lors d’une mise à jour', () => {
    const service = new PackageService(store, dir);
    expect(service.install(boardPackage({ id: 'meme-id', version: '1.0.0' }))).toMatchObject({ ok: true });
    const result = service.install(quizPackage({ id: 'meme-id' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Changez d’identifiant');
  });

  it('met à jour un plateau installé avec une version plus récente', () => {
    const service = new PackageService(store, dir);
    service.install(boardPackage({ id: 'mon-plateau', version: '1.0.0' }));
    expect(service.install(boardPackage({ id: 'mon-plateau', version: '1.1.0' }))).toMatchObject({
      ok: true,
      version: '1.1.0',
    });
    expect(service.get('mon-plateau')?.version).toBe('1.1.0');
  });

  it('un jeu de cartes et un jeu de plateau de même nom n’ont jamais le même identifiant', () => {
    expect(packageGameId('x', 'cards')).not.toBe(packageGameId('x', 'board'));
    expect(packageGameId('x', 'board')).not.toBe(packageGameId('x', 'quiz'));
    expect(packageGameId('b-x', 'cards')).not.toBe(packageGameId('x', 'board'));
    expect(packageGameId('q-x', 'cards')).not.toBe(packageGameId('x', 'quiz'));
  });
});
