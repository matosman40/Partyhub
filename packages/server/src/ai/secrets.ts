import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement des clés d’API saisies dans l’administration. AES-256-GCM avec une clé locale, tirée au hasard
 * au premier usage et gardée à côté de la base (mode 0600). Cela protège une copie de la base prise seule
 * (sauvegarde, export) ; cela ne protège pas contre quelqu’un qui lit tout le dossier de données.
 * Sans ce fichier, les clés chiffrées sont illisibles : l’administration demande de les ressaisir.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class SecretBox {
  private key: Buffer | null | undefined;

  constructor(private readonly keyFile: string) {}

  /** Chiffre une valeur. Crée la clé locale si elle n’existe pas encore. */
  seal(plain: string): string {
    const key = this.keyOrCreate();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
  }

  /** Déchiffre une valeur. Renvoie null si elle est abîmée, d’une autre clé ou sans clé locale. */
  open(sealed: string): string | null {
    const key = this.existingKey();
    if (!key) return null;
    const parts = sealed.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    try {
      const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  private existingKey(): Buffer | null {
    if (this.key !== undefined) return this.key;
    this.key = null;
    if (existsSync(this.keyFile)) {
      const raw = Buffer.from(readFileSync(this.keyFile, 'utf8').trim(), 'base64');
      if (raw.length === KEY_BYTES) this.key = raw;
    }
    return this.key;
  }

  private keyOrCreate(): Buffer {
    const existing = this.existingKey();
    if (existing) return existing;
    const key = randomBytes(KEY_BYTES);
    writeFileSync(this.keyFile, key.toString('base64'), { mode: 0o600 });
    chmodSync(this.keyFile, 0o600);
    this.key = key;
    return key;
  }
}
