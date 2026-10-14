import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Lecture et écriture d'archives ZIP restreintes, pour les paquets .phgame.
 *
 * Volontairement limitées : méthodes 0 (stockée) et 8 (deflate) seulement ; pas de chiffrement,
 * pas de ZIP64, pas de multi-volumes, pas de liens symboliques, pas de dossiers. Toute archive
 * hors de ce cadre est refusée avec une raison claire, plutôt que lue « au mieux ».
 */

export class ZipError extends Error {}

export interface ZipFileEntry {
  name: string;
  data: Uint8Array;
}

export interface ZipReadLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  /** Rapport maximal taille décompressée / compressée, vérifié au-delà de `ratioCheckBytes`. */
  maxRatio: number;
  ratioCheckBytes: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = 65535 + EOCD_MIN;
const FLAG_ENCRYPTED = 0x1;
const FLAG_STRONG_ENCRYPTION = 0x40;
const MODE_TYPE_MASK = 0o170000;
const MODE_REGULAR = 0o100000;
const MODE_SYMLINK = 0o120000;

/** Lit toutes les entrées d'une archive, en contrôlant les tailles et les sommes CRC. */
export function readZip(bytes: Uint8Array, limits: ZipReadLimits, validateName: (name: string) => void): ZipFileEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < EOCD_MIN) throw new ZipError('Le fichier est trop petit pour être une archive ZIP.');

  let eocd = -1;
  for (let p = bytes.byteLength - EOCD_MIN; p >= Math.max(0, bytes.byteLength - EOCD_SEARCH); p--) {
    if (view.getUint32(p, true) === SIG_EOCD) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Fin d’archive ZIP introuvable.');

  const diskNumber = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  if (diskNumber !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ZipError('Les archives multi-volumes ne sont pas prises en charge.');
  }
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('Les archives ZIP64 ne sont pas prises en charge.');
  }
  if (totalEntries > limits.maxEntries) {
    throw new ZipError(`Trop de fichiers dans l’archive (${totalEntries} ; maximum ${limits.maxEntries}).`);
  }
  if (cdOffset + cdSize > eocd || cdOffset + cdSize > bytes.byteLength) {
    throw new ZipError('Répertoire central incohérent.');
  }

  // Première passe : métadonnées du répertoire central, avant toute décompression.
  const central: {
    name: string;
    flags: number;
    method: number;
    crc: number;
    csize: number;
    usize: number;
    externalAttr: number;
    localOffset: number;
  }[] = [];
  const names = new Set<string>();
  let declaredTotal = 0;
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== SIG_CENTRAL) {
      throw new ZipError('Entrée du répertoire central invalide.');
    }
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const externalAttr = view.getUint32(p + 38, true);
    const localOffset = view.getUint32(p + 42, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
    if (nameBytes.length !== nameLength) throw new ZipError('Nom de fichier tronqué.');
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch {
      throw new ZipError('Nom de fichier non UTF-8.');
    }

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw new ZipError(`« ${name} » est chiffré : refusé.`);
    if (method !== 0 && method !== 8) throw new ZipError(`« ${name} » utilise une compression non prise en charge.`);
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError('Les archives ZIP64 ne sont pas prises en charge.');
    if (name.endsWith('/')) throw new ZipError(`Dossier « ${name} » : les dossiers ne sont pas autorisés dans un paquet.`);
    const mode = externalAttr >>> 16;
    if (mode !== 0 && (mode & MODE_TYPE_MASK) === MODE_SYMLINK) throw new ZipError(`« ${name} » est un lien symbolique : refusé.`);
    if (mode !== 0 && (mode & MODE_TYPE_MASK) !== 0 && (mode & MODE_TYPE_MASK) !== MODE_REGULAR) {
      throw new ZipError(`« ${name} » n’est pas un fichier ordinaire.`);
    }
    validateName(name);
    if (names.has(name)) throw new ZipError(`« ${name} » apparaît deux fois dans l’archive.`);
    names.add(name);

    if (usize > limits.maxEntryBytes) {
      throw new ZipError(`« ${name} » dépasse la taille maximale (${formatBytes(limits.maxEntryBytes)}).`);
    }
    declaredTotal += usize;
    if (declaredTotal > limits.maxTotalBytes) {
      throw new ZipError(`Le contenu décompressé dépasse la taille maximale (${formatBytes(limits.maxTotalBytes)}).`);
    }
    if (usize > limits.ratioCheckBytes && usize / Math.max(csize, 1) > limits.maxRatio) {
      throw new ZipError(`« ${name} » est anormalement compressé (rapport suspect) : refusé.`);
    }

    central.push({ name, flags, method, crc, csize, usize, externalAttr, localOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }

  // Deuxième passe : données réelles, vérifiées par CRC et taille.
  const files: ZipFileEntry[] = [];
  for (const entry of central) {
    validateName(entry.name);
    const l = entry.localOffset;
    if (l + 30 > cdOffset || view.getUint32(l, true) !== SIG_LOCAL) {
      throw new ZipError(`Données locales invalides pour « ${entry.name} ».`);
    }
    const localNameLength = view.getUint16(l + 26, true);
    const localExtraLength = view.getUint16(l + 28, true);
    const localName = new TextDecoder().decode(bytes.subarray(l + 30, l + 30 + localNameLength));
    if (localName !== entry.name) throw new ZipError(`En-tête local incohérent pour « ${entry.name} ».`);
    const start = l + 30 + localNameLength + localExtraLength;
    const end = start + entry.csize;
    if (end > cdOffset) throw new ZipError(`Données de « ${entry.name} » au-delà du répertoire central.`);
    const raw = bytes.subarray(start, end);

    let data: Uint8Array;
    if (entry.method === 0) {
      data = raw;
    } else {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.usize) });
      } catch {
        throw new ZipError(`« ${entry.name} » est corrompu ou plus grand que annoncé.`);
      }
    }
    if (data.length !== entry.usize) throw new ZipError(`Taille de « ${entry.name} » incohérente.`);
    if (crc32(data) !== entry.crc) throw new ZipError(`Somme de contrôle incorrecte pour « ${entry.name} ».`);
    files.push({ name: entry.name, data });
  }
  return files;
}

/** Écrit une archive déterministe (ordre alphabétique, dates fixes), relisible par tout outil ZIP. */
export function writeZip(files: ZipFileEntry[]): Uint8Array {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (sorted.length > 0xfffe) throw new ZipError('Trop de fichiers.');
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1er janvier 1980
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of sorted) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.data);
    const deflated = raw.length > 0 ? deflateRawSync(raw, { level: 9 }) : Buffer.alloc(0);
    const method = raw.length > 0 && deflated.length < raw.length ? 8 : 0;
    const body = method === 8 ? deflated : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(SIG_CENTRAL, 0);
    head.writeUInt16LE((3 << 8) | 20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc >>> 0, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt16LE(0, 30);
    head.writeUInt16LE(0, 32);
    head.writeUInt16LE(0, 34);
    head.writeUInt16LE(0, 36);
    head.writeUInt32LE(((MODE_REGULAR | 0o644) << 16) >>> 0, 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cdSize = central.reduce((n, b) => n + b.length, 0);
  if (offset > 0xfffffffe || cdSize > 0xfffffffe) throw new ZipError('Archive trop grande.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_EOCD, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...chunks, ...central, end]));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} Mio`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Kio`;
  return `${bytes} o`;
}
