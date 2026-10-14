import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { PackageService } from '../packages/service.js';
import {
  copyNameOf,
  copyPackageToEditable,
  packageCopyStatuses,
  updateCopyFromPackage,
  type CopyServices,
} from '../packages/copy.js';
import { CardGameService } from '../cards/service.js';
import { BoardGameService } from '../boards/service.js';
import { MediaQuizService } from '../media/service.js';
import type { AssetService } from '../assets/service.js';
import { buildPackage, exampleDefinition, packExample } from './helpers/package-kit.js';

let dir: string;
let store: Store;
let services: CopyServices;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-copie-'));
  store = new Store(path.join(dir, 'partyhub.db'));
  // Les paquets n'utilisent jamais la médiathèque : un faux service suffit.
  const assets = { get: () => undefined } as unknown as AssetService;
  services = {
    packages: new PackageService(store, dir),
    cardGames: new CardGameService(store),
    boardGames: new BoardGameService(store),
    mediaGames: new MediaQuizService(store, assets),
    store,
  };
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('copie modifiable d’un paquet', () => {
  it('copie un plateau dans l’éditeur de plateaux, puis la copie se modifie librement', () => {
    expect(services.packages.install(packExample('exemple-plateau'))).toMatchObject({ ok: true });

    const copy = copyPackageToEditable('exemple-plateau', services);
    expect(copy).toMatchObject({ ok: true, module: 'board', name: 'Exemple de plateau (copie)' });
    if (!copy.ok) return;
    expect(copy.id.startsWith('board-')).toBe(true);

    // La copie est un jeu de l'administration : son nom, sa description et ses règles se changent.
    const record = services.boardGames.list().find((r) => r.id === copy.id)!;
    const edited = services.boardGames.save(copy.id, {
      ...record.definition,
      name: 'Mon plateau à moi',
      description: 'Une description écrite par l’administrateur.',
      rules: { ...record.definition.rules, dice: 2 },
    });
    expect(edited).toMatchObject({ ok: true, id: copy.id });
    const after = services.boardGames.list().find((r) => r.id === copy.id)!;
    expect(after.definition).toMatchObject({
      name: 'Mon plateau à moi',
      description: 'Une description écrite par l’administrateur.',
      rules: { dice: 2 },
    });
  });

  it('copie un jeu de cartes dans l’éditeur de cartes, sans toucher au paquet', () => {
    expect(services.packages.install(buildPackage())).toMatchObject({ ok: true, gameId: 'pkg-exemple-cartes' });

    const copy = copyPackageToEditable('exemple-cartes', services);
    expect(copy).toMatchObject({ ok: true, module: 'cards', name: 'Exemple de jeu de cartes (copie)' });
    if (!copy.ok) return;
    expect(copy.id.startsWith('custom-')).toBe(true);
    expect(services.cardGames.list().map((r) => r.id)).toEqual([copy.id]);

    // Le paquet d'origine reste installé, sous son identifiant de jeu, avec sa version.
    expect(services.packages.get('exemple-cartes')).toMatchObject({
      status: 'actif',
      gameId: 'pkg-exemple-cartes',
      version: '1.0.0',
    });
  });

  it('copie un jeu de questions dans l’éditeur de questions médias', () => {
    expect(services.packages.install(packExample('exemple-quiz'))).toMatchObject({ ok: true });

    const copy = copyPackageToEditable('exemple-quiz', services);
    expect(copy).toMatchObject({ ok: true, module: 'quiz', name: 'Exemple de questions (copie)' });
    if (!copy.ok) return;
    expect(copy.id.startsWith('media-')).toBe(true);
    const record = services.mediaGames.get(copy.id)!;
    expect(record.definition.items).toHaveLength(3);
  });

  it('refuse la copie d’un paquet inconnu ou désactivé', () => {
    expect(copyPackageToEditable('inconnu', services)).toEqual({ ok: false, error: 'Paquet inconnu.' });

    services.packages.install(packExample('exemple-plateau'));
    services.packages.setEnabled('exemple-plateau', false);
    expect(copyPackageToEditable('exemple-plateau', services)).toEqual({
      ok: false,
      error: 'Le paquet doit être actif pour être copié.',
    });
    expect(services.boardGames.list()).toHaveLength(0);
  });

  it('tronque le nom de la copie pour rester dans la limite de 40 caractères', () => {
    const long = 'x'.repeat(40);
    expect(copyNameOf(long)).toHaveLength(40);
    expect(copyNameOf(long).endsWith(' (copie)')).toBe(true);
    expect(copyNameOf('Court')).toBe('Court (copie)');
  });

  it('garde le lien vers le paquet, la version copiée et l’empreinte du contenu', () => {
    services.packages.install(packExample('exemple-plateau'));
    const copy = copyPackageToEditable('exemple-plateau', services);
    if (!copy.ok) throw new Error('copie refusée');
    expect(services.store.getPackageCopy(copy.id)).toMatchObject({
      packageId: 'exemple-plateau',
      module: 'board',
      copiedVersion: '1.0.0',
    });
    expect(packageCopyStatuses(services)).toMatchObject([
      { gameId: copy.id, modified: false, updateAvailable: false, originMissing: false },
    ]);
  });

  it('signale une copie modifiée, puis une version plus récente du paquet', () => {
    services.packages.install(buildPackage());
    const copy = copyPackageToEditable('exemple-cartes', services);
    if (!copy.ok) throw new Error('copie refusée');
    const record = services.cardGames.list().find((r) => r.id === copy.id)!;
    services.cardGames.save(copy.id, { ...record.definition, description: 'Ma propre description.' });
    expect(packageCopyStatuses(services)[0]).toMatchObject({ modified: true, updateAvailable: false });

    services.packages.install(
      buildPackage({ version: '1.1.0', definition: { ...exampleDefinition(), description: 'Nouvelle version.' } }),
    );
    expect(packageCopyStatuses(services)[0]).toMatchObject({
      copiedVersion: '1.0.0',
      currentVersion: '1.1.0',
      updateAvailable: true,
      modified: true,
    });
  });

  it('refuse de remplacer une copie modifiée sans confirmation, puis la remplace en gardant son nom', () => {
    services.packages.install(buildPackage());
    const copy = copyPackageToEditable('exemple-cartes', services);
    if (!copy.ok) throw new Error('copie refusée');
    const record = services.cardGames.list().find((r) => r.id === copy.id)!;
    services.cardGames.save(copy.id, { ...record.definition, name: 'Mon nom à moi' });
    services.packages.install(
      buildPackage({ version: '1.1.0', definition: { ...exampleDefinition(), description: 'Nouvelle version.' } }),
    );

    const refused = updateCopyFromPackage(copy.id, {}, services);
    expect(refused).toMatchObject({ ok: false, modified: true });

    const done = updateCopyFromPackage(copy.id, { force: true }, services);
    expect(done).toEqual({ ok: true, version: '1.1.0' });
    const after = services.cardGames.list().find((r) => r.id === copy.id)!;
    expect(after.definition).toMatchObject({ name: 'Mon nom à moi', description: 'Nouvelle version.' });
    expect(packageCopyStatuses(services)[0]).toMatchObject({
      copiedVersion: '1.1.0',
      modified: false,
      updateAvailable: false,
    });
  });

  it('met à jour une copie non modifiée sans confirmation', () => {
    services.packages.install(buildPackage());
    const copy = copyPackageToEditable('exemple-cartes', services);
    if (!copy.ok) throw new Error('copie refusée');
    services.packages.install(
      buildPackage({ version: '1.1.0', definition: { ...exampleDefinition(), description: 'Nouvelle version.' } }),
    );
    expect(updateCopyFromPackage(copy.id, {}, services)).toEqual({ ok: true, version: '1.1.0' });
  });

  it('signale un paquet d’origine supprimé, sans effacer la copie', () => {
    services.packages.install(buildPackage());
    const copy = copyPackageToEditable('exemple-cartes', services);
    if (!copy.ok) throw new Error('copie refusée');
    services.packages.remove('exemple-cartes');
    expect(packageCopyStatuses(services)[0]).toMatchObject({ originMissing: true, currentVersion: null });
    expect(updateCopyFromPackage(copy.id, { force: true }, services)).toMatchObject({ ok: false });
    expect(services.cardGames.list().map((r) => r.id)).toEqual([copy.id]);
  });

  it('supprimer la copie efface son lien', () => {
    services.packages.install(buildPackage());
    const copy = copyPackageToEditable('exemple-cartes', services);
    if (!copy.ok) throw new Error('copie refusée');
    services.cardGames.remove(copy.id);
    expect(services.store.getPackageCopy(copy.id)).toBeUndefined();
    expect(packageCopyStatuses(services)).toEqual([]);
  });
});
