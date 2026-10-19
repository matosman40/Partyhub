import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCodePackage, newCodeGame } from '../code-games/build.js';
import { readZip } from '../packages/zip.js';

/** Le bundle de vues (code/client.js) tel qu'il est écrit dans le paquet. */
function viewBundle(bytes: Uint8Array): string {
  const limits = {
    maxEntries: 100,
    maxEntryBytes: 64 << 20,
    maxTotalBytes: 256 << 20,
    maxRatio: 1000,
    ratioCheckBytes: 1 << 30,
  };
  const entry = readZip(bytes, limits, () => {}).find((e) => e.name === 'code/client.js');
  return Buffer.from(entry!.data).toString('utf8');
}

let work: string;

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-styles-'));
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

function gameDir(id: string): string {
  const dir = path.join(work, id);
  newCodeGame(dir, { id, name: 'Essai styles', author: 'Test' });
  return dir;
}

describe('feuille de style des vues de jeu de code', () => {
  it('sans styles/app.css, la vue ne crée aucune balise de style', async () => {
    const { bytes } = await buildCodePackage(gameDir('styles-aucun'));
    expect(viewBundle(bytes)).not.toContain('appStyle');
  });

  it('embarque la feuille et ses polices en data:, sans copier les polices dans le paquet', async () => {
    const dir = gameDir('styles-polices');
    fs.mkdirSync(path.join(dir, 'styles', 'fonts'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'styles', 'app.css'),
      ".titre { font-family: 'Fredoka'; src: url('/fonts/fredoka-test.woff2') format('woff2'); }\n.bouton { color: red; }\n",
    );
    fs.writeFileSync(path.join(dir, 'styles', 'fonts', 'fredoka-test.woff2'), Buffer.from('POLICE'));

    const { bytes, manifest } = await buildCodePackage(dir);
    const view = viewBundle(bytes);
    expect(view).toContain('appStyle');
    expect(view).toContain('.bouton { color: red; }');
    expect(view).toContain(`data:font/woff2;base64,${Buffer.from('POLICE').toString('base64')}`);
    expect(view).not.toContain('/fonts/fredoka-test.woff2');
    expect(manifest.files.some((f) => f.path.startsWith('styles/'))).toBe(false);
  });

  it('refuse une police citée par la feuille et absente du dossier du jeu', async () => {
    const dir = gameDir('styles-absente');
    fs.mkdirSync(path.join(dir, 'styles'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'styles', 'app.css'), ".titre { src: url('/fonts/absente.woff2'); }\n");

    await expect(buildCodePackage(dir)).rejects.toMatchObject({ issues: [expect.stringContaining('absente.woff2')] });
  });
});
