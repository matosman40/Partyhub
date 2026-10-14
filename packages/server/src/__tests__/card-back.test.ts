import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cardGameDefinitionSchema } from '@partyhub/shared';
import { Store } from '../db/store.js';
import { CardGameService } from '../cards/service.js';
import { PackageValidationError, validatePackage } from '../packages/format.js';
import { buildPackage, exampleDefinition } from './helpers/package-kit.js';

const IMAGE_ID = 'a'.repeat(32);
const AUDIO_ID = 'b'.repeat(32);
let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-dos-'));
  store = new Store(path.join(dir, 'partyhub.db'));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const withBack = (back: unknown) => ({ ...exampleDefinition(), back });

describe('dos de carte personnalisé : schéma', () => {
  it('accepte une couleur et un texte', () => {
    expect(cardGameDefinitionSchema.safeParse(withBack({ color: '#ff0000', label: 'Mon jeu' })).success).toBe(true);
  });

  it('refuse une couleur invalide, un texte trop long, un identifiant d’image incorrect', () => {
    expect(cardGameDefinitionSchema.safeParse(withBack({ color: 'rouge' })).success).toBe(false);
    expect(cardGameDefinitionSchema.safeParse(withBack({ label: 'x'.repeat(17) })).success).toBe(false);
    expect(cardGameDefinitionSchema.safeParse(withBack({ imageAssetId: 'abc' })).success).toBe(false);
  });

  it('reste facultatif : une définition sans dos est toujours valide', () => {
    expect(cardGameDefinitionSchema.safeParse(exampleDefinition()).success).toBe(true);
  });
});

describe('dos de carte personnalisé : enregistrement', () => {
  it('refuse une image absente de la médiathèque', () => {
    const service = new CardGameService(store);
    const result = service.save(null, withBack({ imageAssetId: IMAGE_ID }));
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/médiathèque/);
  });

  it('refuse un fichier audio utilisé comme dos', () => {
    store.saveAsset({
      id: AUDIO_ID,
      kind: 'audio',
      mime: 'audio/mpeg',
      name: 'son.mp3',
      size: 10,
      created_at: new Date().toISOString(),
    });
    const service = new CardGameService(store);
    expect(service.save(null, withBack({ imageAssetId: AUDIO_ID }))).toMatchObject({ ok: false });
  });

  it('accepte une image de la médiathèque et la retrouve dans la définition', () => {
    store.saveAsset({
      id: IMAGE_ID,
      kind: 'image',
      mime: 'image/png',
      name: 'dos.png',
      size: 24,
      created_at: new Date().toISOString(),
    });
    const service = new CardGameService(store);
    const saved = service.save(null, withBack({ color: '#123456', imageAssetId: IMAGE_ID }));
    expect(saved.ok).toBe(true);
    const record = service.list().find((r) => saved.ok && r.id === saved.id);
    expect(record?.definition.back).toEqual({ color: '#123456', imageAssetId: IMAGE_ID });
  });
});

describe('dos de carte dans un paquet .phgame', () => {
  it('accepte une couleur et un texte', () => {
    expect(() =>
      validatePackage(buildPackage({ definition: withBack({ color: '#123456', label: 'Test' }) })),
    ).not.toThrow();
  });

  it('refuse une référence à la médiathèque', () => {
    const bytes = buildPackage({ definition: withBack({ imageAssetId: IMAGE_ID }) });
    expect(() => validatePackage(bytes)).toThrow(PackageValidationError);
    try {
      validatePackage(bytes);
    } catch (err) {
      expect((err as PackageValidationError).issues.join(' ')).toMatch(/médiathèque/);
    }
  });
});
