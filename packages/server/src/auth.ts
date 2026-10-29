import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';

const scryptAsync = promisify(scryptCb) as unknown as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

/** Hachage scrypt au format « scrypt$sel$clé » (sel et clé en base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return ['scrypt', salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Sessions d’administration, stockées dans la table `admin_sessions`. Elles survivent à un
 * redémarrage du serveur, et plusieurs processus qui partagent la même base les voient.
 * Seule l’empreinte du jeton est enregistrée.
 */
export class AdminSessions {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = SESSION_TTL_MS,
  ) {}

  create(): string {
    this.prune();
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)')
      .run(hashSessionToken(token), this.now() + this.ttlMs);
    return token;
  }

  valid(token: string | undefined): boolean {
    if (!token) return false;
    const hash = hashSessionToken(token);
    const row = this.db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?').get(hash) as
      { expires_at: number } | undefined;
    if (!row) return false;
    if (row.expires_at < this.now()) {
      this.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hash);
      return false;
    }
    return true;
  }

  revoke(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashSessionToken(token));
  }

  /** Nombre de sessions encore enregistrées (y compris expirées non nettoyées). */
  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM admin_sessions').get() as { n: number }).n;
  }

  private prune(): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(this.now());
  }
}

/** Limitation des tentatives de connexion par adresse IP. */
export class LoginLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  /**
   * `max` tentatives par fenêtre et par clé (ici : adresse IP). Plusieurs joueurs
   * d’un même réseau partagent une adresse : les limites pour les comptes sont donc plus larges.
   */
  constructor(
    private readonly max = LOGIN_MAX_ATTEMPTS,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  allow(key: string): boolean {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt < Date.now()) return true;
    return entry.count < this.max;
  }

  fail(key: string): void {
    this.hit(key);
  }

  /** Compte une tentative, réussie ou non. */
  hit(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt < now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

/**
 * Compare deux secrets (jetons) en temps constant. Les deux valeurs passent par SHA-256 pour avoir
 * une longueur égale, puis `timingSafeEqual` : le temps de réponse ne révèle pas le préfixe commun.
 */
export function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        // Cookie mal encodé (« %E0%A4%A »…) : on l’ignore au lieu de lever une erreur 500.
        return undefined;
      }
    }
  }
  return undefined;
}
