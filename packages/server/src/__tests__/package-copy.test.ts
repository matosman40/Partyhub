import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../db/store.js';
import { PackageService } from '../packages/service.js';
import { copyNameOf, copyPackageToEditable, type CopyServices } from '../packages/copy.js';
import { CardGameService } from '../cards/service.js';
import { BoardGameService } from '../boards/service.js';
import { MediaQuizService } from '../media/service.js';
import type { AssetService } from '../assets/service.js';
import { buildPackage, packExample } from './helpers/package-kit.js';

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
    expect(services.packages.get('exemple-cartes')).toMatchObject({ status: 'actif', gameId: 'pkg-exemple-cartes', version: '1.0.0' });
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
});
