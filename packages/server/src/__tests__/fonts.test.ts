import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cardGameDefinitionSchema } from '@partyhub/shared';
import { Store } from '../db/store.js';
import { CardGameService } from '../cards/service.js';
import { sniffMedia, ASSET_LIMIT_BYTES } from '../assets/service.js';
import { loadConfig } from '../config.js';
import { PackageValidationError, validatePackage } from '../packages/format.js';
import { buildPackage, exampleDefinition } from './helpers/package-kit.js';

const FONT_ID = 'c'.repeat(32);
const IMAGE_ID = 'd'.repeat(32);
let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-polices-'));
  store = new Store(path.join(dir, 'partyhub.db'));
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const body = (head: number[] | string) =>
  Buffer.concat([Buffer.from(typeof head === 'string' ? head : Buffer.from(head)), Buffer.alloc(64)]);

describe('détection des polices', () => {
  it('reconnaît WOFF2, WOFF, OpenType et TrueType à partir de leur contenu', () => {
    expect(sniffMedia(body('wOF2'))).toEqual({ kind: 'font', mime: 'font/woff2' });
    expect(sniffMedia(body('wOFF'))).toEqual({ kind: 'font', mime: 'font/woff' });
    expect(sniffMedia(body('OTTO'))).toEqual({ kind: 'font', mime: 'font/otf' });
    expect(sniffMedia(body([0x00, 0x01, 0x00, 0x00]))).toEqual({ kind: 'font', mime: 'font/ttf' });
  });

  it('refuse un texte renommé en police', () => {
    expect(sniffMedia(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
  });

  it('applique une limite de taille propre aux polices, configurable', () => {
    expect(ASSET_LIMIT_BYTES.font).toBe(2 * 1024 * 1024);
    const MB = 1024 * 1024;
    expect(loadConfig({ DATA_DIR: dir }).assetLimits?.font).toBe(2 * MB);
    expect(loadConfig({ DATA_DIR: dir, ASSET_MAX_FONT_MB: '4' }).assetLimits?.font).toBe(4 * MB);
    expect(() => loadConfig({ DATA_DIR: dir, ASSET_MAX_FONT_MB: '99' })).toThrow(/ASSET_MAX_FONT_MB/);
  });
});

describe('police des cartes', () => {
  it('accepte un identifiant de police et refuse un identifiant incorrect', () => {
    expect(cardGameDefinitionSchema.safeParse({ ...exampleDefinition(), fontAssetId: FONT_ID }).success).toBe(true);
    expect(cardGameDefinitionSchema.safeParse({ ...exampleDefinition(), fontAssetId: 'police' }).success).toBe(false);
  });

  it('refuse une police absente ou un fichier qui n’est pas une police', () => {
    const service = new CardGameService(store);
    expect(service.save(null, { ...exampleDefinition(), fontAssetId: FONT_ID })).toMatchObject({ ok: false });
    store.saveAsset({
      id: IMAGE_ID,
      kind: 'image',
      mime: 'image/png',
      name: 'x.png',
      size: 10,
      created_at: new Date().toISOString(),
    });
    expect(service.save(null, { ...exampleDefinition(), fontAssetId: IMAGE_ID })).toMatchObject({ ok: false });
  });

  it('accepte une police de la médiathèque et signale le jeu dans les usages', () => {
    store.saveAsset({
      id: FONT_ID,
      kind: 'font',
      mime: 'font/woff2',
      name: 'titre.woff2',
      size: 70,
      created_at: new Date().toISOString(),
    });
    const service = new CardGameService(store);
    const saved = service.save(null, { ...exampleDefinition(), fontAssetId: FONT_ID });
    expect(saved.ok).toBe(true);
    expect(service.usersOfAsset(FONT_ID)).toEqual([`${exampleDefinition().name} (cartes)`]);
    expect(service.usersOfAsset(IMAGE_ID)).toEqual([]);
  });

  it('une police ne peut pas être utilisée dans un paquet .phgame', () => {
    const bytes = buildPackage({ definition: { ...exampleDefinition(), fontAssetId: FONT_ID } });
    expect(() => validatePackage(bytes)).toThrow(PackageValidationError);
  });
});
