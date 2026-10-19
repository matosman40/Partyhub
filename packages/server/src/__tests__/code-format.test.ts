import { createHash, createPublicKey, createPrivateKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CODE_ENTRY_CLIENT,
  CODE_ENTRY_SERVER,
  generateSigningKeys,
  keyIdOf,
  signManifest,
  validateCodePackage,
} from '../packages/code-format.js';
import { CODE_NOT_INSTALLABLE, PackageValidationError, validatePackage } from '../packages/format.js';
import { writeZip, type ZipFileEntry } from '../packages/zip.js';
import { isCodePackage } from '../cli/code-game.js';

const enc = (text: string) => Buffer.from(text, 'utf8');
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

const SERVER = 'export default { manifest: {} };\n';
const CLIENT = 'export default { Host: () => null };\n';
const LICENCE = 'Licence de test.\n';

/** Construit un paquet de code. Les options permettent de le casser de façon ciblée. */
function buildCode(options: {
  key?: ReturnType<typeof generateSigningKeys>;
  tamperAfterSign?: (manifest: Record<string, unknown>) => void;
  serverCode?: string;
  extra?: ZipFileEntry[];
}): Uint8Array {
  const entries: ZipFileEntry[] = [
    { name: CODE_ENTRY_SERVER, data: enc(options.serverCode ?? SERVER) },
    { name: CODE_ENTRY_CLIENT, data: enc(CLIENT) },
    { name: 'licenses/LICENCE.txt', data: enc(LICENCE) },
  ];
  const unsigned: Record<string, unknown> = {
    format: 'phgame',
    formatVersion: 5,
    kind: 'code',
    id: 'essai-jeu',
    name: 'Essai',
    version: '1.0.0',
    description: 'Un jeu de test.',
    author: 'Test',
    engine: { minVersion: '0.15.0', api: 1 },
    entry: { server: CODE_ENTRY_SERVER, client: CODE_ENTRY_CLIENT },
    licenses: [{ path: 'licenses/LICENCE.txt', covers: [] }],
    files: entries.map((e) => ({ path: e.name, size: e.data.byteLength, sha256: sha(e.data) })),
  };
  const manifest: Record<string, unknown> = options.key
    ? { ...unsigned, signature: signManifest(unsigned, createPrivateKey(options.key.privatePem)) }
    : unsigned;
  options.tamperAfterSign?.(manifest);
  // Les fichiers supplémentaires entrent dans l'archive sans être déclarés dans le manifeste.
  return writeZip([
    { name: 'manifest.json', data: enc(JSON.stringify(manifest, null, 2)) },
    ...entries,
    ...(options.extra ?? []),
  ]);
}

function trustOf(key: ReturnType<typeof generateSigningKeys>) {
  const pub = createPublicKey(key.publicPem);
  return new Map([[keyIdOf(pub), pub]]);
}

function issuesFor(bytes: Uint8Array, options: Parameters<typeof validateCodePackage>[1] = {}): string[] {
  try {
    validateCodePackage(bytes, options);
    return [];
  } catch (err) {
    if (err instanceof PackageValidationError) return err.issues;
    throw err;
  }
}

describe('format 5 : jeu de code signé', () => {
  it('accepte un paquet signé par une clé de confiance', () => {
    const key = generateSigningKeys();
    const pkg = validateCodePackage(buildCode({ key }), { trustedKeys: trustOf(key), requireSignature: true });
    expect(pkg.signer).toBe(key.keyId);
    expect(pkg.manifest.id).toBe('essai-jeu');
  });

  it('accepte un paquet non signé quand la signature n’est pas exigée (contrôle de structure)', () => {
    const pkg = validateCodePackage(buildCode({}));
    expect(pkg.signer).toBeNull();
  });

  it('refuse un paquet non signé quand la signature est exigée', () => {
    expect(issuesFor(buildCode({}), { requireSignature: true })).toContain('Paquet non signé.');
  });

  it('une signature non vérifiable est signalée sans être refusée, si on le demande', () => {
    const key = generateSigningKeys();
    const pkg = validateCodePackage(buildCode({ key }), { allowUnverifiedSignature: true });
    expect(pkg.signer).toBeNull();
    expect(pkg.claimedKeyId).toBe(key.keyId);
  });

  it('refuse un paquet signé par une clé inconnue', () => {
    const key = generateSigningKeys();
    const other = generateSigningKeys();
    const issues = issuesFor(buildCode({ key }), { trustedKeys: trustOf(other), requireSignature: true });
    expect(issues.join(' ')).toContain('clé inconnue');
  });

  it('refuse un manifeste modifié après signature', () => {
    const key = generateSigningKeys();
    const bytes = buildCode({
      key,
      tamperAfterSign: (m) => {
        m.name = 'Autre nom';
      },
    });
    const issues = issuesFor(bytes, { trustedKeys: trustOf(key), requireSignature: true });
    expect(issues.join(' ')).toContain('Signature invalide');
  });

  it('refuse un fichier de code modifié (empreinte incorrecte)', () => {
    const key = generateSigningKeys();
    const bytes = buildCode({ key });
    // Un paquet dont le code diffère de l'empreinte signée : on reconstruit l'archive avec un autre serveur,
    // mais en gardant le manifeste signé d'origine.
    const original = validateCodePackage(bytes, { trustedKeys: trustOf(key), requireSignature: true });
    const manifestBytes = original.files.get('manifest.json')!;
    const tampered = writeZip([
      { name: 'manifest.json', data: manifestBytes },
      { name: CODE_ENTRY_SERVER, data: enc('// modifié\n' + SERVER) },
      { name: CODE_ENTRY_CLIENT, data: enc(CLIENT) },
      { name: 'licenses/LICENCE.txt', data: enc(LICENCE) },
    ]);
    const issues = issuesFor(tampered, { trustedKeys: trustOf(key), requireSignature: true });
    expect(issues.join(' ')).toContain('empreinte SHA-256 incorrecte');
  });

  it('refuse un fichier qui n’est pas déclaré dans le manifeste', () => {
    const key = generateSigningKeys();
    const bytes = buildCode({ key, extra: [{ name: 'code/extra.js', data: enc('export {};') }] });
    expect(issuesFor(bytes, { trustedKeys: trustOf(key), requireSignature: true }).join(' ')).toContain(
      'sans être déclaré',
    );
  });

  it('refuse un dossier interdit dans le paquet de code (src/)', () => {
    const key = generateSigningKeys();
    const bytes = buildCode({ key, extra: [{ name: 'src/server.ts', data: enc('export {};') }] });
    expect(() => validateCodePackage(bytes, { trustedKeys: trustOf(key), requireSignature: true })).toThrow(
      PackageValidationError,
    );
  });

  it('refuse un code vide', () => {
    const issues = issuesFor(buildCode({ serverCode: '' }));
    expect(issues.join(' ')).toContain('est vide');
  });

  it('reconnaît un paquet de code et ne le laisse pas entrer par la voie d’installation', () => {
    const bytes = buildCode({});
    expect(isCodePackage(bytes)).toBe(true);
    let message = '';
    try {
      validatePackage(bytes);
    } catch (err) {
      message = err instanceof PackageValidationError ? err.issues.join(' ') : String(err);
    }
    expect(message).toBe(CODE_NOT_INSTALLABLE);
  });

  it('l’identifiant de clé se calcule à l’identique depuis la clé publique', () => {
    const key = generateSigningKeys();
    expect(keyIdOf(createPublicKey(key.publicPem))).toBe(key.keyId);
    expect(key.keyId).toMatch(/^[0-9a-f]{16}$/);
  });
});
