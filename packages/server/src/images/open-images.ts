import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_IMAGE_BYTES, sniffImage, type ImageMime } from './providers.js';

/**
 * Relais d’images ouvertes : les jeux tirent des photos en direct (Wikimedia Commons, Met Museum, iNaturalist),
 * mais la politique de sécurité n’autorise que les images du serveur. Le serveur télécharge donc l’image une fois,
 * la garde sur disque, puis la sert à tous les écrans sous `/api/images-ouvertes?u=<adresse>`.
 *
 * Garde-fous : HTTPS seulement, liste fermée de domaines, pas de redirection suivie, 3 Mo au plus, format d’image
 * vérifié aux premiers octets, délai par téléchargement, plafond de téléchargements par minute, cache plafonné.
 */

/** Domaines autorisés : uniquement des banques d’images sous licence libre. */
export const OPEN_IMAGE_HOSTS: ReadonlySet<string> = new Set([
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
  'images.metmuseum.org',
  'inaturalist-open-data.s3.amazonaws.com',
  'static.inaturalist.org',
]);

/** Adresse distante acceptée, ou null. Fonction pure. */
export function checkOpenImageUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 600) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return null;
  if (!OPEN_IMAGE_HOSTS.has(url.hostname)) return null;
  return url;
}

export interface OpenImage {
  bytes: Buffer;
  mime: ImageMime;
}

export interface OpenImageCacheOptions {
  dir: string;
  /** Nombre de fichiers gardés ; au-delà, les plus anciens partent. */
  maxFiles?: number;
  /** Téléchargements distants admis par minute (les images déjà gardées ne comptent pas). */
  maxFetchPerMinute?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const EXT: Record<ImageMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export class OpenImageCache {
  private readonly dir: string;
  private readonly maxFiles: number;
  private readonly maxFetchPerMinute: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly pending = new Map<string, Promise<OpenImage | null>>();
  private fetchTimes: number[] = [];

  constructor(options: OpenImageCacheOptions) {
    this.dir = options.dir;
    this.maxFiles = options.maxFiles ?? 600;
    this.maxFetchPerMinute = options.maxFetchPerMinute ?? 120;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private key(url: URL): string {
    return createHash('sha256').update(url.href).digest('hex').slice(0, 40);
  }

  private findCached(key: string): OpenImage | null {
    for (const [mime, ext] of Object.entries(EXT) as [ImageMime, string][]) {
      const file = path.join(this.dir, `${key}.${ext}`);
      if (existsSync(file)) return { bytes: readFileSync(file), mime };
    }
    return null;
  }

  /** Image gardée ou téléchargée ; null si l’adresse est refusée, ou si le téléchargement échoue. */
  get(raw: unknown): Promise<OpenImage | null> {
    const url = checkOpenImageUrl(raw);
    if (!url) return Promise.resolve(null);
    const key = this.key(url);
    const cached = this.findCached(key);
    if (cached) return Promise.resolve(cached);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const job = this.download(url, key).finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }

  private allowFetch(): boolean {
    const t = this.now();
    this.fetchTimes = this.fetchTimes.filter((x) => t - x < 60_000);
    if (this.fetchTimes.length >= this.maxFetchPerMinute) return false;
    this.fetchTimes.push(t);
    return true;
  }

  private async download(url: URL, key: string): Promise<OpenImage | null> {
    if (!this.allowFetch()) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url.href, {
        redirect: 'error',
        signal: controller.signal,
        headers: { 'User-Agent': 'PartyHub/1.0 (jeu de soirée auto-hébergé)', Accept: 'image/*' },
      });
      if (!res.ok || !res.body) return null;
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > MAX_IMAGE_BYTES) return null;
      const chunks: Buffer[] = [];
      let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      const mime = sniffImage(bytes);
      if (!mime) return null;
      this.store(key, bytes, mime);
      return { bytes, mime };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private store(key: string, bytes: Buffer, mime: ImageMime): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(path.join(this.dir, `${key}.${EXT[mime]}`), bytes);
      this.evict();
    } catch {
      /* disque plein ou en lecture seule : l’image est servie sans être gardée */
    }
  }

  private evict(): void {
    const files = readdirSync(this.dir).map((name) => {
      const file = path.join(this.dir, name);
      return { file, at: statSync(file).mtimeMs };
    });
    if (files.length <= this.maxFiles) return;
    files.sort((a, b) => a.at - b.at);
    for (const { file } of files.slice(0, files.length - this.maxFiles)) unlinkSync(file);
  }
}
