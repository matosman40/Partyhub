import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetService, ASSET_LIMIT_BYTES, type AssetKind } from '../assets/service.js';
import { Store } from '../db/store.js';

/**
 * Envoi de médiathèque en flux : les octets vont sur le disque au fil de la lecture, la taille
 * est contrôlée pendant l'envoi, et rien ne reste dans le dossier en cas d'échec.
 */

function wav(totalBytes: number): Buffer {
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(totalBytes - 8, 4);
  header.write('WAVE', 8, 'latin1');
  return Buffer.concat([header, Buffer.alloc(totalBytes - 12, 7)]);
}

/** Découpe les octets en morceaux, comme un réseau réel. */
function inChunks(data: Buffer, size = 1000): Readable {
  const pieces: Buffer[] = [];
  for (let i = 0; i < data.length; i += size) pieces.push(data.subarray(i, i + size));
  return Readable.from(pieces);
}

let root: string;
let dataDir: string;
let store: Store;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ph-assets-stream-'));
  dataDir = path.join(root, 'data');
  store = new Store(':memory:');
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

function assetsDir(): string {
  return path.join(dataDir, 'assets');
}

describe('Réception en flux', () => {
  it('enregistre un WAV reçu en morceaux, avec ses octets intacts', async () => {
    const service = new AssetService(store, dataDir);
    const data = wav(50_000);
    const result = await service.receive(inChunks(data), 'chanson.wav');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset).toMatchObject({ kind: 'audio', mime: 'audio/wav', name: 'chanson.wav', size: data.length });
    expect(readFileSync(service.filePath(result.asset.id))).toEqual(data);
    expect(readdirSync(assetsDir()).filter((n) => n.startsWith('.upload-'))).toEqual([]);
  });

  it('refuse un contenu qui n’est pas un média, sans rien laisser sur le disque', async () => {
    const service = new AssetService(store, dataDir);
    const result = await service.receive(inChunks(Buffer.from('<html>pas un son</html>')), 'page.html');
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(readdirSync(assetsDir())).toEqual([]);
    expect(service.list()).toEqual([]);
  });

  it('refuse un fichier vide', async () => {
    const service = new AssetService(store, dataDir);
    const result = await service.receive(Readable.from([]), 'vide.wav');
    expect(result).toEqual({ ok: false, status: 400, error: 'Fichier vide.' });
  });

  it('applique la taille maximale du format pendant la lecture, et cesse de lire l’envoi', async () => {
    const limits: Record<AssetKind, number> = { audio: 5_000, video: 5_000, image: 5_000 };
    const service = new AssetService(store, dataDir, limits);
    const chunk = Buffer.alloc(1000, 1);
    let pulled = 0;
    // Un envoi de 1 000 morceaux de 1 000 octets : bien plus que la limite.
    const endless = new Readable({
      read() {
        pulled++;
        this.push(pulled === 1 ? wav(1000) : chunk);
        if (pulled >= 1000) this.push(null);
      },
    });

    const result = await service.receive(endless, 'trop-long.wav');
    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(pulled).toBeLessThan(100);
    expect(readdirSync(assetsDir())).toEqual([]);
  });

  it('refuse tout de suite un envoi qui annonce plus que la taille maximale, sans le lire', async () => {
    const service = new AssetService(store, dataDir);
    const input = inChunks(wav(1000));
    const result = await service.receive(input, 'gros.mp4', service.maxBytes + 1);
    expect(result).toMatchObject({ ok: false, status: 413 });
    expect(input.readableFlowing).toBeNull();
  });

  it('nettoie le fichier temporaire si l’envoi est coupé en cours de route', async () => {
    const service = new AssetService(store, dataDir);
    const input = new Readable({ read() {} });
    const pending = service.receive(input, 'coupe.wav');
    input.push(wav(40_000).subarray(0, 20_000));
    await new Promise((resolve) => setTimeout(resolve, 20));
    input.destroy(new Error('connexion perdue'));

    const result = await pending;
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(readdirSync(assetsDir())).toEqual([]);
  });

  it('traite plusieurs envois en même temps sans les mélanger', async () => {
    const service = new AssetService(store, dataDir);
    const a = wav(30_000);
    const b = wav(20_000);
    const [ra, rb] = await Promise.all([
      service.receive(inChunks(a, 700), 'a.wav'),
      service.receive(inChunks(b, 900), 'b.wav'),
    ]);
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect(ra.asset.id).not.toBe(rb.asset.id);
    expect(readFileSync(service.filePath(ra.asset.id))).toEqual(a);
    expect(readFileSync(service.filePath(rb.asset.id))).toEqual(b);
  });

  it('garde les limites par défaut de chaque format', () => {
    expect(ASSET_LIMIT_BYTES).toEqual({
      audio: 15 * 1024 * 1024,
      video: 80 * 1024 * 1024,
      image: 5 * 1024 * 1024,
    });
    expect(new AssetService(store, dataDir).maxBytes).toBe(80 * 1024 * 1024);
  });
});

describe('Démarrage', () => {
  it('supprime les fichiers temporaires laissés par un arrêt brutal', () => {
    const dir = path.join(dataDir, 'assets');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.upload-restant'), 'morceau');
    writeFileSync(path.join(dir, 'fichier-valide'), 'à garder');

    new AssetService(store, dataDir);
    expect(readdirSync(dir).sort()).toEqual(['fichier-valide']);
  });
});
