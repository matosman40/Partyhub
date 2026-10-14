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
    // L'ancienne version reste conservée pour un retour arrière.
    expect(fs.existsSync(path.join(dir, 'games', 'exemple-cartes', '1.0.0', 'package.phgame'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'games', 'exemple-cartes', '1.1.0', 'package.phgame'))).toBe(true);
  });

  it('importe une version plus ancienne sans l’activer', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage({ version: '1.1.0' }));
    expect(service.install(buildPackage({ version: '1.0.0' }))).toMatchObject({ ok: true, version: '1.0.0', active: false });
    expect(service.get('exemple-cartes')).toMatchObject({ version: '1.1.0', status: 'actif' });
    expect(service.versions('exemple-cartes')?.map((v) => [v.version, v.active])).toEqual([
      ['1.1.0', true],
      ['1.0.0', false],
    ]);
  });

  it('reconnaît une version conservée déjà importée, sans la réécrire', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage({ version: '1.1.0' }));
    service.install(buildPackage({ version: '1.0.0' }));
    expect(service.install(buildPackage({ version: '1.0.0' }))).toMatchObject({ ok: true, unchanged: true, active: false });
    const other = service.install(buildPackage({ version: '1.0.0', manifest: (m) => { m.description = 'Autre contenu.'; } }));
    expect(other).toMatchObject({ ok: false });
    expect((other as { error: string }).error).toMatch(/contenu différent/);
  });

  it('active une version conservée, puis revient à la version précédente', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    service.install(buildPackage({ version: '1.1.0' }));

    expect(service.activate('exemple-cartes', '1.0.0')).toEqual({ ok: true, version: '1.0.0' });
    expect(service.get('exemple-cartes')).toMatchObject({ version: '1.0.0', status: 'actif' });
    expect(service.versions('exemple-cartes')?.map((v) => [v.version, v.active])).toEqual([
      ['1.1.0', false],
      ['1.0.0', true],
    ]);

    expect(service.activate('exemple-cartes', '1.1.0')).toEqual({ ok: true, version: '1.1.0' });
    expect(service.get('exemple-cartes')?.version).toBe('1.1.0');
  });

  it('supprime une version conservée, jamais la version active', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    service.install(buildPackage({ version: '1.1.0' }));

    expect(service.removeArchivedVersion('exemple-cartes', '1.1.0')).toMatchObject({ ok: false });
    expect(service.removeArchivedVersion('exemple-cartes', '0.9.0')).toMatchObject({ ok: false });
    expect(service.removeArchivedVersion('inconnu', '1.0.0')).toEqual({ ok: false, error: 'Paquet inconnu.' });

    expect(service.removeArchivedVersion('exemple-cartes', '1.0.0')).toEqual({ ok: true, version: '1.0.0' });
    expect(fs.existsSync(path.join(dir, 'games', 'exemple-cartes', '1.0.0'))).toBe(false);
    expect(service.versions('exemple-cartes')?.map((v) => v.version)).toEqual(['1.1.0']);
    expect(service.get('exemple-cartes')).toMatchObject({ version: '1.1.0', status: 'actif' });
  });

  it('refuse d’activer une version inconnue ou une archive altérée', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    service.install(buildPackage({ version: '1.1.0' }));

    expect(service.activate('exemple-cartes', '0.9.0')).toMatchObject({ ok: false });
    expect(service.activate('inconnu', '1.0.0')).toEqual({ ok: false, error: 'Paquet inconnu.' });

    fs.writeFileSync(path.join(dir, 'games', 'exemple-cartes', '1.0.0', 'package.phgame'), enc('altérée'));
    expect(service.activate('exemple-cartes', '1.0.0')).toMatchObject({ ok: false });
    expect(service.get('exemple-cartes')?.version).toBe('1.1.0');
  });

  it('supprime aussi les versions conservées avec le paquet', () => {
    const service = new PackageService(store, dir);
    service.install(buildPackage());
    service.install(buildPackage({ version: '1.1.0' }));
    expect(service.remove('exemple-cartes')).toBe(true);
    expect(service.versions('exemple-cartes')).toBeUndefined();
    expect(store.listPackageArchives('exemple-cartes')).toEqual([]);
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
