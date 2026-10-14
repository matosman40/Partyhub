import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

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

/** Sessions d'administration en mémoire (un redémarrage oblige à se reconnecter). */
export class AdminSessions {
  private readonly sessions = new Map<string, number>();

  create(): string {
    this.prune();
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
  }

  valid(token: string | undefined): boolean {
    if (!token) return false;
    const expiresAt = this.sessions.get(token);
    if (expiresAt === undefined) return false;
    if (expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, expiresAt] of this.sessions) {
      if (expiresAt < now) this.sessions.delete(token);
    }
  }
}

/** Limitation des tentatives de connexion par adresse IP. */
export class LoginLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  /**
   * `max` tentatives par fenêtre et par clé (ici : adresse IP). Plusieurs joueurs
   * d'un même réseau partagent une adresse : les limites pour les comptes sont donc plus larges.
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

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}
