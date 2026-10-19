import { createPrivateKey, createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateSigningKeys, keyIdOf } from '../packages/code-format.js';
import { TRUST_DIR_NAME } from './service.js';

/**
 * Clé de signature de cette installation : elle signe les jeux de code créés dans l'éditeur.
 * La clé privée reste dans DATA_DIR/cles-de-signature, en lecture seule pour le serveur. Elle n'est jamais
 * renvoyée par l'API : seule la clé publique sort, et elle rejoint les clés de confiance.
 */

export const SIGNING_DIR_NAME = 'cles-de-signature';
const PRIVATE_SUFFIX = '.key.pem';

export interface SigningKeyInfo {
  keyId: string;
  /** Clé publique (PEM). La clé privée n'est jamais exposée. */
  publicPem: string;
}

function signingDir(dataDir: string): string {
  return path.join(dataDir, SIGNING_DIR_NAME);
}

/** Fichier de la clé de signature. Une seule clé par installation. Null si elle n'existe pas encore. */
function keyFile(dataDir: string): string | null {
  const dir = signingDir(dataDir);
  if (!fs.existsSync(dir)) return null;
  const name = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(PRIVATE_SUFFIX))
    .sort()[0];
  return name ? path.join(dir, name) : null;
}

/** Identifiant et clé publique de la clé de signature, sans la clé privée. Null si aucune clé n'existe. */
export function signingKeyInfo(dataDir: string): SigningKeyInfo | null {
  const file = keyFile(dataDir);
  if (!file) return null;
  const publicKey = createPublicKey(createPrivateKey(fs.readFileSync(file, 'utf8')));
  return {
    keyId: keyIdOf(publicKey),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/**
 * Clé privée pour signer un paquet. Usage interne seulement : ne doit jamais être renvoyée par une route.
 * Null si aucune clé n'existe.
 */
export function loadSigningPrivatePem(dataDir: string): string | null {
  const file = keyFile(dataDir);
  return file ? fs.readFileSync(file, 'utf8') : null;
}

/**
 * Crée la clé de signature de l'installation. Refusée si elle existe déjà : la remplacer ferait refuser
 * tous les jeux déjà signés. La clé publique est ajoutée aux clés de confiance.
 */
export function createSigningKey(dataDir: string): SigningKeyInfo {
  if (keyFile(dataDir)) throw new Error('Une clé de signature existe déjà pour cette installation.');
  const keys = generateSigningKeys();
  const dir = signingDir(dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, `${keys.keyId}${PRIVATE_SUFFIX}`), keys.privatePem, { mode: 0o600, flag: 'wx' });

  const trustDir = path.join(dataDir, TRUST_DIR_NAME);
  fs.mkdirSync(trustDir, { recursive: true });
  fs.writeFileSync(path.join(trustDir, `${keys.keyId}.pub.pem`), keys.publicPem);
  return { keyId: keys.keyId, publicPem: keys.publicPem };
}
