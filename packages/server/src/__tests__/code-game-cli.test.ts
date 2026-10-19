import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCode, keygen, newCodeGame, packCode } from '../cli/code-game.js';
import { PackageValidationError } from '../packages/format.js';

/**
 * Parcours complet d'un auteur : création depuis le modèle, clés, construction (esbuild),
 * signature, puis contrôle avec une partie jouée par des robots. Aucun réseau.
 */
describe('jeu de code : création, construction, signature et contrôle', () => {
  let dir: string;
  let game: string;
  let keys: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phgame-code-'));
    game = path.join(dir, 'pile-ou-face-essai');
    keys = path.join(dir, 'cle-essai');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('crée un jeu depuis le modèle', () => {
    const written = newCodeGame(game, { id: 'pile-essai', name: 'Pile essai', author: 'Test' });
    expect(written).toEqual(expect.arrayContaining(['manifest.json', 'src/server.ts', 'src/client.tsx']));
    const manifest = JSON.parse(fs.readFileSync(path.join(game, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest.id).toBe('pile-essai');
    expect(manifest.kind).toBe('code');
    expect(fs.readFileSync(path.join(game, 'src', 'server.ts'), 'utf8')).toContain("id: 'pile-essai'");
  });

  it('refuse de créer dans un dossier non vide, et refuse un nom à guillemets', () => {
    expect(() => newCodeGame(game, { id: 'autre-essai', name: 'Autre', author: 'Test' })).toThrow('n’est pas vide');
    expect(() => newCodeGame(path.join(dir, 'neuf'), { id: 'bon-id', name: "Nom'piégé", author: 'Test' })).toThrow(
      'sans guillemets',
    );
  });

  it('crée une paire de clés, sans jamais écraser une paire existante', () => {
    const keyId = keygen(keys);
    expect(keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(fs.existsSync(`${keys}.key.pem`)).toBe(true);
    expect(fs.existsSync(`${keys}.pub.pem`)).toBe(true);
    expect(() => keygen(keys)).toThrow('existent déjà');
  });

  it('construit et signe le jeu, puis le contrôle passe avec la bonne clé', async () => {
    const output = path.join(dir, 'pile-essai.phgame');
    const built = await packCode(game, output, `${keys}.key.pem`);
    expect(built.signature?.alg).toBe('ed25519');
    expect(built.files.map((f) => f.path)).toEqual(expect.arrayContaining(['code/server.js', 'code/client.js']));

    const report = await checkCode(output, `${keys}.pub.pem`);
    expect(report.ok).toBe(true);
    expect(report.lines.join('\n')).toContain('signé par la clé');
    expect(report.lines.join('\n')).toContain('2 parties jouées par des robots');
  }, 60_000);

  it('un paquet non signé se contrôle sans clé, mais le contrôle le signale', async () => {
    const output = path.join(dir, 'pile-essai-nu.phgame');
    await packCode(game, output);
    const report = await checkCode(output);
    expect(report.ok).toBe(true);
    expect(report.lines.join('\n')).toContain('non signé');
  }, 60_000);

  it('refuse le contrôle si la clé publique ne correspond pas à la signature', async () => {
    const output = path.join(dir, 'pile-essai.phgame');
    const other = path.join(dir, 'autre');
    keygen(other);
    await expect(checkCode(output, `${other}.pub.pem`)).rejects.toThrow(PackageValidationError);
  }, 60_000);
});
