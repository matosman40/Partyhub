import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { PackageService } from '../packages/service.js';
import { allGames, resolveGame } from '../games-registry.js';
import { buildPackage, enc, exampleDefinition, tinyPng } from './helpers/package-kit.js';

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-paquets-'));
  store = new Store(path.join(dir, 'partyhub.db'));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const gameIds = () => allGames().map((g) => g.manifest.id);
const ASSET_PACKAGE = (): Uint8Array =>
  buildPackage({
    files: { 'assets/logo.png': tinyPng(64, 64) },
    manifest: (m) => {
      m.licenses[0].covers = ['assets/logo.png'];
    },
  });

describe('service des paquets installés', () => {
  it('installe un paquet, le rend jouable et le retrouve après redémarrage', () => {
    const service = new PackageService(store, dir);
    expect(service.install(buildPackage())).toMatchObject({
      ok: true,
      id: 'exemple-cartes',
      gameId: 'pkg-exemple-cartes',
      version: '1.0.0',
      unchanged: false,
    });
    expect(resolveGame('pkg-exemple-cartes')).toBeDefined();
    expect(service.list()).toEqual([
      expect.objectContaining({ id: 'exemple-cartes', status: 'actif', enabled: true, version: '1.0.0' }),
    ]);

    const restarted = new PackageService(store, dir);
    expect(restarted.get('exemple-cartes')?.status).toBe('actif');
    expect(gameIds()).toContain('pkg-exemple-cartes');
  });

  it('reconnaît une réinstallation identique sans rien modifier', () => {
    const service = new PackageService(store, dir);
    const bytes = buildPackage();
    service.install(bytes);
    expect(service.install(bytes)).toMatchObject({ ok: true, unchanged: true });
  });

  it('refuse une archive différente portant la même version', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    const other = buildPackage({ definition: { ...exampleDefinition(), description: 'Autre contenu.' } });
    const result = service.install(other);
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/contenu différent/);
  });

  it('met à jour vers une version plus récente et retire l’ancienne', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    expect(service.install(buildPackage({ version: '1.1.0' }))).toMatchObject({ ok: true, version: '1.1.0' });
    expect(service.get('exemple-cartes')).toMatchObject({ version: '1.1.0', enabled: true, status: 'actif' });
    expect(fs.existsSync(path.join(dir, 'games', 'exemple-cartes', '1.0.0'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'games', 'exemple-cartes', '1.1.0', 'package.phgame'))).toBe(true);
  });

  it('refuse le retour arrière vers une version plus ancienne', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage({ version: '1.1.0' }));
    const result = service.install(buildPackage({ version: '1.0.0' }));
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/Retour arrière refusé/);
    expect(service.get('exemple-cartes')?.version).toBe('1.1.0');
  });

  it('refuse un paquet invalide sans rien écrire sur le disque', () => {
    const service = new PackageService(store, dir);
    const result = service.install(buildPackage({ files: { 'data/x.json': enc('{}') }, undeclared: ['data/x.json'] }));
    expect(result).toMatchObject({ ok: false });
    expect((result as { issues: string[] }).issues.length).toBeGreaterThan(0);
    expect(service.list()).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'games'))).toBe(false);
  });

  it('refuse un jeu qui ne se lance pas correctement', () => {
    const service = new PackageService(store, dir, { launch: { maxSteps: 1 } });
    const result = service.install(buildPackage());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/ne se lance pas/);
    expect(service.list()).toEqual([]);
    expect(gameIds()).not.toContain('pkg-exemple-cartes');
  });

  it('désactiver un paquet le retire du catalogue, et le réactiver le rend à nouveau jouable', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    expect(service.setEnabled('exemple-cartes', false)).toBe(true);
    expect(service.get('exemple-cartes')).toMatchObject({ enabled: false, status: 'désactivé' });
    expect(gameIds()).not.toContain('pkg-exemple-cartes');

    expect(service.setEnabled('exemple-cartes', true)).toBe(true);
    expect(gameIds()).toContain('pkg-exemple-cartes');
  });

  it('sert les ressources graphiques d’un paquet actif seulement', () => {
    const service = new PackageService(store, dir);
    service.install(ASSET_PACKAGE());
    expect(service.asset('exemple-cartes', 'assets/logo.png')).toMatchObject({ contentType: 'image/png' });
    expect(service.asset('exemple-cartes', '../partyhub.db')).toBeNull();
    expect(service.asset('exemple-cartes', 'game/definition.json')).toBeNull();

    service.setEnabled('exemple-cartes', false);
    expect(service.asset('exemple-cartes', 'assets/logo.png')).toBeNull();
  });

  it('supprime un paquet, ses fichiers et son jeu', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    expect(service.remove('exemple-cartes')).toBe(true);
    expect(service.list()).toEqual([]);
    expect(store.getPackage('exemple-cartes')).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'games', 'exemple-cartes'))).toBe(false);
    expect(gameIds()).not.toContain('pkg-exemple-cartes');
    expect(service.remove('exemple-cartes')).toBe(false);
  });

  it('marque en erreur une archive modifiée sur le disque, sans la jouer', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    fs.writeFileSync(path.join(dir, 'games', 'exemple-cartes', '1.0.0', 'package.phgame'), enc('altérée'));

    const restarted = new PackageService(store, dir);
    expect(restarted.get('exemple-cartes')).toMatchObject({ status: 'erreur' });
    expect(restarted.get('exemple-cartes')?.error).toMatch(/empreinte/);
    expect(gameIds()).not.toContain('pkg-exemple-cartes');
  });
});
