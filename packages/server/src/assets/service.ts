import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { Store, AssetRow } from '../db/store.js';

/**
 * Médiathèque : fichiers audio, vidéo et images réutilisables par les jeux.
 * Le type est déduit du contenu réel (signature des octets), jamais du nom du fichier
 * ni de l'en-tête envoyé par le navigateur.
 */

export type AssetKind = 'audio' | 'video' | 'image';

export const ASSET_LIMIT_BYTES: Record<AssetKind, number> = {
  audio: 15 * 1024 * 1024,
  video: 80 * 1024 * 1024,
  image: 5 * 1024 * 1024,
};

export interface SniffedMedia {
  kind: AssetKind;
  mime: string;
}

function startsWith(buf: Buffer, offset: number, text: string): boolean {
  return buf.length >= offset + text.length && buf.toString('latin1', offset, offset + text.length) === text;
}

/**
 * Reconnaît un fichier à partir de ses premiers octets. Renvoie null si le format n'est
 * pas accepté (texte, HTML, exécutable…).
 */
export function sniffMedia(buf: Buffer): SniffedMedia | null {
  if (buf.length < 12) return null;
  // WAV et WebP partagent l'en-tête RIFF : le format est dans les octets 8 à 12.
  if (startsWith(buf, 0, 'RIFF')) {
    if (startsWith(buf, 8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' };
    if (startsWith(buf, 8, 'WEBP')) return { kind: 'image', mime: 'image/webp' };
    return null;
  }
  if (startsWith(buf, 0, 'ID3') || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) {
    return { kind: 'audio', mime: 'audio/mpeg' };
  }
  if (startsWith(buf, 0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (startsWith(buf, 0, 'fLaC')) return { kind: 'audio', mime: 'audio/flac' };
  if (startsWith(buf, 4, 'ftyp')) {
    const brand = buf.toString('latin1', 8, 12);
    // M4A / M4B : son seul. Les autres marques ftyp sont des vidéos MP4.
    if (brand === 'M4A ' || brand === 'M4B ') return { kind: 'audio', mime: 'audio/mp4' };
    return { kind: 'video', mime: 'video/mp4' };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { kind: 'video', mime: 'video/webm' };
  }
  if (buf[0] === 0x89 && startsWith(buf, 1, 'PNG')) return { kind: 'image', mime: 'image/png' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  return null;
}

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  mime: string;
  name: string;
  size: number;
  createdAt: string;
}

function toRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    kind: row.kind as AssetKind,
    mime: row.mime,
    name: row.name,
    size: row.size,
    createdAt: row.created_at,
  };
}

/** Nom affichable : sans chemin, sans caractères de contrôle, 120 caractères au plus. */
export function cleanFileName(raw: string): string {
  const base = path.basename(raw.replace(/\\/g, '/'));
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || 'fichier').slice(0, 120);
}

/** Préfixe des fichiers temporaires : ils ne sont jamais listés et sont nettoyés au démarrage. */
const TEMP_PREFIX = '.upload-';
/** Octets lus avant de reconnaître le format (le plus long des en-têtes utilisés tient en 12). */
const SNIFF_BYTES = 16;
const FORMAT_ERROR = 'Format non accepté. Utilisez MP3, WAV, OGG, M4A, MP4, WebM, PNG, JPEG ou WebP.';
const INTERRUPTED = 'Envoi interrompu avant la fin.';

export type ReceiveResult =
  | { ok: true; asset: AssetRecord }
  | { ok: false; status: 400 | 413 | 500; error: string };

function tooLarge(limit: number): string {
  return `Fichier trop volumineux (maximum ${Math.round(limit / (1024 * 1024))} Mo).`;
}

export class AssetService {
  private readonly dir: string;

  constructor(
    private readonly store: Store,
    dataDir: string,
    private readonly limits: Record<AssetKind, number> = ASSET_LIMIT_BYTES,
  ) {
    this.dir = path.join(dataDir, 'assets');
    mkdirSync(this.dir, { recursive: true });
    // Restes d'un envoi interrompu par un arrêt du serveur.
    for (const name of readdirSync(this.dir)) {
      if (name.startsWith(TEMP_PREFIX)) rmSync(path.join(this.dir, name), { force: true });
    }
  }

  /** Taille maximale acceptée, tous formats confondus. */
  get maxBytes(): number {
    return Math.max(...Object.values(this.limits));
  }

  list(): AssetRecord[] {
    return this.store.listAssets().map(toRecord);
  }

  get(id: string): AssetRecord | undefined {
    const row = this.store.getAsset(id);
    return row ? toRecord(row) : undefined;
  }

  /** Chemin du fichier sur le disque. L'identifiant est vérifié avant tout usage. */
  filePath(id: string): string {
    return path.join(this.dir, id);
  }

  /**
   * Reçoit un fichier en flux : les octets vont directement dans un fichier temporaire, sans
   * être gardés en mémoire. Le format est reconnu sur les premiers octets, puis la taille
   * maximale du format est appliquée pendant la lecture. En cas d'échec, le fichier temporaire
   * est supprimé et la lecture de l'envoi s'arrête.
   */
  receive(input: Readable, originalName: string, declaredBytes?: number): Promise<ReceiveResult> {
    if (declaredBytes !== undefined && declaredBytes > this.maxBytes) {
      return Promise.resolve({ ok: false, status: 413, error: tooLarge(this.maxBytes) });
    }

    const tempPath = path.join(this.dir, `${TEMP_PREFIX}${randomBytes(12).toString('hex')}`);
    const out = createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });

    return new Promise<ReceiveResult>((resolve) => {
      let head: Buffer[] = [];
      let headLength = 0;
      let total = 0;
      let sniffed: SniffedMedia | null = null;
      let limit = 0;
      let ended = false;
      let settled = false;

      const detach = () => {
        input.off('data', onData);
        input.off('end', onEnd);
        input.off('error', onError);
        input.off('close', onClose);
      };

      /** Répond une fois le fichier temporaire fermé et supprimé : rien ne reste sur le disque. */
      const fail = (status: 400 | 413 | 500, error: string) => {
        if (settled) return;
        settled = true;
        detach();
        input.pause();
        const finish = () => {
          rmSync(tempPath, { force: true });
          resolve({ ok: false, status, error });
        };
        if (out.closed) finish();
        else {
          out.once('close', finish);
          out.destroy();
        }
      };

      /** Commence l'écriture une fois le format connu, avec les octets déjà lus. */
      const begin = (bytes: Buffer): boolean => {
        const result = sniffMedia(bytes);
        if (!result) {
          fail(400, FORMAT_ERROR);
          return false;
        }
        sniffed = result;
        limit = this.limits[result.kind];
        if (total > limit) {
          fail(413, tooLarge(limit));
          return false;
        }
        head = [];
        write(bytes);
        return true;
      };

      const write = (chunk: Buffer) => {
        if (!out.write(chunk)) {
          input.pause();
          out.once('drain', () => input.resume());
        }
      };

      const onData = (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (sniffed) {
          if (total > limit) {
            fail(413, tooLarge(limit));
            return;
          }
          write(chunk);
          return;
        }
        head.push(chunk);
        headLength += chunk.length;
        if (headLength >= SNIFF_BYTES) begin(Buffer.concat(head));
      };

      const onEnd = () => {
        if (settled) return;
        ended = true;
        if (total === 0) {
          fail(400, 'Fichier vide.');
          return;
        }
        if (!sniffed && !begin(Buffer.concat(head))) return;
        out.end();
        out.once('close', () => {
          if (settled) return;
          settled = true;
          detach();
          try {
            const id = randomBytes(16).toString('hex');
            renameSync(tempPath, this.filePath(id));
            const row: AssetRow = {
              id,
              kind: sniffed!.kind,
              mime: sniffed!.mime,
              name: cleanFileName(originalName),
              size: total,
              created_at: new Date().toISOString(),
            };
            this.store.saveAsset(row);
            resolve({ ok: true, asset: toRecord(row) });
          } catch {
            rmSync(tempPath, { force: true });
            resolve({ ok: false, status: 500, error: 'Enregistrement impossible.' });
          }
        });
      };

      const onError = () => fail(400, INTERRUPTED);
      const onClose = () => {
        if (!ended) fail(400, INTERRUPTED);
      };

      out.once('error', () => fail(500, 'Enregistrement impossible.'));
      input.on('data', onData);
      input.once('end', onEnd);
      input.once('error', onError);
      input.once('close', onClose);
    });
  }

  /** Supprime un fichier. La vérification « encore utilisé ? » est faite par l'appelant. */
  remove(id: string): boolean {
    if (!this.get(id)) return false;
    this.store.deleteAsset(id);
    rmSync(this.filePath(id), { force: true });
    return true;
  }
}
